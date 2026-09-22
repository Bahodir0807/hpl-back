import { HttpStatus, Injectable } from '@nestjs/common';
import { ActivityType, Prisma } from '@prisma/client';
import { BusinessException } from '../../../../common/exceptions/business.exception';
import type { CurrentUser } from '../../../../common/interfaces/current-user.interface';
import { PrismaService } from '../../../prisma/prisma.service';
import { decimalToString, toDecimal } from './facade-decimal';
import { FACADE_PRICING_PERMISSIONS } from './facade-pricing.constants';
import type {
  CreateFacadeMaterialOfferDto,
  UpdateFacadeMaterialOfferDto,
} from './dto/facade-offer.dto';

@Injectable()
export class FacadeMaterialOfferService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: CurrentUser, materialId?: string) {
    this.assertRead(user);
    const offers = await this.prisma.facadeMaterialSupplierOffer.findMany({
      where: materialId ? { materialId } : undefined,
      include: {
        material: true,
        supplier: true,
      },
      orderBy: [{ material: { sortOrder: 'asc' } }, { createdAt: 'desc' }],
    });
    const materials = await this.prisma.facadeMaterial.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { nameRu: 'asc' }],
    });
    const suppliers = await this.prisma.supplier.findMany({
      orderBy: { name: 'asc' },
    });
    return {
      items: offers.map((offer) => this.toView(offer)),
      materials: materials.map((material) => ({
        id: material.id,
        code: material.code,
        nameRu: material.nameRu,
        nameEn: material.nameEn,
        nameUz: material.nameUz,
        category: material.category,
        unit: material.unit,
      })),
      suppliers: suppliers.map((supplier) => ({
        id: supplier.id,
        code: supplier.code,
        name: supplier.name,
      })),
    };
  }

  async create(dto: CreateFacadeMaterialOfferDto, user: CurrentUser) {
    this.assertManage(user);
    const material = await this.prisma.facadeMaterial.findUnique({
      where: { id: dto.materialId },
    });
    if (!material) {
      throw new BusinessException(
        HttpStatus.BAD_REQUEST,
        'FACADE_MATERIAL_UNKNOWN',
        'Материал не найден в каталоге',
      );
    }
    await this.requireSupplier(dto.supplierId);
    const purchasePrice = this.parseNonNegativePrice(dto.purchasePrice);
    const created = await this.prisma.$transaction(async (tx) => {
      const offer = await tx.facadeMaterialSupplierOffer.create({
        data: {
          materialId: dto.materialId,
          supplierId: dto.supplierId,
          purchasePrice,
          currency: this.normalizeCurrency(dto.currency),
          unit: dto.unit,
          validFrom: new Date(dto.validFrom),
          validTo: dto.validTo ? new Date(dto.validTo) : null,
          isActive: dto.isActive ?? true,
          availability: dto.availability ?? null,
          leadTimeDays: dto.leadTimeDays ?? null,
          supplierSku: dto.supplierSku ?? null,
          note: dto.note ?? null,
        },
        include: { material: true, supplier: true },
      });
      await this.writeHistory(tx, {
        actorId: user.id,
        action: 'FACADE_SUPPLIER_OFFER_CREATED',
        entityId: offer.id,
        content: 'Создано предложение поставщика по материалу подсистемы',
        metadata: {
          materialId: offer.materialId,
          supplierId: offer.supplierId,
          currency: offer.currency,
          isActive: offer.isActive,
        },
      });
      return offer;
    });
    return this.toView(created);
  }

  async update(
    id: string,
    dto: UpdateFacadeMaterialOfferDto,
    user: CurrentUser,
  ) {
    this.assertManage(user);
    const existing = await this.prisma.facadeMaterialSupplierOffer.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new BusinessException(
        HttpStatus.NOT_FOUND,
        'FACADE_OFFER_NOT_FOUND',
        'Предложение поставщика не найдено',
      );
    }
    if (dto.supplierId) {
      await this.requireSupplier(dto.supplierId);
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const offer = await tx.facadeMaterialSupplierOffer.update({
        where: { id },
        data: {
          supplierId: dto.supplierId,
          purchasePrice:
            dto.purchasePrice === undefined
              ? undefined
              : this.parseNonNegativePrice(dto.purchasePrice),
          currency:
            dto.currency === undefined
              ? undefined
              : this.normalizeCurrency(dto.currency),
          unit: dto.unit,
          validFrom: dto.validFrom ? new Date(dto.validFrom) : undefined,
          validTo:
            dto.validTo === undefined
              ? undefined
              : dto.validTo
                ? new Date(dto.validTo)
                : null,
          isActive: dto.isActive,
          availability: dto.availability === undefined ? undefined : dto.availability,
          leadTimeDays:
            dto.leadTimeDays === undefined ? undefined : dto.leadTimeDays,
          supplierSku: dto.supplierSku === undefined ? undefined : dto.supplierSku,
          note: dto.note === undefined ? undefined : dto.note,
        },
        include: { material: true, supplier: true },
      });
      await this.writeHistory(tx, {
        actorId: user.id,
        action: 'FACADE_SUPPLIER_OFFER_CHANGED',
        entityId: offer.id,
        content: 'Изменено предложение поставщика по материалу подсистемы',
        metadata: {
          materialId: offer.materialId,
          supplierId: offer.supplierId,
          currency: offer.currency,
          isActive: offer.isActive,
        },
      });
      return offer;
    });
    return this.toView(updated);
  }

  private async requireSupplier(supplierId: string) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
    });
    if (!supplier) {
      throw new BusinessException(
        HttpStatus.BAD_REQUEST,
        'FACADE_SUPPLIER_UNKNOWN',
        'Поставщик не найден',
      );
    }
    return supplier;
  }

  private parseNonNegativePrice(raw: string): Prisma.Decimal {
    try {
      const value = toDecimal(raw.trim());
      if (!value.isFinite() || value.lt(0)) {
        throw new Error('invalid');
      }
      return value;
    } catch {
      throw new BusinessException(
        HttpStatus.BAD_REQUEST,
        'FACADE_OFFER_PRICE_INVALID',
        'Закупочная цена не может быть отрицательной',
      );
    }
  }

  private normalizeCurrency(raw: string): string {
    const currency = raw.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new BusinessException(
        HttpStatus.BAD_REQUEST,
        'FACADE_OFFER_CURRENCY_INVALID',
        'Валюта должна быть трёхбуквенным кодом ISO',
      );
    }
    return currency;
  }

  private assertRead(user: CurrentUser): void {
    if (!user.permissions.includes(FACADE_PRICING_PERMISSIONS.READ_PURCHASE)) {
      throw new BusinessException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Нет доступа к закупочным предложениям подсистемы',
      );
    }
  }

  private assertManage(user: CurrentUser): void {
    if (!user.permissions.includes(FACADE_PRICING_PERMISSIONS.MANAGE_OFFERS)) {
      throw new BusinessException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Нет права управлять предложениями поставщиков подсистемы',
      );
    }
  }

  private async writeHistory(
    tx: Prisma.TransactionClient,
    input: {
      actorId: string;
      action: string;
      entityId: string;
      content: string;
      metadata: Record<string, unknown>;
    },
  ) {
    await tx.activity.create({
      data: {
        type: ActivityType.STATUS_CHANGED,
        relatedType: 'FacadeMaterialSupplierOffer',
        relatedId: input.entityId,
        authorId: input.actorId,
        content: input.content,
        metadata: {
          action: input.action,
          ...input.metadata,
        },
      },
    });
    await tx.auditLog.create({
      data: {
        userId: input.actorId,
        action: input.action,
        entityType: 'FacadeMaterialSupplierOffer',
        entityId: input.entityId,
        newValue: input.metadata as Prisma.InputJsonValue,
      },
    });
  }

  private toView(offer: {
    id: string;
    materialId: string;
    supplierId: string;
    purchasePrice: Prisma.Decimal;
    currency: string;
    unit: string;
    validFrom: Date;
    validTo: Date | null;
    isActive: boolean;
    availability: string | null;
    leadTimeDays: number | null;
    supplierSku: string | null;
    note: string | null;
    createdAt: Date;
    updatedAt: Date;
    material: {
      code: string;
      nameRu: string;
      nameEn: string;
      nameUz: string;
      category: string;
      unit: string;
    };
    supplier: { code: string; name: string };
  }) {
    return {
      id: offer.id,
      materialId: offer.materialId,
      supplierId: offer.supplierId,
      purchasePrice: decimalToString(offer.purchasePrice),
      currency: offer.currency,
      unit: offer.unit,
      validFrom: offer.validFrom.toISOString(),
      validTo: offer.validTo?.toISOString() ?? null,
      isActive: offer.isActive,
      availability: offer.availability,
      leadTimeDays: offer.leadTimeDays,
      supplierSku: offer.supplierSku,
      note: offer.note,
      createdAt: offer.createdAt.toISOString(),
      updatedAt: offer.updatedAt.toISOString(),
      material: {
        code: offer.material.code,
        nameRu: offer.material.nameRu,
        nameEn: offer.material.nameEn,
        nameUz: offer.material.nameUz,
        category: offer.material.category,
        unit: offer.material.unit,
      },
      supplier: {
        code: offer.supplier.code,
        name: offer.supplier.name,
      },
    };
  }
}
