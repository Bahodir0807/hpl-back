import { Injectable } from '@nestjs/common';
import {
  ActivityType,
  DealStage,
  InstallationStatus,
  OrderStatus,
  Prisma,
  RoleName,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { evaluateDealCompletion } from './deal-completion.rules';
import {
  FULFILLMENT_AUDIT,
  FULFILLMENT_NOTIFICATION,
} from './deal-fulfillment.constants';

const dealCompletionInclude = Prisma.validator<Prisma.DealInclude>()({
  order: {
    select: {
      id: true,
      status: true,
      paymentStatus: true,
      deletedAt: true,
    },
  },
  supplierOrders: {
    select: { id: true, status: true },
  },
  installation: {
    select: {
      id: true,
      completedAt: true,
      supervisorConfirmedById: true,
    },
  },
});

type DealCompletionRow = Prisma.DealGetPayload<{
  include: typeof dealCompletionInclude;
}>;

@Injectable()
export class DealCompletionService {
  constructor(private readonly prisma: PrismaService) {}

  async lockFulfillmentRows(
    tx: Prisma.TransactionClient,
    dealId: string,
  ): Promise<void> {
    await tx.deal.update({
      where: { id: dealId },
      data: { updatedAt: new Date() },
    });

    const order = await tx.order.findFirst({
      where: { dealId, deletedAt: null },
      select: { id: true },
    });

    if (order) {
      await tx.order.update({
        where: { id: order.id },
        data: { updatedAt: new Date() },
      });
    }
  }

  async tryFinalize(
    tx: Prisma.TransactionClient,
    dealId: string,
    actorUserId: string,
  ): Promise<{ completed: boolean }> {
    await this.lockFulfillmentRows(tx, dealId);

    const deal = await tx.deal.findFirst({
      where: { id: dealId, deletedAt: null },
      include: dealCompletionInclude,
    });

    if (!deal) {
      return { completed: false };
    }

    const evaluation = evaluateDealCompletion(this.toSnapshot(deal));

    if (evaluation.canCompleteInstallation && deal.installation) {
      await tx.dealInstallation.updateMany({
        where: {
          id: deal.installation.id,
          completedAt: null,
        },
        data: {
          status: InstallationStatus.COMPLETED,
          completedAt: new Date(),
        },
      });
    }

    if (!evaluation.canCompleteDeal) {
      return { completed: false };
    }

    const completedAt = new Date();
    const claimed = await tx.deal.updateMany({
      where: {
        id: dealId,
        completedAt: null,
        deletedAt: null,
        stage: DealStage.WON,
      },
      data: { completedAt },
    });

    if (claimed.count !== 1) {
      return { completed: false };
    }

    if (
      deal.order &&
      !deal.order.deletedAt &&
      deal.order.status !== OrderStatus.CANCELLED &&
      deal.order.status !== OrderStatus.COMPLETED
    ) {
      await tx.order.updateMany({
        where: {
          id: deal.order.id,
          deletedAt: null,
          status: { notIn: [OrderStatus.CANCELLED, OrderStatus.COMPLETED] },
        },
        data: {
          status: OrderStatus.COMPLETED,
          version: { increment: 1 },
        },
      });
    }

    await tx.activity.create({
      data: {
        authorId: actorUserId,
        relatedType: 'Deal',
        relatedId: dealId,
        type: ActivityType.DEAL_COMPLETED,
        content: 'Deal operational obligations completed',
        metadata: {
          action: 'deal_completed',
          completedAt: completedAt.toISOString(),
        },
      },
    });

    await tx.auditLog.create({
      data: {
        userId: actorUserId,
        action: FULFILLMENT_AUDIT.DEAL_COMPLETED,
        entityType: 'Deal',
        entityId: dealId,
        newValue: {
          completedAt: completedAt.toISOString(),
          orderStatus: OrderStatus.COMPLETED,
        },
      },
    });

    await this.notifyDealCompleted(tx, deal, completedAt);

    return { completed: true };
  }

  async tryFinalizeDeal(
    dealId: string,
    actorUserId: string,
  ): Promise<{ completed: boolean }> {
    return this.prisma.$transaction((tx) =>
      this.tryFinalize(tx, dealId, actorUserId),
    );
  }

  private toSnapshot(deal: DealCompletionRow) {
    return {
      stage: deal.stage,
      completedAt: deal.completedAt,
      paymentStatus: deal.order?.deletedAt ? null : deal.order?.paymentStatus,
      fulfillmentSource: deal.fulfillmentSource,
      orderStatus: deal.order?.deletedAt ? null : deal.order?.status,
      supplierOrderStatuses: deal.supplierOrders.map((order) => order.status),
      installationRequired: deal.installationRequiredSnapshot,
      supervisorConfirmedById: deal.installation?.supervisorConfirmedById,
      installationCompletedAt: deal.installation?.completedAt,
    };
  }

  private async notifyDealCompleted(
    tx: Prisma.TransactionClient,
    deal: DealCompletionRow,
    completedAt: Date,
  ): Promise<void> {
    const heads = await tx.user.findMany({
      where: {
        isActive: true,
        roles: { some: { role: { name: RoleName.HEAD } } },
      },
      select: { id: true },
    });
    const recipientIds = uniqueIds([
      deal.ownerId,
      ...heads.map((user) => user.id),
    ]);

    if (recipientIds.length === 0) {
      return;
    }

    await tx.notification.createMany({
      data: recipientIds.map((userId) => ({
        userId,
        title: 'Deal completed',
        message: `Deal operational completion was recorded at ${completedAt.toISOString()}`,
        type: FULFILLMENT_NOTIFICATION.DEAL_COMPLETED,
        relatedType: 'Deal',
        relatedId: deal.id,
      })),
    });
  }
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids)];
}
