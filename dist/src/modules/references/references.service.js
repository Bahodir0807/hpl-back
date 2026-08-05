"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReferencesService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
let ReferencesService = class ReferencesService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async createSupplier(dto) {
        await this.ensureSupplierCodeIsUnique(dto.code);
        return this.prisma.supplier.create({
            data: {
                name: dto.name,
                code: dto.code,
                contacts: dto.contacts,
            },
        });
    }
    async findSuppliers() {
        return this.prisma.supplier.findMany({
            orderBy: { name: 'asc' },
        });
    }
    async findSupplier(id) {
        const supplier = await this.prisma.supplier.findUnique({ where: { id } });
        if (!supplier) {
            throw new common_1.NotFoundException('Supplier not found');
        }
        return supplier;
    }
    async updateSupplier(id, dto) {
        await this.findSupplier(id);
        if (dto.code) {
            await this.ensureSupplierCodeIsUnique(dto.code, id);
        }
        return this.prisma.supplier.update({
            where: { id },
            data: {
                name: dto.name,
                code: dto.code,
                contacts: dto.contacts,
            },
        });
    }
    async deleteSupplier(id) {
        await this.findSupplier(id);
        return this.prisma.supplier.delete({ where: { id } });
    }
    async createBrand(dto) {
        await this.ensureBrandCodeIsUnique(dto.code);
        return this.prisma.brand.create({ data: dto });
    }
    async findBrands() {
        return this.prisma.brand.findMany({
            orderBy: { name: 'asc' },
        });
    }
    async findBrand(id) {
        const brand = await this.prisma.brand.findUnique({ where: { id } });
        if (!brand) {
            throw new common_1.NotFoundException('Brand not found');
        }
        return brand;
    }
    async updateBrand(id, dto) {
        await this.findBrand(id);
        if (dto.code) {
            await this.ensureBrandCodeIsUnique(dto.code, id);
        }
        return this.prisma.brand.update({
            where: { id },
            data: dto,
        });
    }
    async deleteBrand(id) {
        await this.findBrand(id);
        return this.prisma.brand.delete({ where: { id } });
    }
    async createProductCollection(dto) {
        await this.findBrand(dto.brandId);
        await this.ensureCollectionNameIsUnique(dto.brandId, dto.name);
        return this.prisma.productCollection.create({ data: dto });
    }
    async findProductCollections(brandId) {
        return this.prisma.productCollection.findMany({
            where: { brandId },
            orderBy: { name: 'asc' },
        });
    }
    async findProductCollection(id) {
        const collection = await this.prisma.productCollection.findUnique({
            where: { id },
        });
        if (!collection) {
            throw new common_1.NotFoundException('Product collection not found');
        }
        return collection;
    }
    async updateProductCollection(id, dto) {
        const collection = await this.findProductCollection(id);
        const brandId = dto.brandId ?? collection.brandId;
        const name = dto.name ?? collection.name;
        if (dto.brandId) {
            await this.findBrand(dto.brandId);
        }
        if (dto.brandId || dto.name) {
            await this.ensureCollectionNameIsUnique(brandId, name, id);
        }
        return this.prisma.productCollection.update({
            where: { id },
            data: dto,
        });
    }
    async deleteProductCollection(id) {
        await this.findProductCollection(id);
        return this.prisma.productCollection.delete({ where: { id } });
    }
    async ensureSupplierCodeIsUnique(code, currentId) {
        const supplier = await this.prisma.supplier.findUnique({
            where: { code },
            select: { id: true },
        });
        if (supplier && supplier.id !== currentId) {
            throw new common_1.ConflictException('Supplier code already exists');
        }
    }
    async ensureBrandCodeIsUnique(code, currentId) {
        const brand = await this.prisma.brand.findUnique({
            where: { code },
            select: { id: true },
        });
        if (brand && brand.id !== currentId) {
            throw new common_1.ConflictException('Brand code already exists');
        }
    }
    async ensureCollectionNameIsUnique(brandId, name, currentId) {
        const collection = await this.prisma.productCollection.findUnique({
            where: {
                brandId_name: {
                    brandId,
                    name,
                },
            },
            select: { id: true },
        });
        if (collection && collection.id !== currentId) {
            throw new common_1.ConflictException('Product collection already exists');
        }
    }
};
exports.ReferencesService = ReferencesService;
exports.ReferencesService = ReferencesService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], ReferencesService);
//# sourceMappingURL=references.service.js.map