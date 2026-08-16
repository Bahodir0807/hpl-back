import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ActivityType,
  Prisma,
  SupplierOrder,
  SupplierOrderStatus,
} from '@prisma/client';
import type { CurrentUser } from '../../common/interfaces/current-user.interface';
import { DealPolicyService } from '../deals/services/deal-policy.service';
import {
  assertPaidForClientShipment,
  isClientShipmentSupplierStatus,
} from '../orders/services/shipment-payment.policy';
import { PrismaService } from '../prisma/prisma.service';

type DbClient = Prisma.TransactionClient | PrismaService;

const TERMINAL_SUPPLIER_ORDER_STATUSES: SupplierOrderStatus[] = [
  SupplierOrderStatus.DELIVERED,
  SupplierOrderStatus.CANCELLED,
];

@Injectable()
export class SupplierOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dealPolicy: DealPolicyService,
  ) {}

  async createFromDeal(
    dealId: string,
    supplierId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<SupplierOrder> {
    const db: DbClient = tx ?? this.prisma;

    const deal = await db.deal.findFirst({
      where: { id: dealId, deletedAt: null },
      include: {
        panelQuotes: {
          select: { deliveryCost: true },
          take: 1,
          orderBy: { createdAt: 'desc' },
        },
        order: { select: { deliveryAddress: true } },
      },
    });

    if (!deal) {
      throw new NotFoundException('Deal not found');
    }

    if (!supplierId) {
      throw new BadRequestException(
        'Deal has no supplier for panel calculator order',
      );
    }

    try {
      return await db.supplierOrder.create({
        data: {
          dealId,
          supplierId,
          status: SupplierOrderStatus.DRAFT,
          deliveryCost: deal.panelQuotes[0]?.deliveryCost,
          deliveryAddress: deal.order?.deliveryAddress,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existing = await db.supplierOrder.findUnique({
          where: { dealId },
        });

        if (existing) {
          return existing;
        }
      }

      throw error;
    }
  }

  async updateStatus(
    id: string,
    status: SupplierOrderStatus,
    user: CurrentUser,
  ): Promise<SupplierOrder> {
    const supplierOrder = await this.prisma.supplierOrder.findUnique({
      where: { id },
    });

    if (!supplierOrder) {
      throw new NotFoundException('Supplier order not found');
    }

    await this.assertDealAccessOrNotFound(
      supplierOrder.dealId,
      user,
      'Supplier order not found',
    );

    if (
      TERMINAL_SUPPLIER_ORDER_STATUSES.includes(supplierOrder.status) &&
      supplierOrder.status !== status
    ) {
      throw new BadRequestException(
        `Cannot change supplier order in status ${supplierOrder.status}`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const isNewClientShipment =
        isClientShipmentSupplierStatus(status) &&
        status !== supplierOrder.status;

      if (isNewClientShipment) {
        await this.assertDealPaidForShipment(tx, supplierOrder.dealId);
      }

      const updated = await tx.supplierOrder.update({
        where: { id },
        data: { status },
      });

      await tx.activity.create({
        data: {
          authorId: user.id,
          relatedType: 'Deal',
          relatedId: supplierOrder.dealId,
          type: ActivityType.SUPPLIER_ORDER_STATUS_CHANGED,
          content: `Supplier order status changed from ${supplierOrder.status} to ${status}`,
          metadata: {
            supplierOrderId: id,
            oldStatus: supplierOrder.status,
            newStatus: status,
          },
        },
      });

      return updated;
    });
  }

  async findByDealId(
    dealId: string,
    user: CurrentUser,
  ): Promise<SupplierOrder> {
    const supplierOrder = await this.prisma.supplierOrder.findUnique({
      where: { dealId },
      include: {
        supplier: {
          select: { id: true, code: true, name: true },
        },
      },
    });

    if (!supplierOrder) {
      throw new NotFoundException('Supplier order not found for this deal');
    }

    await this.assertDealAccessOrNotFound(
      dealId,
      user,
      'Supplier order not found for this deal',
    );

    return supplierOrder;
  }

  private async assertDealPaidForShipment(
    tx: Prisma.TransactionClient,
    dealId: string,
  ): Promise<void> {
    const deal = await tx.deal.findFirst({
      where: { id: dealId, deletedAt: null },
      select: {
        order: {
          select: { id: true, paymentStatus: true, deletedAt: true },
        },
      },
    });

    const clientOrder = deal?.order;

    if (!clientOrder || clientOrder.deletedAt) {
      assertPaidForClientShipment(undefined);
      return;
    }

    await tx.order.update({
      where: { id: clientOrder.id },
      data: { updatedAt: new Date() },
    });

    const lockedOrder = await tx.order.findUnique({
      where: { id: clientOrder.id },
      select: { paymentStatus: true, deletedAt: true },
    });

    if (!lockedOrder || lockedOrder.deletedAt) {
      assertPaidForClientShipment(undefined);
      return;
    }

    assertPaidForClientShipment(lockedOrder.paymentStatus);
  }

  private async assertDealAccessOrNotFound(
    dealId: string,
    user: CurrentUser,
    notFoundMessage: string,
  ): Promise<void> {
    const deal = await this.prisma.deal.findFirst({
      where: { id: dealId, deletedAt: null },
      select: { ownerId: true },
    });

    if (!deal || !this.dealPolicy.canReadDeal(user, deal)) {
      throw new NotFoundException(notFoundMessage);
    }
  }
}
