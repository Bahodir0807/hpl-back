import { ClientSegment, ClientStatus } from '@prisma/client';
export declare class FilterClientDto {
    search?: string;
    status?: ClientStatus;
    segment?: ClientSegment;
    region?: string;
    ownerId?: string;
    page?: number;
    limit?: number;
}
