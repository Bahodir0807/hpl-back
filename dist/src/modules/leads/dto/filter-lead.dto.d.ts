import { LeadStatus } from '@prisma/client';
export declare class FilterLeadDto {
    search?: string;
    status?: LeadStatus;
    source?: string;
    ownerId?: string;
    page?: number;
    limit?: number;
}
