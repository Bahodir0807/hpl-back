import { DealStage } from '@prisma/client';
export declare class ChangeStageDto {
    newStage: DealStage;
    reason?: string;
    lossReason?: string;
    competitorName?: string;
    isException?: boolean;
}
