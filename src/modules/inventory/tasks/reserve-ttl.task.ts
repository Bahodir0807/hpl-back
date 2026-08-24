import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ActivityType, OrderStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from '../inventory.service';

const RESERVE_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const AUTO_CANCEL_COMMENT = 'Автоматическая отмена: истек TTL резерва (3 дня)';

@Injectable()
export class ReserveTtlTask {
  private readonly logger = new Logger(ReserveTtlTask.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventoryService: InventoryService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async cancelExpiredWaitingPaymentOrders(): Promise<void> {
    const cutoff = new Date(Date.now() - RESERVE_TTL_MS);

    const expiredOrders = await this.prisma.order.findMany({
      where: {
        status: OrderStatus.WAITING_PAYMENT,
        deletedAt: null,
        createdAt: { lt: cutoff },
      },
      include: {
        deal: { select: { ownerId: true } },
      },
    });

    if (expiredOrders.length === 0) {
      return;
    }

    for (const order of expiredOrders) {
      try {
        await this.prisma.$transaction(async (tx) => {
          const current = await tx.order.findFirst({
            where: {
              id: order.id,
              status: OrderStatus.WAITING_PAYMENT,
              deletedAt: null,
            },
          });

          if (!current) {
            return;
          }

          await this.inventoryService.releaseReservation(
            order.id,
            tx,
            order.deal.ownerId,
          );

          const updated = await tx.order.updateMany({
            where: { id: order.id, version: current.version },
            data: {
              status: OrderStatus.CANCELLED,
              version: { increment: 1 },
            },
          });

          if (updated.count === 0) {
            return;
          }

          await tx.activity.create({
            data: {
              authorId: order.deal.ownerId,
              relatedType: 'Order',
              relatedId: order.id,
              type: ActivityType.STATUS_CHANGED,
              content: AUTO_CANCEL_COMMENT,
              metadata: {
                previousStatus: OrderStatus.WAITING_PAYMENT,
                newStatus: OrderStatus.CANCELLED,
                reason: 'RESERVE_TTL_EXPIRED',
              },
            },
          });

          await tx.auditLog.create({
            data: {
              action: 'ORDER_AUTO_CANCELLED_RESERVE_TTL',
              entityType: 'Order',
              entityId: order.id,
              oldValue: { status: OrderStatus.WAITING_PAYMENT },
              newValue: {
                status: OrderStatus.CANCELLED,
                comment: AUTO_CANCEL_COMMENT,
              },
            },
          });
        });

        this.logger.log(`Auto-cancelled order ${order.id} after reserve TTL`);
      } catch (error) {
        this.logger.error(
          `Failed to auto-cancel order ${order.id} after reserve TTL`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }
  }
}
