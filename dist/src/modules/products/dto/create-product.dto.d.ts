import { ProductPriceType, ProductStatus } from '@prisma/client';
export declare class InitialProductPriceDto {
    type: ProductPriceType;
    amount: number;
    validFrom?: Date;
}
export declare class CreateProductDto {
    sku: string;
    name: string;
    brandId: string;
    collectionId?: string;
    supplierId?: string;
    decorCode?: string;
    colorName?: string;
    surface?: string;
    thickness: number;
    length: number;
    width: number;
    unit?: string;
    status?: ProductStatus;
    initialPrices?: InitialProductPriceDto[];
}
