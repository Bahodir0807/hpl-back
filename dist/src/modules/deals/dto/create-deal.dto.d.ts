import { CreateDealItemDto } from './create-deal-item.dto';
export declare class CreateDealDto {
    title: string;
    clientId: string;
    projectObjectId?: string;
    ownerId?: string;
    expectedCloseDate?: Date;
    items?: CreateDealItemDto[];
}
