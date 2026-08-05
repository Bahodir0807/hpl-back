import { Activity, ActivityType, AuditLog } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
type JsonRecord = Record<string, unknown>;
export declare class AuditService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    logActivity(authorId: string, relatedType: string, relatedId: string, type: ActivityType, content?: string, metadata?: JsonRecord): Promise<Activity>;
    logAudit(userId: string | null, action: string, entityType: string, entityId: string, oldValue?: unknown, newValue?: unknown, ipAddress?: string, userAgent?: string): Promise<AuditLog>;
    getTimeline(relatedType: string, relatedId: string): Promise<Activity[]>;
}
export {};
