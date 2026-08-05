import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Brand, ProductCollection, Supplier } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBrandDto } from './dto/create-brand.dto';
import { CreateProductCollectionDto } from './dto/create-product-collection.dto';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateBrandDto } from './dto/update-brand.dto';
import { UpdateProductCollectionDto } from './dto/update-product-collection.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';

@Injectable()
export class ReferencesService {
  constructor(private readonly prisma: PrismaService) {}

  async createSupplier(dto: CreateSupplierDto): Promise<Supplier> {
    await this.ensureSupplierCodeIsUnique(dto.code);

    return this.prisma.supplier.create({
      data: {
        name: dto.name,
        code: dto.code,
        contacts: dto.contacts,
      },
    });
  }

  async findSuppliers(): Promise<Supplier[]> {
    return this.prisma.supplier.findMany({
      orderBy: { name: 'asc' },
    });
  }

  async findSupplier(id: string): Promise<Supplier> {
    const supplier = await this.prisma.supplier.findUnique({ where: { id } });

    if (!supplier) {
      throw new NotFoundException('Supplier not found');
    }

    return supplier;
  }

  async updateSupplier(id: string, dto: UpdateSupplierDto): Promise<Supplier> {
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

  async deleteSupplier(id: string): Promise<Supplier> {
    await this.findSupplier(id);

    return this.prisma.supplier.delete({ where: { id } });
  }

  async createBrand(dto: CreateBrandDto): Promise<Brand> {
    await this.ensureBrandCodeIsUnique(dto.code);

    return this.prisma.brand.create({ data: dto });
  }

  async findBrands(): Promise<Brand[]> {
    return this.prisma.brand.findMany({
      orderBy: { name: 'asc' },
    });
  }

  async findBrand(id: string): Promise<Brand> {
    const brand = await this.prisma.brand.findUnique({ where: { id } });

    if (!brand) {
      throw new NotFoundException('Brand not found');
    }

    return brand;
  }

  async updateBrand(id: string, dto: UpdateBrandDto): Promise<Brand> {
    await this.findBrand(id);

    if (dto.code) {
      await this.ensureBrandCodeIsUnique(dto.code, id);
    }

    return this.prisma.brand.update({
      where: { id },
      data: dto,
    });
  }

  async deleteBrand(id: string): Promise<Brand> {
    await this.findBrand(id);

    return this.prisma.brand.delete({ where: { id } });
  }

  async createProductCollection(
    dto: CreateProductCollectionDto,
  ): Promise<ProductCollection> {
    await this.findBrand(dto.brandId);
    await this.ensureCollectionNameIsUnique(dto.brandId, dto.name);

    return this.prisma.productCollection.create({ data: dto });
  }

  async findProductCollections(brandId?: string): Promise<ProductCollection[]> {
    return this.prisma.productCollection.findMany({
      where: { brandId },
      orderBy: { name: 'asc' },
    });
  }

  async findProductCollection(id: string): Promise<ProductCollection> {
    const collection = await this.prisma.productCollection.findUnique({
      where: { id },
    });

    if (!collection) {
      throw new NotFoundException('Product collection not found');
    }

    return collection;
  }

  async updateProductCollection(
    id: string,
    dto: UpdateProductCollectionDto,
  ): Promise<ProductCollection> {
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

  async deleteProductCollection(id: string): Promise<ProductCollection> {
    await this.findProductCollection(id);

    return this.prisma.productCollection.delete({ where: { id } });
  }

  private async ensureSupplierCodeIsUnique(
    code: string,
    currentId?: string,
  ): Promise<void> {
    const supplier = await this.prisma.supplier.findUnique({
      where: { code },
      select: { id: true },
    });

    if (supplier && supplier.id !== currentId) {
      throw new ConflictException('Supplier code already exists');
    }
  }

  private async ensureBrandCodeIsUnique(
    code: string,
    currentId?: string,
  ): Promise<void> {
    const brand = await this.prisma.brand.findUnique({
      where: { code },
      select: { id: true },
    });

    if (brand && brand.id !== currentId) {
      throw new ConflictException('Brand code already exists');
    }
  }

  private async ensureCollectionNameIsUnique(
    brandId: string,
    name: string,
    currentId?: string,
  ): Promise<void> {
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
      throw new ConflictException('Product collection already exists');
    }
  }
}
