import { Injectable } from '@nestjs/common';
import { Activity, ActivityType, AuditLog, Prisma } from '@prisma/client';
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
  ): Promise<Activity[]> {
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
}
