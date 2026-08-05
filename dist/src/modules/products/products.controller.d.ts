import type { CurrentUser as CurrentUserType } from '../../common/interfaces/current-user.interface';
import { CreateProductDto } from './dto/create-product.dto';
import { FilterProductDto } from './dto/filter-product.dto';
import { SetProductPriceDto } from './dto/set-product-price.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductsService } from './products.service';
export declare class ProductsController {
    private readonly productsService;
    constructor(productsService: ProductsService);
    create(dto: CreateProductDto): Promise<{
        length: number;
        id: string;
        name: string;
        createdAt: Date;
        updatedAt: Date;
        brandId: string;
        sku: string;
        collectionId: string | null;
        supplierId: string | null;
        decorCode: string | null;
        colorName: string | null;
        surface: string | null;
        thickness: number;
        width: number;
        unit: string;
        sheetArea: number;
        status: import("@prisma/client").$Enums.ProductStatus;
        deletedAt: Date | null;
    } & {
        prices: import("@prisma/client").ProductPrice[];
    }>;
    findAll(filterDto: FilterProductDto, user: CurrentUserType): Promise<{
        items: ({
            length: number;
            id: string;
            name: string;
            createdAt: Date;
            updatedAt: Date;
            brandId: string;
            sku: string;
            collectionId: string | null;
            supplierId: string | null;
            decorCode: string | null;
            colorName: string | null;
            surface: string | null;
            thickness: number;
            width: number;
            unit: string;
            sheetArea: number;
            status: import("@prisma/client").$Enums.ProductStatus;
            deletedAt: Date | null;
        } & {
            prices: import("@prisma/client").ProductPrice[];
        })[];
        total: number;
        page: number;
        limit: number;
    }>;
    findOne(id: string, user: CurrentUserType): Promise<{
        length: number;
        id: string;
        name: string;
        createdAt: Date;
        updatedAt: Date;
        brandId: string;
        sku: string;
        collectionId: string | null;
        supplierId: string | null;
        decorCode: string | null;
        colorName: string | null;
        surface: string | null;
        thickness: number;
        width: number;
        unit: string;
        sheetArea: number;
        status: import("@prisma/client").$Enums.ProductStatus;
        deletedAt: Date | null;
    } & {
        prices: import("@prisma/client").ProductPrice[];
    }>;
    update(id: string, dto: UpdateProductDto): Promise<{
        length: number;
        id: string;
        name: string;
        createdAt: Date;
        updatedAt: Date;
        brandId: string;
        sku: string;
        collectionId: string | null;
        supplierId: string | null;
        decorCode: string | null;
        colorName: string | null;
        surface: string | null;
        thickness: number;
        width: number;
        unit: string;
        sheetArea: number;
        status: import("@prisma/client").$Enums.ProductStatus;
        deletedAt: Date | null;
    } & {
        prices: import("@prisma/client").ProductPrice[];
    }>;
    setPrice(id: string, dto: SetProductPriceDto): Promise<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        productId: string;
        type: import("@prisma/client").$Enums.ProductPriceType;
        currency: string;
        amount: import("@prisma/client-runtime-utils").Decimal;
        validFrom: Date;
        validTo: Date | null;
    }>;
    softDelete(id: string): Promise<{
        length: number;
        id: string;
        name: string;
        createdAt: Date;
        updatedAt: Date;
        brandId: string;
        sku: string;
        collectionId: string | null;
        supplierId: string | null;
        decorCode: string | null;
        colorName: string | null;
        surface: string | null;
        thickness: number;
        width: number;
        unit: string;
        sheetArea: number;
        status: import("@prisma/client").$Enums.ProductStatus;
        deletedAt: Date | null;
    }>;
}
