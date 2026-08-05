import { AuditService } from './audit.service';
export declare class AuditController {
    private readonly auditService;
    constructor(auditService: AuditService);
    getTimeline(relatedType: string, relatedId: string): Promise<{
        id: string;
        createdAt: Date;
        authorId: string;
        relatedType: string;
        relatedId: string;
        type: import("@prisma/client").$Enums.ActivityType;
        content: string | null;
        metadata: import("@prisma/client/runtime/client").JsonValue | null;
    }[]>;
}
