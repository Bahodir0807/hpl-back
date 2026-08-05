import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  Product,
  ProductPrice,
  ProductPriceType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { FilterProductDto } from './dto/filter-product.dto';
import { SetProductPriceDto } from './dto/set-product-price.dto';
import { UpdateProductDto } from './dto/update-product.dto';

const PURCHASE_PRICE_PERMISSION = 'products:read_purchase_price';

type ProductWithPrices = Product & {
  prices: ProductPrice[];
};

type ProductListResult = {
  items: ProductWithPrices[];
  total: number;
  page: number;
  limit: number;
};

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateProductDto): Promise<ProductWithPrices> {
    const existingProduct = await this.prisma.product.findUnique({
      where: { sku: dto.sku },
      select: { id: true },
    });

    if (existingProduct) {
      throw new ConflictException('Product with this SKU already exists');
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

  async findAll(
    filterDto: FilterProductDto,
    userPermissions: string[],
  ): Promise<ProductListResult> {
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
      items: items.map((product) =>
        this.hidePurchasePricesIfNeeded(product, userPermissions),
      ),
      total,
      page,
      limit,
    };
  }

  async findOne(
    id: string,
    userPermissions: string[],
  ): Promise<ProductWithPrices> {
    const product = await this.prisma.product.findFirst({
      where: {
        id,
        deletedAt: null,
      },
      include: this.productIncludeWithPrices(userPermissions),
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    return this.hidePurchasePricesIfNeeded(product, userPermissions);
  }

  async update(id: string, dto: UpdateProductDto): Promise<ProductWithPrices> {
    const product = await this.prisma.product.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, length: true, width: true },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    const length = dto.length ?? product.length;
    const width = dto.width ?? product.width;
    const shouldRecalculateSheetArea =
      dto.length !== undefined || dto.width !== undefined;

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

  async setPrice(
    productId: string,
    dto: SetProductPriceDto,
  ): Promise<ProductPrice> {
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

  async getActualPrice(
    productId: string,
    type: ProductPriceType,
  ): Promise<ProductPrice | null> {
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

  async softDelete(id: string): Promise<Product> {
    await this.ensureProductExists(id);

    return this.prisma.product.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  private calculateSheetArea(length: number, width: number): number {
    return (length * width) / 1_000_000;
  }

  private buildProductWhere(
    filterDto: FilterProductDto,
    userPermissions: string[],
  ): Prisma.ProductWhereInput {
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

  private buildPriceFilter(
    filterDto: FilterProductDto,
    canReadPurchasePrice: boolean,
  ): Prisma.ProductPriceWhereInput | undefined {
    if (filterDto.minPrice === undefined && filterDto.maxPrice === undefined) {
      return undefined;
    }

    return {
      type: canReadPurchasePrice
        ? undefined
        : { not: ProductPriceType.PURCHASE },
      amount: {
        gte: filterDto.minPrice,
        lte: filterDto.maxPrice,
      },
    };
  }

  private hidePurchasePricesIfNeeded(
    product: ProductWithPrices,
    userPermissions: string[],
  ): ProductWithPrices {
    if (this.canReadPurchasePrice(userPermissions)) {
      return product;
    }

    return {
      ...product,
      prices: product.prices.filter(
        (price) => price.type !== ProductPriceType.PURCHASE,
      ),
    };
  }

  private canReadPurchasePrice(userPermissions: string[]): boolean {
    return userPermissions.includes(PURCHASE_PRICE_PERMISSION);
  }

  private async ensureProductExists(id: string): Promise<void> {
    const product = await this.prisma.product.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }
  }

  private productIncludeWithPrices(
    userPermissions?: string[],
  ): Prisma.ProductInclude {
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
          : { type: { not: ProductPriceType.PURCHASE } },
        orderBy: { validFrom: 'desc' },
      },
    };
  }
}
