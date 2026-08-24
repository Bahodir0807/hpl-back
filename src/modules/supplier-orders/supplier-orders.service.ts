import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ActivityType,
  FulfillmentSource,
  Prisma,
  RoleName,
  SupplierOrder,
  SupplierOrderStatus,
} from '@prisma/client';
import { QUOTE_STATUS } from '../../quotes/quote.constants';
import { BusinessException } from '../../common/exceptions/business.exception';
import type { CurrentUser } from '../../common/interfaces/current-user.interface';
import { hasAnyRole } from '../../common/enums/role.enum';
import { DealCompletionService } from '../deals/deal-completion.service';
import {
  CLIENT_DELIVERY_FORBIDDEN_MESSAGE,
  CLIENT_DELIVERY_NOT_SHIPPED_MESSAGE,
  FULFILLMENT_AUDIT,
} from '../deals/deal-fulfillment.constants';
import { DealPolicyService } from '../deals/services/deal-policy.service';
import {
  assertPaidForClientShipment,
  isClientShipmentSupplierStatus,
} from '../orders/services/shipment-payment.policy';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSupplierOrderDto } from './dto/create-supplier-order.dto';
import { UpdateSupplierOrderDatesDto } from './dto/update-supplier-order-dates.dto';
import {
  READY_CONFIRMABLE_STATUSES,
  READINESS_REMINDER_STOP_STATUSES,
  SUPPLIER_ORDER_PERMISSIONS,
  SUPPLIER_ORDER_REMINDER_KIND,
  SUPPLIER_ORDER_REMINDER_TYPE,
  SUPPLIER_ORDER_STATUS_TRANSITIONS,
  type SupplierOrderReminderKind,
} from './supplier-order.constants';

const SUPPLIER_ORDER_RELATED_TYPE = 'SupplierOrder';
const CLIENT_SHIPMENT_FORBIDDEN_MESSAGE =
  'Supplier shipment is allowed only for HEAD or DIRECTOR';

type SupplierOrderWithSupplier = Prisma.SupplierOrderGetPayload<{
  include: {
    supplier: {
      select: { id: true; code: true; name: true };
    };
  };
}>;

const supplierOrderInclude = Prisma.validator<Prisma.SupplierOrderInclude>()({
  supplier: {
    select: { id: true, code: true, name: true },
  },
});

@Injectable()
export class SupplierOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dealPolicy: DealPolicyService,
    private readonly dealCompletion: DealCompletionService,
  ) {}

  async createForDeal(
    dealId: string,
    dto: CreateSupplierOrderDto,
    user: CurrentUser,
  ): Promise<SupplierOrderWithSupplier> {
    this.assertManageAllowed(user);
    this.assertTimelineDates({
      orderedAt: dto.orderedAt,
      expectedReadyAt: dto.expectedReadyAt,
      expectedShipmentAt: dto.expectedShipmentAt,
      expectedArrivalAt: dto.expectedArrivalAt,
    });

    const deal = await this.prisma.deal.findFirst({
      where: { id: dealId, deletedAt: null },
      select: {
        id: true,
        ownerId: true,
        fulfillmentSource: true,
        panelQuotes: {
          select: {
            id: true,
            status: true,
            clientAcceptedAt: true,
          },
          orderBy: { createdAt: 'desc' },
        },
        order: { select: { deliveryAddress: true } },
      },
    });

    if (!deal || !this.dealPolicy.canReadDeal(user, deal)) {
      throw new NotFoundException('Deal not found');
    }

    if (deal.fulfillmentSource === FulfillmentSource.WAREHOUSE_STOCK) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        'FULFILLMENT_SOURCE_CONFLICT',
        'Warehouse-stock Deal cannot create supplier orders',
      );
    }

    if (deal.fulfillmentSource !== FulfillmentSource.SUPPLIER_ORDER) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        'FULFILLMENT_SOURCE_REQUIRED',
        'Deal fulfillment source must be selected before supplier ordering',
      );
    }

    this.assertHplDealReadyForSupplierOrder(deal.panelQuotes);

    const supplier = await this.prisma.supplier.findUnique({
      where: { id: dto.supplierId },
      select: { id: true },
    });

    if (!supplier) {
      throw new NotFoundException('Supplier not found');
    }

    const acceptedQuote = deal.panelQuotes.find(
      (quote) => quote.clientAcceptedAt !== null,
    );

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.supplierOrder.create({
        data: {
          dealId,
          supplierId: supplier.id,
          status: SupplierOrderStatus.SENT_TO_PRODUCTION,
          orderedAt: dto.orderedAt,
          expectedReadyAt: dto.expectedReadyAt,
          expectedShipmentAt: dto.expectedShipmentAt,
          expectedArrivalAt: dto.expectedArrivalAt,
          comment: dto.comment?.trim() || null,
          createdById: user.id,
          deliveryAddress: deal.order?.deliveryAddress,
          deliveryCost: null,
        },
        include: supplierOrderInclude,
      });

      await tx.activity.create({
        data: {
          authorId: user.id,
          relatedType: 'Deal',
          relatedId: dealId,
          type: ActivityType.NOTE,
          content: 'Supplier order created',
          metadata: {
            action: 'supplier_order_created',
            supplierOrderId: created.id,
            supplierId: supplier.id,
            quoteId: acceptedQuote?.id,
          },
        },
      });

      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: 'SUPPLIER_ORDER_CREATED',
          entityType: 'SupplierOrder',
          entityId: created.id,
          newValue: {
            dealId,
            supplierId: supplier.id,
            status: created.status,
            orderedAt: dto.orderedAt.toISOString(),
            expectedReadyAt: dto.expectedReadyAt.toISOString(),
          },
        },
      });

      return created;
    });
  }

  async findByDealId(
    dealId: string,
    user: CurrentUser,
  ): Promise<SupplierOrderWithSupplier[]> {
    await this.assertDealAccessOrNotFound(dealId, user, 'Deal not found');

    return this.prisma.supplierOrder.findMany({
      where: { dealId },
      include: supplierOrderInclude,
      orderBy: { createdAt: 'asc' },
    });
  }

  async findOne(
    id: string,
    user: CurrentUser,
  ): Promise<SupplierOrderWithSupplier> {
    const supplierOrder = await this.prisma.supplierOrder.findUnique({
      where: { id },
      include: supplierOrderInclude,
    });

    if (!supplierOrder) {
      throw new NotFoundException('Supplier order not found');
    }

    await this.assertDealAccessOrNotFound(
      supplierOrder.dealId,
      user,
      'Supplier order not found',
    );

    return supplierOrder;
  }

  async updateDates(
    id: string,
    dto: UpdateSupplierOrderDatesDto,
    user: CurrentUser,
  ): Promise<SupplierOrderWithSupplier> {
    this.assertManageAllowed(user);

    const supplierOrder = await this.requireAccessibleOrder(id, user);

    if (
      supplierOrder.status === SupplierOrderStatus.DELIVERED ||
      supplierOrder.status === SupplierOrderStatus.CANCELLED
    ) {
      throw new BadRequestException(
        `Cannot change planned dates in status ${supplierOrder.status}`,
      );
    }

    const nextDates = {
      orderedAt: supplierOrder.orderedAt,
      expectedReadyAt: dto.expectedReadyAt ?? supplierOrder.expectedReadyAt,
      expectedShipmentAt:
        dto.expectedShipmentAt ?? supplierOrder.expectedShipmentAt,
      expectedArrivalAt:
        dto.expectedArrivalAt ?? supplierOrder.expectedArrivalAt,
    };
    this.assertTimelineDates(nextDates);

    const dateChanged =
      (dto.expectedReadyAt !== undefined &&
        !sameInstant(dto.expectedReadyAt, supplierOrder.expectedReadyAt)) ||
      (dto.expectedShipmentAt !== undefined &&
        !sameInstant(
          dto.expectedShipmentAt,
          supplierOrder.expectedShipmentAt,
        )) ||
      (dto.expectedArrivalAt !== undefined &&
        !sameInstant(dto.expectedArrivalAt, supplierOrder.expectedArrivalAt));
    const commentChanged =
      dto.comment !== undefined &&
      (dto.comment.trim() || null) !== supplierOrder.comment;

    if (!dateChanged && !commentChanged) {
      return this.prisma.supplierOrder.findUniqueOrThrow({
        where: { id },
        include: supplierOrderInclude,
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.supplierOrder.update({
        where: { id },
        data: {
          expectedReadyAt: nextDates.expectedReadyAt,
          expectedShipmentAt: nextDates.expectedShipmentAt,
          expectedArrivalAt: nextDates.expectedArrivalAt,
          ...(dto.comment !== undefined
            ? { comment: dto.comment.trim() || null }
            : {}),
        },
        include: supplierOrderInclude,
      });

      if (dateChanged) {
        await tx.activity.create({
          data: {
            authorId: user.id,
            relatedType: 'Deal',
            relatedId: supplierOrder.dealId,
            type: ActivityType.NOTE,
            content: 'Supplier order planned dates changed',
            metadata: {
              action: 'supplier_order_dates_changed',
              supplierOrderId: id,
            },
          },
        });

        await tx.auditLog.create({
          data: {
            userId: user.id,
            action: 'SUPPLIER_ORDER_DATES_CHANGED',
            entityType: 'SupplierOrder',
            entityId: id,
            oldValue: {
              expectedReadyAt: toIso(supplierOrder.expectedReadyAt),
              expectedShipmentAt: toIso(supplierOrder.expectedShipmentAt),
              expectedArrivalAt: toIso(supplierOrder.expectedArrivalAt),
            },
            newValue: {
              expectedReadyAt: toIso(updated.expectedReadyAt),
              expectedShipmentAt: toIso(updated.expectedShipmentAt),
              expectedArrivalAt: toIso(updated.expectedArrivalAt),
            },
          },
        });
      }

      return updated;
    });
  }

  async confirmReady(
    id: string,
    user: CurrentUser,
  ): Promise<SupplierOrderWithSupplier> {
    this.assertManageAllowed(user);

    const supplierOrder = await this.requireAccessibleOrder(id, user);

    if (supplierOrder.readyConfirmedAt) {
      return this.prisma.supplierOrder.findUniqueOrThrow({
        where: { id },
        include: supplierOrderInclude,
      });
    }

    if (!READY_CONFIRMABLE_STATUSES.includes(supplierOrder.status)) {
      throw new BadRequestException(
        `Cannot confirm readiness in status ${supplierOrder.status}`,
      );
    }

    const confirmedAt = new Date();

    const claimed = await this.prisma.$transaction(async (tx) => {
      const result = await tx.supplierOrder.updateMany({
        where: {
          id,
          readyConfirmedAt: null,
          status: { in: READY_CONFIRMABLE_STATUSES },
        },
        data: {
          status: SupplierOrderStatus.READY_FOR_SHIPMENT,
          readyConfirmedAt: confirmedAt,
          readyConfirmedById: user.id,
        },
      });

      if (result.count !== 1) {
        return null;
      }

      await tx.activity.create({
        data: {
          authorId: user.id,
          relatedType: 'Deal',
          relatedId: supplierOrder.dealId,
          type: ActivityType.SUPPLIER_ORDER_STATUS_CHANGED,
          content: `Supplier goods ready confirmed (${supplierOrder.status} → ${SupplierOrderStatus.READY_FOR_SHIPMENT})`,
          metadata: {
            action: 'supplier_order_ready_confirmed',
            supplierOrderId: id,
            oldStatus: supplierOrder.status,
            newStatus: SupplierOrderStatus.READY_FOR_SHIPMENT,
          },
        },
      });

      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: 'SUPPLIER_ORDER_READY_CONFIRMED',
          entityType: 'SupplierOrder',
          entityId: id,
          oldValue: {
            status: supplierOrder.status,
            readyConfirmedAt: null,
            readyConfirmedById: null,
          },
          newValue: {
            status: SupplierOrderStatus.READY_FOR_SHIPMENT,
            readyConfirmedAt: confirmedAt.toISOString(),
            readyConfirmedById: user.id,
          },
        },
      });

      return tx.supplierOrder.findUniqueOrThrow({
        where: { id },
        include: supplierOrderInclude,
      });
    });

    if (claimed) {
      return claimed;
    }

    const latest = await this.prisma.supplierOrder.findUnique({
      where: { id },
      include: supplierOrderInclude,
    });

    if (latest?.readyConfirmedAt) {
      return latest;
    }

    throw new ConflictException('Supplier order readiness was not confirmed');
  }

  async confirmClientDelivery(
    id: string,
    user: CurrentUser,
  ): Promise<SupplierOrderWithSupplier> {
    this.assertClientDeliveryAllowed(user);

    const supplierOrder = await this.requireAccessibleOrder(id, user);

    if (supplierOrder.status === SupplierOrderStatus.CANCELLED) {
      throw new BadRequestException(
        'Cannot confirm client delivery for a cancelled supplier order',
      );
    }

    if (supplierOrder.status === SupplierOrderStatus.DELIVERED) {
      await this.dealCompletion.tryFinalizeDeal(supplierOrder.dealId, user.id);
      return this.prisma.supplierOrder.findUniqueOrThrow({
        where: { id },
        include: supplierOrderInclude,
      });
    }

    if (supplierOrder.status !== SupplierOrderStatus.SHIPPED) {
      throw new BadRequestException(CLIENT_DELIVERY_NOT_SHIPPED_MESSAGE);
    }

    const deliveredAt = new Date();

    const claimed = await this.prisma.$transaction(async (tx) => {
      await this.dealCompletion.lockFulfillmentRows(tx, supplierOrder.dealId);
      await this.assertDealPaidForShipment(tx, supplierOrder.dealId);

      const result = await tx.supplierOrder.updateMany({
        where: {
          id,
          status: SupplierOrderStatus.SHIPPED,
        },
        data: {
          status: SupplierOrderStatus.DELIVERED,
          deliveredAt,
          deliveredById: user.id,
        },
      });

      if (result.count !== 1) {
        return null;
      }

      await tx.activity.create({
        data: {
          authorId: user.id,
          relatedType: 'Deal',
          relatedId: supplierOrder.dealId,
          type: ActivityType.CLIENT_DELIVERY_CONFIRMED,
          content: 'Client delivery confirmed',
          metadata: {
            action: 'client_delivery_confirmed',
            supplierOrderId: id,
            oldStatus: SupplierOrderStatus.SHIPPED,
            newStatus: SupplierOrderStatus.DELIVERED,
          },
        },
      });

      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: FULFILLMENT_AUDIT.CLIENT_DELIVERY_CONFIRMED,
          entityType: 'SupplierOrder',
          entityId: id,
          oldValue: {
            status: SupplierOrderStatus.SHIPPED,
            deliveredAt: null,
            deliveredById: null,
          },
          newValue: {
            status: SupplierOrderStatus.DELIVERED,
            deliveredAt: deliveredAt.toISOString(),
            deliveredById: user.id,
          },
        },
      });

      await this.dealCompletion.tryFinalize(tx, supplierOrder.dealId, user.id);

      return tx.supplierOrder.findUniqueOrThrow({
        where: { id },
        include: supplierOrderInclude,
      });
    });

    if (claimed) {
      return claimed;
    }

    const latest = await this.prisma.supplierOrder.findUnique({
      where: { id },
      include: supplierOrderInclude,
    });

    if (latest?.status === SupplierOrderStatus.DELIVERED) {
      await this.dealCompletion.tryFinalizeDeal(supplierOrder.dealId, user.id);
      return latest;
    }

    throw new ConflictException('Client delivery was not confirmed');
  }

  async updateStatus(
    id: string,
    status: SupplierOrderStatus,
    user: CurrentUser,
  ): Promise<SupplierOrder> {
    this.assertManageAllowed(user);

    const supplierOrder = await this.requireAccessibleOrder(id, user);

    if (status === SupplierOrderStatus.DELIVERED) {
      return this.confirmClientDelivery(id, user);
    }

    if (status === supplierOrder.status) {
      return supplierOrder;
    }

    const allowed =
      SUPPLIER_ORDER_STATUS_TRANSITIONS[supplierOrder.status] ?? [];
    if (!allowed.includes(status)) {
      throw new BadRequestException(
        `Cannot change supplier order from ${supplierOrder.status} to ${status}`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const isNewClientShipment =
        isClientShipmentSupplierStatus(status) &&
        status !== supplierOrder.status;

      if (isNewClientShipment) {
        await this.assertDealPaidForShipment(tx, supplierOrder.dealId);
      }

      const claimed = await tx.supplierOrder.updateMany({
        where: { id, status: supplierOrder.status },
        data: { status },
      });

      if (claimed.count === 0) {
        const latest = await tx.supplierOrder.findUnique({ where: { id } });
        if (latest?.status === status) {
          return latest;
        }
        throw new ConflictException(
          'Supplier order status changed concurrently',
        );
      }

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

      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: 'SUPPLIER_ORDER_STATUS_CHANGED',
          entityType: 'SupplierOrder',
          entityId: id,
          oldValue: { status: supplierOrder.status },
          newValue: { status },
        },
      });

      return tx.supplierOrder.findUniqueOrThrow({ where: { id } });
    });
  }

  async processReadinessReminders(now = new Date()): Promise<number> {
    const today = startOfUtcDay(now);
    const orders = await this.prisma.supplierOrder.findMany({
      where: {
        expectedReadyAt: { not: null },
        readyConfirmedAt: null,
        status: { notIn: READINESS_REMINDER_STOP_STATUSES },
      },
      select: {
        id: true,
        expectedReadyAt: true,
      },
    });

    if (orders.length === 0) {
      return 0;
    }

    const recipients = await this.resolveHeadDirectorUserIds();
    if (recipients.length === 0) {
      return 0;
    }

    let created = 0;
    for (const order of orders) {
      created += await this.emitReadinessRemindersForOrder(
        order.id,
        order.expectedReadyAt as Date,
        today,
        recipients,
      );
    }

    return created;
  }

  private async emitReadinessRemindersForOrder(
    supplierOrderId: string,
    expectedReadyAt: Date,
    today: Date,
    recipientIds: string[],
  ): Promise<number> {
    const dueDate = startOfUtcDay(expectedReadyAt);
    const softDate = addUtcDays(dueDate, -2);
    let created = 0;

    if (today.getTime() === softDate.getTime()) {
      created += await this.claimAndNotify({
        supplierOrderId,
        kind: SUPPLIER_ORDER_REMINDER_KIND.SOFT,
        reminderDate: today,
        recipientIds,
        type: SUPPLIER_ORDER_REMINDER_TYPE.SOFT,
        title: 'Supplier production ready soon',
        message: `Supplier order is expected ready in 2 days`,
      });
    }

    if (today.getTime() === dueDate.getTime()) {
      created += await this.claimAndNotify({
        supplierOrderId,
        kind: SUPPLIER_ORDER_REMINDER_KIND.DUE,
        reminderDate: today,
        recipientIds,
        type: SUPPLIER_ORDER_REMINDER_TYPE.DUE,
        title: 'Supplier production ready today',
        message: `Supplier order expected ready date is today`,
      });
    }

    if (today.getTime() > dueDate.getTime()) {
      created += await this.claimAndNotify({
        supplierOrderId,
        kind: SUPPLIER_ORDER_REMINDER_KIND.OVERDUE,
        reminderDate: today,
        recipientIds,
        type: SUPPLIER_ORDER_REMINDER_TYPE.OVERDUE,
        title: 'Supplier production overdue',
        message: `Supplier order expected ready date has passed`,
      });
    }

    return created;
  }

  private async claimAndNotify(input: {
    supplierOrderId: string;
    kind: SupplierOrderReminderKind;
    reminderDate: Date;
    recipientIds: string[];
    type: string;
    title: string;
    message: string;
  }): Promise<number> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.supplierOrderReminderClaim.create({
          data: {
            supplierOrderId: input.supplierOrderId,
            kind: input.kind,
            reminderDate: input.reminderDate,
          },
        });

        await tx.notification.createMany({
          data: input.recipientIds.map((userId) => ({
            userId,
            title: input.title,
            message: input.message,
            type: input.type,
            relatedType: SUPPLIER_ORDER_RELATED_TYPE,
            relatedId: input.supplierOrderId,
          })),
        });
      });

      return input.recipientIds.length;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return 0;
      }

      throw error;
    }
  }

  private async resolveHeadDirectorUserIds(): Promise<string[]> {
    const users = await this.prisma.user.findMany({
      where: {
        isActive: true,
        roles: {
          some: {
            role: {
              name: { in: [RoleName.HEAD, RoleName.DIRECTOR] },
            },
          },
        },
      },
      select: { id: true },
    });

    return users.map((user) => user.id);
  }

  private assertManageAllowed(user: CurrentUser): void {
    if (user.permissions.includes(SUPPLIER_ORDER_PERMISSIONS.MANAGE)) {
      return;
    }

    throw new ForbiddenException(CLIENT_SHIPMENT_FORBIDDEN_MESSAGE);
  }

  private assertClientDeliveryAllowed(user: CurrentUser): void {
    if (
      hasAnyRole(user, [RoleName.MANAGER, RoleName.HEAD, RoleName.DIRECTOR])
    ) {
      return;
    }

    throw new ForbiddenException(CLIENT_DELIVERY_FORBIDDEN_MESSAGE);
  }

  private assertHplDealReadyForSupplierOrder(
    quotes: Array<{
      status: string;
      clientAcceptedAt: Date | null;
    }>,
  ): void {
    if (quotes.length === 0) {
      throw new ConflictException(
        'Supplier order requires an HPL Deal with an originating Quote',
      );
    }

    const accepted = quotes.find((quote) => {
      const internallyApproved =
        quote.status === QUOTE_STATUS.APPROVED ||
        quote.status === QUOTE_STATUS.CONVERTED;
      return internallyApproved && quote.clientAcceptedAt !== null;
    });

    if (!accepted) {
      throw new ConflictException(
        'Supplier order requires an internally approved Quote with recorded client acceptance',
      );
    }
  }

  private assertTimelineDates(dates: {
    orderedAt?: Date | null;
    expectedReadyAt?: Date | null;
    expectedShipmentAt?: Date | null;
    expectedArrivalAt?: Date | null;
  }): void {
    const orderedAt = dates.orderedAt ?? null;
    const expectedReadyAt = dates.expectedReadyAt ?? null;
    const expectedShipmentAt = dates.expectedShipmentAt ?? null;
    const expectedArrivalAt = dates.expectedArrivalAt ?? null;

    if (orderedAt && expectedReadyAt && expectedReadyAt < orderedAt) {
      throw new BadRequestException(
        'expectedReadyAt must not precede orderedAt',
      );
    }

    const readyOrOrdered = expectedReadyAt ?? orderedAt;
    if (
      readyOrOrdered &&
      expectedShipmentAt &&
      expectedShipmentAt < readyOrOrdered
    ) {
      throw new BadRequestException(
        'expectedShipmentAt must not precede the ready or order date',
      );
    }

    if (
      expectedShipmentAt &&
      expectedArrivalAt &&
      expectedArrivalAt < expectedShipmentAt
    ) {
      throw new BadRequestException(
        'expectedArrivalAt must not precede expectedShipmentAt',
      );
    }

    if (
      !expectedShipmentAt &&
      readyOrOrdered &&
      expectedArrivalAt &&
      expectedArrivalAt < readyOrOrdered
    ) {
      throw new BadRequestException(
        'expectedArrivalAt must not precede the ready or order date',
      );
    }
  }

  private async requireAccessibleOrder(
    id: string,
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

function startOfUtcDay(value: Date): Date {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
  );
}

function addUtcDays(value: Date, days: number): Date {
  const next = new Date(value.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function sameInstant(
  left: Date | null | undefined,
  right: Date | null | undefined,
): boolean {
  if (!left && !right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return left.getTime() === right.getTime();
}
