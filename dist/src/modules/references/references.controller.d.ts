import { CreateBrandDto } from './dto/create-brand.dto';
import { CreateProductCollectionDto } from './dto/create-product-collection.dto';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateBrandDto } from './dto/update-brand.dto';
import { UpdateProductCollectionDto } from './dto/update-product-collection.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { ReferencesService } from './references.service';
export declare class ReferencesController {
    private readonly referencesService;
    constructor(referencesService: ReferencesService);
    createSupplier(dto: CreateSupplierDto): Promise<{
        id: string;
        name: string;
        createdAt: Date;
        updatedAt: Date;
        code: string;
        contacts: import("@prisma/client/runtime/client").JsonValue | null;
    }>;
    findSuppliers(): Promise<{
        id: string;
        name: string;
        createdAt: Date;
        updatedAt: Date;
        code: string;
        contacts: import("@prisma/client/runtime/client").JsonValue | null;
    }[]>;
    findSupplier(id: string): Promise<{
        id: string;
        name: string;
        createdAt: Date;
        updatedAt: Date;
        code: string;
        contacts: import("@prisma/client/runtime/client").JsonValue | null;
    }>;
    updateSupplier(id: string, dto: UpdateSupplierDto): Promise<{
        id: string;
        name: string;
        createdAt: Date;
        updatedAt: Date;
        code: string;
        contacts: import("@prisma/client/runtime/client").JsonValue | null;
    }>;
    deleteSupplier(id: string): Promise<{
        id: string;
        name: string;
        createdAt: Date;
        updatedAt: Date;
        code: string;
        contacts: import("@prisma/client/runtime/client").JsonValue | null;
    }>;
    createBrand(dto: CreateBrandDto): Promise<{
        id: string;
        name: string;
        createdAt: Date;
        updatedAt: Date;
        code: string;
    }>;
    findBrands(): Promise<{
        id: string;
        name: string;
        createdAt: Date;
        updatedAt: Date;
        code: string;
    }[]>;
    findBrand(id: string): Promise<{
        id: string;
        name: string;
        createdAt: Date;
        updatedAt: Date;
        code: string;
    }>;
    updateBrand(id: string, dto: UpdateBrandDto): Promise<{
        id: string;
        name: string;
        createdAt: Date;
        updatedAt: Date;
        code: string;
    }>;
    deleteBrand(id: string): Promise<{
        id: string;
        name: string;
        createdAt: Date;
        updatedAt: Date;
        code: string;
    }>;
    createProductCollection(dto: CreateProductCollectionDto): Promise<{
        id: string;
        name: string;
        createdAt: Date;
        updatedAt: Date;
        brandId: string;
    }>;
    findProductCollections(brandId?: string): Promise<{
        id: string;
        name: string;
        createdAt: Date;
        updatedAt: Date;
        brandId: string;
    }[]>;
    findProductCollection(id: string): Promise<{
        id: string;
        name: string;
        createdAt: Date;
        updatedAt: Date;
        brandId: string;
    }>;
    updateProductCollection(id: string, dto: UpdateProductCollectionDto): Promise<{
        id: string;
        name: string;
        createdAt: Date;
        updatedAt: Date;
        brandId: string;
    }>;
    deleteProductCollection(id: string): Promise<{
        id: string;
        name: string;
        createdAt: Date;
        updatedAt: Date;
        brandId: string;
    }>;
}
