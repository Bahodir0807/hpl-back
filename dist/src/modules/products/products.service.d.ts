import { Product, ProductPrice, ProductPriceType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { FilterProductDto } from './dto/filter-product.dto';
import { SetProductPriceDto } from './dto/set-product-price.dto';
import { UpdateProductDto } from './dto/update-product.dto';
type ProductWithPrices = Product & {
    prices: ProductPrice[];
};
type ProductListResult = {
    items: ProductWithPrices[];
    total: number;
    page: number;
    limit: number;
};
export declare class ProductsService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    create(dto: CreateProductDto): Promise<ProductWithPrices>;
    findAll(filterDto: FilterProductDto, userPermissions: string[]): Promise<ProductListResult>;
    findOne(id: string, userPermissions: string[]): Promise<ProductWithPrices>;
    update(id: string, dto: UpdateProductDto): Promise<ProductWithPrices>;
    setPrice(productId: string, dto: SetProductPriceDto): Promise<ProductPrice>;
    getActualPrice(productId: string, type: ProductPriceType): Promise<ProductPrice | null>;
    softDelete(id: string): Promise<Product>;
    private calculateSheetArea;
    private buildProductWhere;
    private buildPriceFilter;
    private hidePurchasePricesIfNeeded;
    private canReadPurchasePrice;
    private ensureProductExists;
    private productIncludeWithPrices;
}
export {};
