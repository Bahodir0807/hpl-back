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
exports.ProductsService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const prisma_service_1 = require("../prisma/prisma.service");
const PURCHASE_PRICE_PERMISSION = 'products:read_purchase_price';
let ProductsService = class ProductsService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async create(dto) {
        const existingProduct = await this.prisma.product.findUnique({
            where: { sku: dto.sku },
            select: { id: true },
        });
        if (existingProduct) {
            throw new common_1.ConflictException('Product with this SKU already exists');
        }
        const sheetArea = this.calculateSheetArea(dto.length, dto.width);
        return this.prisma.$transaction(async (tx) => {
            const product = await tx.product.create({
                data: {
                    sku: dto.sku,
                    name: dto.name,
                    brandId: dto.brandId,
                    collectionId: dto.collectionId,
                    supplierId: dto.supplierId,
                    decorCode: dto.decorCode,
                    colorName: dto.colorName,
                    surface: dto.surface,
                    thickness: dto.thickness,
                    length: dto.length,
                    width: dto.width,
                    unit: dto.unit ?? 'm2',
                    sheetArea,
                    status: dto.status,
                    prices: {
                        create: dto.initialPrices?.map((price) => ({
                            type: price.type,
                            amount: price.amount,
                            currency: 'RUB',
                            validFrom: price.validFrom ?? new Date(),
                        })),
                    },
                },
                include: this.productIncludeWithPrices(),
            });
            return product;
        });
    }
    async findAll(filterDto, userPermissions) {
        const page = filterDto.page ?? 1;
        const limit = filterDto.limit ?? 20;
        const where = this.buildProductWhere(filterDto, userPermissions);
        const [items, total] = await this.prisma.$transaction([
            this.prisma.product.findMany({
                where,
                include: this.productIncludeWithPrices(userPermissions),
                orderBy: { createdAt: 'desc' },
                skip: (page - 1) * limit,
                take: limit,
            }),
            this.prisma.product.count({ where }),
        ]);
        return {
            items: items.map((product) => this.hidePurchasePricesIfNeeded(product, userPermissions)),
            total,
            page,
            limit,
        };
    }
    async findOne(id, userPermissions) {
        const product = await this.prisma.product.findFirst({
            where: {
                id,
                deletedAt: null,
            },
            include: this.productIncludeWithPrices(userPermissions),
        });
        if (!product) {
            throw new common_1.NotFoundException('Product not found');
        }
        return this.hidePurchasePricesIfNeeded(product, userPermissions);
    }
    async update(id, dto) {
        const product = await this.prisma.product.findFirst({
            where: { id, deletedAt: null },
            select: { id: true, length: true, width: true },
        });
        if (!product) {
            throw new common_1.NotFoundException('Product not found');
        }
        const length = dto.length ?? product.length;
        const width = dto.width ?? product.width;
        const shouldRecalculateSheetArea = dto.length !== undefined || dto.width !== undefined;
        return this.prisma.product.update({
            where: { id },
            data: {
                sku: dto.sku,
                name: dto.name,
                brandId: dto.brandId,
                collectionId: dto.collectionId,
                supplierId: dto.supplierId,
                decorCode: dto.decorCode,
                colorName: dto.colorName,
                surface: dto.surface,
                thickness: dto.thickness,
                length: dto.length,
                width: dto.width,
                unit: dto.unit,
                status: dto.status,
                sheetArea: shouldRecalculateSheetArea
                    ? this.calculateSheetArea(length, width)
                    : undefined,
            },
            include: this.productIncludeWithPrices(),
        });
    }
    async setPrice(productId, dto) {
        await this.ensureProductExists(productId);
        return this.prisma.productPrice.create({
            data: {
                productId,
                type: dto.type,
                amount: dto.amount,
                currency: dto.currency ?? 'RUB',
                validFrom: dto.validFrom,
                validTo: dto.validTo,
            },
        });
    }
    async getActualPrice(productId, type) {
        await this.ensureProductExists(productId);
        const now = new Date();
        return this.prisma.productPrice.findFirst({
            where: {
                productId,
                type,
                validFrom: { lte: now },
                OR: [{ validTo: null }, { validTo: { gte: now } }],
            },
            orderBy: { validFrom: 'desc' },
        });
    }
    async softDelete(id) {
        await this.ensureProductExists(id);
        return this.prisma.product.update({
            where: { id },
            data: { deletedAt: new Date() },
        });
    }
    calculateSheetArea(length, width) {
        return (length * width) / 1_000_000;
    }
    buildProductWhere(filterDto, userPermissions) {
        const canReadPurchasePrice = this.canReadPurchasePrice(userPermissions);
        const priceFilter = this.buildPriceFilter(filterDto, canReadPurchasePrice);
        return {
            deletedAt: null,
            brandId: filterDto.brandId,
            collectionId: filterDto.collectionId,
            supplierId: filterDto.supplierId,
            status: filterDto.status,
            decorCode: filterDto.decorCode,
            colorName: filterDto.colorName,
            surface: filterDto.surface,
            thickness: filterDto.thickness,
            prices: priceFilter ? { some: priceFilter } : undefined,
            OR: filterDto.search
                ? [
                    { sku: { contains: filterDto.search, mode: 'insensitive' } },
                    { name: { contains: filterDto.search, mode: 'insensitive' } },
                    { decorCode: { contains: filterDto.search, mode: 'insensitive' } },
                    { colorName: { contains: filterDto.search, mode: 'insensitive' } },
                ]
                : undefined,
        };
    }
    buildPriceFilter(filterDto, canReadPurchasePrice) {
        if (filterDto.minPrice === undefined && filterDto.maxPrice === undefined) {
            return undefined;
        }
        return {
            type: canReadPurchasePrice
                ? undefined
                : { not: client_1.ProductPriceType.PURCHASE },
            amount: {
                gte: filterDto.minPrice,
                lte: filterDto.maxPrice,
            },
        };
    }
    hidePurchasePricesIfNeeded(product, userPermissions) {
        if (this.canReadPurchasePrice(userPermissions)) {
            return product;
        }
        return {
            ...product,
            prices: product.prices.filter((price) => price.type !== client_1.ProductPriceType.PURCHASE),
        };
    }
    canReadPurchasePrice(userPermissions) {
        return userPermissions.includes(PURCHASE_PRICE_PERMISSION);
    }
    async ensureProductExists(id) {
        const product = await this.prisma.product.findFirst({
            where: { id, deletedAt: null },
            select: { id: true },
        });
        if (!product) {
            throw new common_1.NotFoundException('Product not found');
        }
    }
    productIncludeWithPrices(userPermissions) {
        const canReadPurchasePrice = userPermissions
            ? this.canReadPurchasePrice(userPermissions)
            : true;
        return {
            brand: true,
            collection: true,
            supplier: true,
            prices: {
                where: canReadPurchasePrice
                    ? undefined
                    : { type: { not: client_1.ProductPriceType.PURCHASE } },
                orderBy: { validFrom: 'desc' },
            },
        };
    }
};
exports.ProductsService = ProductsService;
exports.ProductsService = ProductsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], ProductsService);
//# sourceMappingURL=products.service.js.map