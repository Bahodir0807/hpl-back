import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Activity,
  ActivityType,
  AuditLog,
  Prisma,
  RoleName,
} from '@prisma/client';
import type { CurrentUser } from '../../common/interfaces/current-user.interface';
import { PrismaService } from '../prisma/prisma.service';

type JsonRecord = Record<string, unknown>;

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async logActivity(
    authorId: string,
    relatedType: string,
    relatedId: string,
    type: ActivityType,
    content?: string,
    metadata?: JsonRecord,
  ): Promise<Activity> {
    return this.prisma.activity.create({
      data: {
        authorId,
        relatedType,
        relatedId,
        type,
        content,
        metadata: metadata as Prisma.InputJsonValue | undefined,
      },
    });
  }

  async logAudit(
    userId: string | null,
    action: string,
    entityType: string,
    entityId: string,
    oldValue?: unknown,
    newValue?: unknown,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<AuditLog> {
    return this.prisma.auditLog.create({
      data: {
        userId,
        action,
        entityType,
        entityId,
        oldValue: oldValue as Prisma.InputJsonValue | undefined,
        newValue: newValue as Prisma.InputJsonValue | undefined,
        ipAddress,
        userAgent,
      },
    });
  }

  async getTimeline(
    relatedType: string,
    relatedId: string,
    user: CurrentUser,
  ): Promise<Activity[]> {
    await this.assertTimelineAccess(relatedType, relatedId, user);

    return this.prisma.activity.findMany({
      where: {
        relatedType,
        relatedId,
      },
      include: {
        author: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async assertTimelineAccess(
    relatedType: string,
    relatedId: string,
    user: CurrentUser,
  ): Promise<void> {
    if (
      user.roles.includes(RoleName.ADMIN) ||
      user.roles.includes(RoleName.HEAD)
    ) {
      return;
    }

    switch (relatedType) {
      case 'Lead': {
        const lead = await this.prisma.lead.findFirst({
          where: { id: relatedId, deletedAt: null },
          select: { ownerId: true },
        });

        if (!lead) {
          throw new NotFoundException('Lead not found');
        }

        this.assertOwnerOrReadAll(
          lead.ownerId,
          user,
          'leads:read_all',
          'Access to this lead timeline is forbidden',
        );
        return;
      }
      case 'Deal': {
        const deal = await this.prisma.deal.findFirst({
          where: { id: relatedId, deletedAt: null },
          select: { ownerId: true },
        });

        if (!deal) {
          throw new NotFoundException('Deal not found');
        }

        this.assertOwnerOrReadAll(
          deal.ownerId,
          user,
          'deals:read_all',
          'Access to this deal timeline is forbidden',
        );
        return;
      }
      case 'Client': {
        const client = await this.prisma.client.findFirst({
          where: { id: relatedId, deletedAt: null },
          select: { ownerId: true },
        });

        if (!client) {
          throw new NotFoundException('Client not found');
        }

        this.assertOwnerOrReadAll(
          client.ownerId,
          user,
          'clients:read_all',
          'Access to this client timeline is forbidden',
        );
        return;
      }
      case 'Task': {
        const task = await this.prisma.task.findUnique({
          where: { id: relatedId },
          select: { assigneeId: true, createdById: true },
        });

        if (!task) {
          throw new NotFoundException('Task not found');
        }

        if (
          user.permissions.includes('tasks:read_all') ||
          task.assigneeId === user.id ||
          task.createdById === user.id
        ) {
          return;
        }

        throw new ForbiddenException(
          'Access to this task timeline is forbidden',
        );
      }
      case 'Order': {
        const order = await this.prisma.order.findFirst({
          where: { id: relatedId, deletedAt: null },
          select: { deal: { select: { ownerId: true } } },
        });

        if (!order) {
          throw new NotFoundException('Order not found');
        }

        this.assertOwnerOrReadAll(
          order.deal.ownerId,
          user,
          'deals:read_all',
          'Access to this order timeline is forbidden',
        );
        return;
      }
      default:
        throw new NotFoundException('Timeline not found');
    }
  }

  private assertOwnerOrReadAll(
    ownerId: string,
    user: CurrentUser,
    readAllPermission: string,
    forbiddenMessage: string,
  ): void {
    if (user.permissions.includes(readAllPermission) || ownerId === user.id) {
      return;
    }

    throw new ForbiddenException(forbiddenMessage);
  }
}
