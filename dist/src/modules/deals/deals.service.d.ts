import { Deal, DealOffer, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ChangeStageDto } from './dto/change-stage.dto';
import { CreateDealDto } from './dto/create-deal.dto';
import { CreateOfferDto } from './dto/create-offer.dto';
import { FilterDealDto } from './dto/filter-deal.dto';
import { SetDealItemsDto } from './dto/set-deal-items.dto';
import { UpdateDealDto } from './dto/update-deal.dto';
declare const dealDetailsInclude: {
    client: true;
    projectObject: true;
    owner: true;
    items: {
        include: {
            product: true;
        };
    };
    offers: {
        orderBy: {
            version: "desc";
        };
    };
    stageHistory: {
        include: {
            changedBy: true;
            approvedBy: true;
        };
        orderBy: {
            createdAt: "desc";
        };
    };
    order: true;
};
declare const dealListInclude: {
    client: true;
    projectObject: true;
    owner: true;
    items: {
        include: {
            product: true;
        };
    };
    offers: {
        orderBy: {
            version: "desc";
        };
    };
};
type DealDetails = Prisma.DealGetPayload<{
    include: typeof dealDetailsInclude;
}>;
type DealListItem = Prisma.DealGetPayload<{
    include: typeof dealListInclude;
}>;
type DealListResult = {
    items: DealListItem[];
    total: number;
    page: number;
    limit: number;
};
export declare class DealsService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    create(dto: CreateDealDto, currentUserId: string): Promise<DealDetails>;
    findAll(filterDto: FilterDealDto, currentUserId: string, permissions: string[]): Promise<DealListResult>;
    findOne(id: string): Promise<DealDetails>;
    update(id: string, dto: UpdateDealDto): Promise<DealDetails>;
    setItems(dealId: string, dto: SetDealItemsDto): Promise<DealDetails>;
    changeStage(id: string, dto: ChangeStageDto, currentUserId: string, permissions: string[]): Promise<DealDetails>;
    addOffer(dealId: string, dto: CreateOfferDto): Promise<DealOffer>;
    approveOffer(dealId: string, offerId: string): Promise<DealOffer>;
    softDelete(id: string): Promise<Deal>;
    syncNextActionDate(dealId: string): Promise<Deal>;
    private buildDealWhere;
    private calculateDealItems;
    private calculateTotals;
    private getStageTransitionViolations;
    private assertStageExceptionAllowed;
    private ensureOpenTaskForActiveDeal;
    private updateDealNextActionAt;
    private getNextOpenTaskDueDate;
    private buildOfferNumber;
    private isActiveStage;
    private ensureDealExists;
}
export {};
