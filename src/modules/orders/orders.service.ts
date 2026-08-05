import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Delivery,
  DeliveryStatus,
  ActivityType,
  DealStage,
  Order,
  OrderStatus,
  Payment,
  PaymentRecordStatus,
  PaymentStatus,
  Prisma,
  StockReservationStatus,
} from '@prisma/client';
import { InventoryService } from '../inventory/inventory.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConfirmPaymentDto } from './dto/confirm-payment.dto';
import { CreateDeliveryDto } from './dto/create-delivery.dto';
import { CreateOrderFromDealDto } from './dto/create-order-from-deal.dto';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { FilterOrderDto } from './dto/filter-order.dto';

const orderDetailsInclude = Prisma.validator<Prisma.OrderInclude>()({
  deal: {
    include: {
      client: true,
      projectObject: true,
      owner: true,
    },
  },
  items: {
    include: {
      product: true,
      deliveryItems: true,
    },
  },
  payments: {
    orderBy: { createdAt: 'desc' },
  },
  deliveries: {
    include: {
      items: true,
    },
    orderBy: { deliveryDate: 'desc' },
  },
  reservations: true,
});

type OrderDetails = Prisma.OrderGetPayload<{
  include: typeof orderDetailsInclude;
}>;

type OrderListResult = {
  items: OrderDetails[];
  total: number;
  page: number;
  limit: number;
};

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventoryService: InventoryService,
  ) {}

  async createFromDeal(
    dto: CreateOrderFromDealDto,
    currentUserId: string,
  ): Promise<OrderDetails> {
    void currentUserId;

    const existingOrder = await this.prisma.order.findUnique({
      where: { dealId: dto.dealId },
      select: { id: true },
    });

    if (existingOrder) {
      throw new ConflictException('Order for this deal already exists');
    }

    const deal = await this.prisma.deal.findFirst({
      where: { id: dto.dealId, deletedAt: null },
      include: { items: true },
    });

    if (!deal) {
      throw new NotFoundException('Deal not found');
    }

    if (deal.items.length === 0) {
      throw new BadRequestException('Deal has no items to create order');
    }

    if (deal.stage !== DealStage.WON) {
      throw new BadRequestException('Order can be created only from won deal');
    }

    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          orderNumber: this.generateOrderNumber(),
          dealId: deal.id,
          status: OrderStatus.WAITING_PAYMENT,
          totalAmount: deal.totalAmount,
          remainingAmount: deal.totalAmount,
          paymentTerms: dto.paymentTerms,
          promisedDate: dto.promisedDate,
          deliveryAddress: dto.deliveryAddress,
          items: {
            create: deal.items.map((item) => ({
              productId: item.productId,
              quantity: item.quantityM2,
              unitPrice: item.unitPrice,
              totalPrice: item.totalPrice,
            })),
          },
        },
        include: {
          items: true,
        },
      });

      try {
        await this.inventoryService.reserveStock(
          order.id,
          order.items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
          })),
          tx,
        );

        await Promise.all(
          order.items.map((item) =>
            tx.orderItem.update({
              where: { id: item.id },
              data: { reservedQuantity: item.quantity },
            }),
          ),
        );
      } catch (error) {
        if (!(error instanceof BadRequestException)) {
          throw error;
        }

        await tx.order.update({
          where: { id: order.id },
          data: { status: OrderStatus.WAITING_STOCK },
        });
      }

      const createdOrder = await tx.order.findUnique({
        where: { id: order.id },
        include: orderDetailsInclude,
      });

      if (!createdOrder) {
        throw new NotFoundException('Order not found');
      }

      return createdOrder;
    });
  }

  async addPayment(
    dto: CreatePaymentDto,
    currentUserId: string,
  ): Promise<Payment> {
    await this.ensureOrderExists(dto.orderId);

    return this.prisma.payment.create({
      data: {
        orderId: dto.orderId,
        amount: dto.amount,
        paymentDate: dto.paymentDate,
        comment: dto.comment,
        fileId: dto.fileId,
        createdById: currentUserId,
      },
    });
  }

  async confirmPayment(
    paymentId: string,
    dto: ConfirmPaymentDto,
    currentUserId?: string,
  ): Promise<OrderDetails> {
    if (
      dto.status !== PaymentRecordStatus.CONFIRMED &&
      dto.status !== PaymentRecordStatus.REJECTED
    ) {
      throw new BadRequestException(
        'Payment status must be CONFIRMED or REJECTED',
      );
    }

    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      select: { id: true, orderId: true },
    });

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: paymentId },
        data: { status: dto.status },
      });

      const order = await tx.order.findUnique({
        where: { id: payment.orderId },
      });

      if (!order) {
        throw new NotFoundException('Order not found');
      }

      const aggregate = await tx.payment.aggregate({
        where: {
          orderId: payment.orderId,
          status: PaymentRecordStatus.CONFIRMED,
        },
        _sum: { amount: true },
      });

      const paidAmount = aggregate._sum.amount ?? new Prisma.Decimal(0);
      const remainingAmount = Prisma.Decimal.max(
        new Prisma.Decimal(0),
        order.totalAmount.minus(paidAmount),
      );
      const paymentStatus = this.calculatePaymentStatus(
        paidAmount,
        order.totalAmount,
      );

      const updatedOrder = await tx.order.update({
        where: { id: payment.orderId },
        data: {
          paidAmount,
          remainingAmount,
          paymentStatus,
        },
        include: orderDetailsInclude,
      });

      if (currentUserId) {
        await tx.activity.create({
          data: {
            authorId: currentUserId,
            relatedType: 'Order',
            relatedId: payment.orderId,
            type: ActivityType.PAYMENT_RECEIVED,
            content: `Payment ${dto.status.toLowerCase()}`,
            metadata: {
              paymentId,
              status: dto.status,
              paidAmount: paidAmount.toString(),
              remainingAmount: remainingAmount.toString(),
            },
          },
        });

        await tx.auditLog.create({
          data: {
            userId: currentUserId,
            action: 'PAYMENT_STATUS_CHANGED',
            entityType: 'Payment',
            entityId: paymentId,
            newValue: {
              status: dto.status,
              orderId: payment.orderId,
              paidAmount: paidAmount.toString(),
              remainingAmount: remainingAmount.toString(),
              paymentStatus,
            },
          },
        });
      }

      return updatedOrder;
    });
  }

  async createDelivery(dto: CreateDeliveryDto): Promise<Delivery> {
    await this.ensureOrderExists(dto.orderId);

    return this.prisma.$transaction(async (tx) => {
      const orderItems = await tx.orderItem.findMany({
        where: {
          orderId: dto.orderId,
          id: { in: dto.items.map((item) => item.orderItemId) },
        },
      });

      if (orderItems.length !== dto.items.length) {
        throw new NotFoundException('One or more order items were not found');
      }

      const delivery = await tx.delivery.create({
        data: {
          orderId: dto.orderId,
          deliveryDate: dto.deliveryDate,
          recipient: dto.recipient,
          trackingNumber: dto.trackingNumber,
          status: DeliveryStatus.DELIVERED,
          items: {
            create: dto.items.map((item) => ({
              orderItemId: item.orderItemId,
              quantity: item.quantity,
            })),
          },
        },
        include: {
          items: true,
        },
      });

      for (const deliveryItem of dto.items) {
        const orderItem = orderItems.find(
          (item) => item.id === deliveryItem.orderItemId,
        );

        if (!orderItem) {
          throw new NotFoundException('Order item not found');
        }

        const remainingToDeliver =
          orderItem.quantity - orderItem.deliveredQuantity;

        if (deliveryItem.quantity > remainingToDeliver) {
          throw new BadRequestException(
            'Delivery quantity exceeds remaining order item quantity',
          );
        }

        const balance = await tx.stockBalance.findUnique({
          where: { productId: orderItem.productId },
        });

        if (
          !balance ||
          balance.onHand < deliveryItem.quantity ||
          balance.reserved < deliveryItem.quantity
        ) {
          throw new BadRequestException(
            'Недостаточно товара на складе для резервирования',
          );
        }

        await tx.stockBalance.update({
          where: { productId: orderItem.productId },
          data: {
            onHand: { decrement: deliveryItem.quantity },
            reserved: { decrement: deliveryItem.quantity },
          },
        });

        await tx.orderItem.update({
          where: { id: orderItem.id },
          data: {
            deliveredQuantity: { increment: deliveryItem.quantity },
          },
        });
      }

      await this.updateReservationFulfillment(tx, dto.orderId);
      await this.updateOrderShipmentStatus(tx, dto.orderId);

      return delivery;
    });
  }

  async findAll(filterDto: FilterOrderDto): Promise<OrderListResult> {
    const page = filterDto.page ?? 1;
    const limit = filterDto.limit ?? 20;
    const where: Prisma.OrderWhereInput = {
      deletedAt: null,
      status: filterDto.status,
      paymentStatus: filterDto.paymentStatus,
      dealId: filterDto.dealId,
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        include: orderDetailsInclude,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.order.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  async findOne(id: string): Promise<OrderDetails> {
    const order = await this.prisma.order.findFirst({
      where: { id, deletedAt: null },
      include: orderDetailsInclude,
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    return order;
  }

  private calculatePaymentStatus(
    paidAmount: Prisma.Decimal,
    totalAmount: Prisma.Decimal,
  ): PaymentStatus {
    if (paidAmount.lessThanOrEqualTo(0)) {
      return PaymentStatus.UNPAID;
    }

    return paidAmount.greaterThanOrEqualTo(totalAmount)
      ? PaymentStatus.PAID
      : PaymentStatus.PARTIALLY_PAID;
  }

  private async updateReservationFulfillment(
    tx: Prisma.TransactionClient,
    orderId: string,
  ): Promise<void> {
    const orderItems = await tx.orderItem.findMany({
      where: { orderId },
    });
    const allDelivered = orderItems.every(
      (item) => item.deliveredQuantity >= item.quantity,
    );

    if (!allDelivered) {
      return;
    }

    await tx.stockReservation.updateMany({
      where: {
        orderId,
        status: StockReservationStatus.ACTIVE,
      },
      data: { status: StockReservationStatus.FULFILLED },
    });
  }

  private async updateOrderShipmentStatus(
    tx: Prisma.TransactionClient,
    orderId: string,
  ): Promise<void> {
    const orderItems = await tx.orderItem.findMany({
      where: { orderId },
    });
    const deliveredItems = orderItems.filter(
      (item) => item.deliveredQuantity > 0,
    );
    const allDelivered = orderItems.every(
      (item) => item.deliveredQuantity >= item.quantity,
    );

    if (allDelivered) {
      await tx.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.SHIPPED },
      });
      return;
    }

    if (deliveredItems.length > 0) {
      await tx.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.PARTIALLY_SHIPPED },
      });
    }
  }

  private generateOrderNumber(): string {
    return `ORD-${Date.now()}`;
  }

  private async ensureOrderExists(id: string): Promise<Order> {
    const order = await this.prisma.order.findFirst({
      where: { id, deletedAt: null },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    return order;
  }
}
