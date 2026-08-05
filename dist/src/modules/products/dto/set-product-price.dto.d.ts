import { ProductPriceType } from '@prisma/client';
export declare class SetProductPriceDto {
    type: ProductPriceType;
    amount: number;
    currency?: string;
    validFrom: Date;
    validTo?: Date;
}
