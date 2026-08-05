import { DealStage } from '@prisma/client';
export declare class FilterDealDto {
    stage?: DealStage;
    clientId?: string;
    ownerId?: string;
    projectObjectId?: string;
    search?: string;
    page?: number;
    limit?: number;
}
