import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Delivery,
  DeliveryStatus,
  ActivityType,
  DealStage,
  Order,
  OrderItemSource,
  OrderStatus,
  Payment,
  PaymentRecordStatus,
  PaymentStatus,
  Prisma,
  ProductPriceType,
  RoleName,
  StockReservationStatus,
} from '@prisma/client';
import { InventoryService } from '../inventory/inventory.service';
import { PrismaService } from '../prisma/prisma.service';
import { SupplierOrdersService } from '../supplier-orders/supplier-orders.service';
import type { CurrentUser } from '../../common/interfaces/current-user.interface';
import {
  POLICY_FORBIDDEN_MESSAGE,
} from '../../common/enums/role.enum';
import { randomBytes } from 'node:crypto';
import { OrderPolicyService } from './services/order-policy.service';
import { PricingPolicyService } from './services/pricing-policy.service';
import { assertPaidForClientShipment } from './services/shipment-payment.policy';
import { ConfirmPaymentDto } from './dto/confirm-payment.dto';
import { CreateDeliveryDto } from './dto/create-delivery.dto';
import { CreateOrderFromDealDto } from './dto/create-order-from-deal.dto';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { FilterOrderDto } from './dto/filter-order.dto';

const PAYMENT_CONFIRM_PERMISSION = 'payments:confirm';
const READ_ALL_DEALS_PERMISSION = 'deals:read_all';

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

// Лёгкий include для списка: без позиций/платежей/доставок/резервов —
// они нужны только в карточке заказа
const orderListInclude = Prisma.validator<Prisma.OrderInclude>()({
  deal: {
    select: {
      id: true,
      title: true,
      stage: true,
      client: {
        select: { id: true, name: true },
      },
      owner: {
        select: { id: true, firstName: true, lastName: true },
      },
    },
  },
});

type OrderDetails = Prisma.OrderGetPayload<{
  include: typeof orderDetailsInclude;
}>;

type OrderListItem = Prisma.OrderGetPayload<{
  include: typeof orderListInclude;
}>;

type OrderListResult = {
  items: Array<OrderListItem & { _permissions: ReturnType<OrderPolicyService['getPermissions']> }>;
  total: number;
  page: number;
  limit: number;
};

type OrderDetailsWithPermissions = OrderDetails & {
  _permissions: ReturnType<OrderPolicyService['getPermissions']>;
};

type OrderPolicyTarget = {
  status: OrderStatus;
  deal: { ownerId?: string; owner?: { id: string } };
};

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventoryService: InventoryService,
    private readonly orderPolicy: OrderPolicyService,
    private readonly pricingPolicy: PricingPolicyService,
    private readonly supplierOrdersService: SupplierOrdersService,
  ) {}

  async createFromDeal(
    dto: CreateOrderFromDealDto,
    user: CurrentUser,
  ): Promise<OrderDetails> {
    const currentUserId = user.id;
    const permissions = user.permissions;

    const deal = await this.prisma.deal.findFirst({
      where: { id: dto.dealId, deletedAt: null },
      include: {
        items: true,
        panelQuotes: { select: { id: true } },
      },
    });

    if (!deal) {
      throw new NotFoundException('Deal not found');
    }

    if (
      !permissions.includes(READ_ALL_DEALS_PERMISSION) &&
      deal.ownerId !== currentUserId
    ) {
      throw new ForbiddenException('Access to this deal is forbidden');
    }

    if (deal.items.length === 0) {
      throw new BadRequestException('Deal has no items to create order');
    }

    if (deal.stage !== DealStage.WON) {
      throw new BadRequestException('Order can be created only from won deal');
    }

    await this.validateDealLinePricing(user, deal.items);

    const isPanelCalculatorDeal = this.isPanelCalculatorDeal(deal);

    try {
      return await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          orderNumber: this.generateOrderNumber(),
          dealId: deal.id,
          status: isPanelCalculatorDeal
            ? OrderStatus.PENDING_SUPPLIER
            : OrderStatus.WAITING_PAYMENT,
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
              source: isPanelCalculatorDeal
                ? OrderItemSource.PANEL_CALCULATOR
                : item.source,
            })),
          },
        },
        include: {
          items: true,
        },
      });

      if (isPanelCalculatorDeal) {
        if (!deal.supplierId) {
          throw new BadRequestException(
            'Deal has no supplier for panel calculator order',
          );
        }

        await this.supplierOrdersService.createFromDeal(
          deal.id,
          deal.supplierId,
          tx,
        );
      } else {
        try {
          await this.inventoryService.reserveStock(
            order.id,
            order.items.map((item) => ({
              productId: item.productId,
              quantity: item.quantity,
            })),
            tx,
            currentUserId,
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
    } catch (error) {
      if (this.isUniqueConstraintOn(error, 'dealId')) {
        const existing = await this.prisma.order.findUnique({
          where: { dealId: dto.dealId },
          select: { id: true },
        });

        throw new ConflictException(
          existing
            ? `Order for this deal already exists (${existing.id})`
            : 'Order for this deal already exists',
        );
      }

      throw error;
    }
  }

  async addPayment(
    dto: CreatePaymentDto,
    user: CurrentUser,
  ): Promise<Payment> {
    const order = await this.prisma.order.findFirst({
      where: { id: dto.orderId, deletedAt: null },
      include: { deal: { select: { ownerId: true } } },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    this.assertOrderMutationAllowed(
      user,
      order,
      (permissions) => permissions.canAddPayment,
    );

    const amount = new Prisma.Decimal(dto.amount);

    if (amount.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Payment amount must be a positive number');
    }

    return this.prisma.payment.create({
      data: {
        orderId: dto.orderId,
        amount,
        paymentDate: dto.paymentDate ? new Date(dto.paymentDate) : undefined,
        comment: dto.comment,
        fileId: dto.fileId,
        createdById: user.id,
      },
    });
  }

  async confirmPayment(
    paymentId: string,
    dto: ConfirmPaymentDto,
    user: CurrentUser,
  ): Promise<OrderDetailsWithPermissions> {
    if (!user.permissions.includes(PAYMENT_CONFIRM_PERMISSION)) {
      throw new ForbiddenException(
        'You do not have permission to confirm payments',
      );
    }

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
      select: {
        id: true,
        orderId: true,
        amount: true,
        status: true,
        createdById: true,
      },
    });

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    if (
      payment.createdById === user.id &&
      !user.roles.includes(RoleName.ADMIN)
    ) {
      throw new ForbiddenException(
        'Пользователь не может подтверждать платеж, созданный им самим (Maker-Checker)',
      );
    }

    // Payment FSM: обрабатывать можно только PENDING. CONFIRMED/REJECTED —
    // терминальные; «отклонить задним числом» нельзя, сторно — отдельная
    // операция (в MVP не реализована).
    if (payment.status !== PaymentRecordStatus.PENDING) {
      throw new ConflictException(
        `Payment already processed. Current status: ${payment.status}`,
      );
    }

    const orderForPolicy = await this.prisma.order.findFirst({
      where: { id: payment.orderId, deletedAt: null },
      include: { deal: { select: { ownerId: true } } },
    });

    if (!orderForPolicy) {
      throw new NotFoundException('Order not found');
    }

    if (orderForPolicy.status !== OrderStatus.CANCELLED) {
      this.assertOrderMutationAllowed(
        user,
        orderForPolicy,
        (permissions) => permissions.canConfirmPayment,
      );
    }

    const confirmedOrder = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: payment.orderId },
      });

      if (!order) {
        throw new NotFoundException('Order not found');
      }

      if (order.status === OrderStatus.CANCELLED) {
        throw new ConflictException('Order is cancelled');
      }

      // Портативная блокировка строки заказа (write-lock на PG и SQLite,
      // FOR UPDATE в SQLite невалиден): сериализует параллельные confirm
      // разных платежей одного заказа.
      await tx.order.update({
        where: { id: order.id },
        data: { paymentStatus: order.paymentStatus },
      });

      // Атомарный захват платежа: два параллельных confirm на один
      // PENDING-платёж — второй получит count=0 и ConflictException.
      const claimed = await tx.payment.updateMany({
        where: { id: paymentId, status: PaymentRecordStatus.PENDING },
        data: { status: dto.status },
      });

      if (claimed.count === 0) {
        throw new ConflictException(
          'Payment already processed. Current status: not PENDING',
        );
      }

      const aggregate = await tx.payment.aggregate({
        where: {
          orderId: payment.orderId,
          status: PaymentRecordStatus.CONFIRMED,
        },
        _sum: { amount: true },
      });

      const paidAmount = aggregate._sum.amount ?? new Prisma.Decimal(0);

      if (
        dto.status === PaymentRecordStatus.CONFIRMED &&
        paidAmount.greaterThan(order.totalAmount)
      ) {
        throw new ConflictException(
          `Payment exceeds order total. Remaining: ${Prisma.Decimal.max(
            new Prisma.Decimal(0),
            order.totalAmount.minus(paidAmount.minus(payment.amount)),
          ).toString()}`,
        );
      }

      const remainingAmount = Prisma.Decimal.max(
        new Prisma.Decimal(0),
        order.totalAmount.minus(paidAmount),
      );
      const paymentStatus = this.calculatePaymentStatus(
        paidAmount,
        order.totalAmount,
      );

      const updateResult = await tx.order.updateMany({
        where: { id: payment.orderId, version: order.version },
        data: {
          paidAmount,
          remainingAmount,
          paymentStatus,
          version: { increment: 1 },
        },
      });

      if (updateResult.count === 0) {
        throw new ConflictException('Order modified concurrently');
      }

      const updatedOrder = await tx.order.findUnique({
        where: { id: payment.orderId },
        include: orderDetailsInclude,
      });

      if (!updatedOrder) {
        throw new NotFoundException('Order not found');
      }

      if (user.id) {
        await tx.activity.create({
          data: {
            authorId: user.id,
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
            userId: user.id,
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

    return this.attachOrderPermissions(user, confirmedOrder);
  }

  async createDelivery(
    dto: CreateDeliveryDto,
    user: CurrentUser,
  ): Promise<Delivery> {
    const existingOrder = await this.prisma.order.findFirst({
      where: { id: dto.orderId, deletedAt: null },
      include: { deal: { select: { ownerId: true } } },
    });

    if (!existingOrder) {
      throw new NotFoundException('Order not found');
    }

    if (existingOrder.status !== OrderStatus.CANCELLED) {
      this.assertOrderMutationAllowed(
        user,
        existingOrder,
        (permissions) => permissions.canCreateDelivery,
      );
    }

    if (existingOrder.status === OrderStatus.CANCELLED) {
      throw new ConflictException('Order is cancelled');
    }

    return this.prisma.$transaction(async (tx) => {
      // Row lock: serialize vs payment confirm and concurrent deliveries.
      // Do not write a cached paymentStatus — that would clobber a concurrent PAID.
      await tx.order.update({
        where: { id: dto.orderId },
        data: { updatedAt: new Date() },
      });

      const lockedOrder = await tx.order.findUnique({
        where: { id: dto.orderId },
      });

      if (!lockedOrder || lockedOrder.deletedAt) {
        throw new NotFoundException('Order not found');
      }

      if (lockedOrder.status === OrderStatus.CANCELLED) {
        throw new ConflictException('Order is cancelled');
      }

      assertPaidForClientShipment(lockedOrder.paymentStatus);

      const orderItems = await tx.orderItem.findMany({
        where: {
          orderId: dto.orderId,
          id: { in: dto.items.map((item) => item.orderItemId) },
        },
      });

      if (orderItems.length !== dto.items.length) {
        throw new NotFoundException('One or more order items were not found');
      }

      const stockItems: { productId: string; quantity: number }[] = [];

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

        stockItems.push({
          productId: orderItem.productId,
          quantity: deliveryItem.quantity,
        });
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
        await tx.orderItem.update({
          where: { id: deliveryItem.orderItemId },
          data: {
            deliveredQuantity: { increment: deliveryItem.quantity },
          },
        });
      }

      // Атомарное списание через InventoryService: onHand/reserved -= qty,
      // version-check против lost update, available не трогается (инвариант).
      await this.inventoryService.commitReservation(
        dto.orderId,
        stockItems,
        tx,
        user.id,
      );

      await this.updateReservationFulfillment(tx, dto.orderId);
      await this.updateOrderShipmentStatus(
        tx,
        dto.orderId,
        lockedOrder.version,
      );

      return delivery;
    });
  }

  async cancelOrder(
    orderId: string,
    user: CurrentUser,
  ): Promise<OrderDetailsWithPermissions> {
    const existing = await this.prisma.order.findFirst({
      where: { id: orderId, deletedAt: null },
      include: { deal: { select: { ownerId: true } } },
    });

    if (!existing) {
      throw new NotFoundException('Order not found');
    }

    this.assertOrderReadAccess(user, existing);

    const terminalStatuses: OrderStatus[] = [
      OrderStatus.PARTIALLY_SHIPPED,
      OrderStatus.SHIPPED,
      OrderStatus.COMPLETED,
      OrderStatus.CANCELLED,
    ];

    if (!terminalStatuses.includes(existing.status)) {
      this.assertOrderMutationAllowed(
        user,
        existing,
        (permissions) => permissions.canDelete,
      );
    }

    const cancelledOrder = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findFirst({
        where: { id: orderId, deletedAt: null },
      });

      if (!order) {
        throw new NotFoundException('Order not found');
      }

      if (terminalStatuses.includes(order.status)) {
        throw new ConflictException(
          `Cannot cancel order in status ${order.status}`,
        );
      }

      // В WAITING_STOCK активных резервов нет — releaseReservation
      // просто найдёт 0 записей, вызываем безусловно.
      await this.inventoryService.releaseReservation(
        orderId,
        tx,
        user.id,
      );

      const updated = await tx.order.updateMany({
        where: { id: orderId, version: order.version },
        data: {
          status: OrderStatus.CANCELLED,
          version: { increment: 1 },
        },
      });

      if (updated.count === 0) {
        throw new ConflictException('Order modified concurrently');
      }

      // Отмена заказа — значимая операция, всегда в журнал аудита.
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: 'ORDER_CANCELLED',
          entityType: 'Order',
          entityId: orderId,
          oldValue: { status: order.status },
          newValue: { status: OrderStatus.CANCELLED },
        },
      });

      const cancelledOrder = await tx.order.findUnique({
        where: { id: orderId },
        include: orderDetailsInclude,
      });

      if (!cancelledOrder) {
        throw new NotFoundException('Order not found');
      }

      return cancelledOrder;
    });

    return this.attachOrderPermissions(user, cancelledOrder);
  }

  async findAll(
    filterDto: FilterOrderDto,
    user: CurrentUser,
  ): Promise<OrderListResult> {
    const page = filterDto.page ?? 1;
    const limit = filterDto.limit ?? 20;
    const scopeFilter = this.orderPolicy.getScopeFilter(user);
    const where: Prisma.OrderWhereInput = {
      deletedAt: null,
      status: filterDto.status,
      paymentStatus: filterDto.paymentStatus,
      dealId: filterDto.dealId,
      ...scopeFilter,
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        include: orderListInclude,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.order.count({ where }),
    ]);

    return {
      items: items.map((order) => this.attachOrderPermissions(user, order)),
      total,
      page,
      limit,
    };
  }

  async findOne(
    id: string,
    user: CurrentUser,
  ): Promise<OrderDetailsWithPermissions> {
    const order = await this.prisma.order.findFirst({
      where: { id, deletedAt: null },
      include: orderDetailsInclude,
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    this.assertOrderReadAccess(user, order);

    return this.attachOrderPermissions(user, order);
  }

  private attachOrderPermissions<T extends OrderPolicyTarget>(
    user: CurrentUser,
    order: T,
  ): T & { _permissions: ReturnType<OrderPolicyService['getPermissions']> } {
    return {
      ...order,
      _permissions: this.orderPolicy.getPermissions(user, {
        status: order.status,
        deal: { ownerId: this.resolveOrderOwnerId(order) },
      }),
    };
  }

  private resolveOrderOwnerId(order: OrderPolicyTarget): string {
    const ownerId = order.deal.ownerId ?? order.deal.owner?.id;

    if (!ownerId) {
      throw new NotFoundException('Order deal owner is missing');
    }

    return ownerId;
  }

  private assertOrderMutationAllowed(
    user: CurrentUser,
    order: OrderPolicyTarget,
    selector: (
      permissions: ReturnType<OrderPolicyService['getPermissions']>,
    ) => boolean,
  ): void {
    const permissions = this.orderPolicy.getPermissions(user, {
      status: order.status,
      deal: { ownerId: this.resolveOrderOwnerId(order) },
    });

    if (!selector(permissions)) {
      throw new ForbiddenException(POLICY_FORBIDDEN_MESSAGE);
    }
  }

  private assertOrderReadAccess(
    user: CurrentUser,
    order: OrderPolicyTarget,
  ): void {
    const scopeFilter = this.orderPolicy.getScopeFilter(user);

    if (Object.keys(scopeFilter).length === 0) {
      return;
    }

    if (this.resolveOrderOwnerId(order) !== user.id) {
      throw new ForbiddenException('Access to this order is forbidden');
    }
  }

  private async validateDealLinePricing(
    user: CurrentUser,
    items: Array<{
      productId: string;
      quantityM2: number | Prisma.Decimal;
      unitPrice: Prisma.Decimal;
      discount: Prisma.Decimal;
      purchasePriceSnapshot: Prisma.Decimal | null;
    }>,
  ): Promise<void> {
    if (items.length === 0) {
      return;
    }

    const productIds = [...new Set(items.map((item) => item.productId))];
    const now = new Date();
    const prices = await this.prisma.productPrice.findMany({
      where: {
        productId: { in: productIds },
        type: {
          in: [
            ProductPriceType.BASE,
            ProductPriceType.RETAIL,
          ],
        },
        validFrom: { lte: now },
        OR: [{ validTo: null }, { validTo: { gte: now } }],
      },
      orderBy: { validFrom: 'desc' },
      select: { productId: true, type: true, amount: true },
    });
    const basePriceMap = new Map<string, number>();
    const retailPriceMap = new Map<string, number>();

    for (const price of prices) {
      if (
        price.type === ProductPriceType.BASE &&
        !basePriceMap.has(price.productId)
      ) {
        basePriceMap.set(price.productId, Number(price.amount));
      }

      if (
        price.type === ProductPriceType.RETAIL &&
        !retailPriceMap.has(price.productId)
      ) {
        retailPriceMap.set(price.productId, Number(price.amount));
      }
    }

    const validationItems: Array<{
      productId: string;
      price: number;
      basePrice: number;
      purchasePrice: number;
    }> = [];

    for (const item of items) {
      const basePrice =
        basePriceMap.get(item.productId) ??
        retailPriceMap.get(item.productId);
      const purchasePrice = Number(item.purchasePriceSnapshot);
      const quantityM2 = Number(item.quantityM2);
      const effectivePrice =
        Number(item.unitPrice) - Number(item.discount) / quantityM2;

      if (effectivePrice < purchasePrice) {
        throw new BadRequestException(
          `Цена позиции (${effectivePrice}) не может быть ниже закупочной цены (${purchasePrice})`,
        );
      }

      if (basePrice === undefined) {
        continue;
      }

      validationItems.push({
        productId: item.productId,
        price: effectivePrice,
        basePrice,
        purchasePrice,
      });
    }

    if (validationItems.length > 0) {
      this.pricingPolicy.validateItemPrices(user, validationItems);
    }
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
    expectedVersion: number,
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

    const nextStatus = allDelivered
      ? OrderStatus.SHIPPED
      : deliveredItems.length > 0
        ? OrderStatus.PARTIALLY_SHIPPED
        : null;

    if (!nextStatus) {
      return;
    }

    const updated = await tx.order.updateMany({
      where: { id: orderId, version: expectedVersion },
      data: {
        status: nextStatus,
        version: { increment: 1 },
      },
    });

    if (updated.count === 0) {
      throw new ConflictException('Order modified concurrently');
    }
  }

  private isPanelCalculatorDeal(deal: {
    panelQuotes: Array<{ id: string }>;
    items: Array<{ source: OrderItemSource }>;
  }): boolean {
    return (
      deal.panelQuotes.length > 0 ||
      (deal.items.length > 0 &&
        deal.items.every(
          (item) => item.source === OrderItemSource.PANEL_CALCULATOR,
        ))
    );
  }

  private generateOrderNumber(): string {
    return `ORD-${Date.now()}-${randomBytes(3).toString('hex').toUpperCase()}`;
  }

  private isUniqueConstraintOn(error: unknown, field: string): boolean {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== 'P2002'
    ) {
      return false;
    }

    const target = error.meta?.target;
    return Array.isArray(target) && target.includes(field);
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
