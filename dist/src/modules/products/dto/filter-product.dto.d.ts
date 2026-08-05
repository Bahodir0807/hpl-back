import { ProductStatus } from '@prisma/client';
export declare class FilterProductDto {
    search?: string;
    brandId?: string;
    collectionId?: string;
    supplierId?: string;
    status?: ProductStatus;
    decorCode?: string;
    colorName?: string;
    surface?: string;
    thickness?: number;
    minPrice?: number;
    maxPrice?: number;
    page?: number;
    limit?: number;
}
