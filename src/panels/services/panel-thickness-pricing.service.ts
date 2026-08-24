import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BusinessException } from '../../common/exceptions/business.exception';
import { PrismaService } from '../../modules/prisma/prisma.service';
import {
  HPL_PANEL_TYPE_CODES,
  canonicalizePanelTypeCode,
  type HplStandardApplication,
} from '../hpl-catalog';
import { validateHplThickness } from '../hpl-thickness';
import { HPL_SOURCE_CURRENCY } from '../pricing/hpl-pricing.constants';

const pricingInclude = Prisma.validator<Prisma.PanelThicknessPricingInclude>()({
  supplier: { select: { id: true, code: true, name: true } },
  qualityClass: { select: { id: true, code: true, nameRu: true } },
});

type PricingWithRelations = Prisma.PanelThicknessPricingGetPayload<{
  include: typeof pricingInclude;
}>;

function applicationFromPanelTypeCode(
  code: string | null | undefined,
): HplStandardApplication | null {
  const canonical = canonicalizePanelTypeCode(code);
  if (!canonical) {
    return null;
  }

  for (const [application, panelCode] of Object.entries(HPL_PANEL_TYPE_CODES)) {
    if (panelCode === canonical) {
      return application as HplStandardApplication;
    }
  }

  return null;
}

function serializePricing(
  row: PricingWithRelations,
  panelTypes: Array<{ id: string; code: string; displayNameRu: string }>,
) {
  return {
    id: row.id,
    supplierId: row.supplierId,
    qualityClassId: row.qualityClassId,
    thicknessMm: row.thicknessMm.toString(),
    basePricePerM2: row.basePricePerM2.toString(),
    currencyCode: row.currencyCode,
    validFrom: row.validFrom,
    validTo: row.validTo,
    isActive: row.isActive,
    supplier: row.supplier,
    qualityClass: row.qualityClass,
    panelTypes,
  };
}

@Injectable()
export class PanelThicknessPricingService {
  constructor(private readonly prisma: PrismaService) {}

  async listActive() {
    const now = new Date();
    const rows = await this.prisma.panelThicknessPricing.findMany({
      where: {
        isActive: true,
        validFrom: { lte: now },
        OR: [{ validTo: null }, { validTo: { gte: now } }],
      },
      include: pricingInclude,
      orderBy: [{ thicknessMm: 'asc' }, { validFrom: 'desc' }],
    });

    const panelTypesByKey = await this.panelTypesBySupplierQuality(rows);

    return rows.map((row) =>
      serializePricing(
        row,
        panelTypesByKey.get(this.pairKey(row.supplierId, row.qualityClassId)) ??
          [],
      ),
    );
  }

  async create(input: {
    supplierId: string;
    qualityClassId: string;
    panelTypeId: string;
    thicknessMm: string;
    basePricePerM2: string;
    createdById: string;
  }) {
    const panelType = await this.prisma.panelType.findUnique({
      where: { id: input.panelTypeId },
      select: { id: true, code: true, displayNameRu: true },
    });
    if (!panelType) {
      throw new BusinessException(
        HttpStatus.BAD_REQUEST,
        'PANEL_TYPE_NOT_FOUND',
        'Выбранный тип панели не найден',
      );
    }

    const supplier = await this.prisma.supplier.findUnique({
      where: { id: input.supplierId },
      select: { id: true },
    });
    if (!supplier) {
      throw new BusinessException(
        HttpStatus.BAD_REQUEST,
        'SUPPLIER_NOT_FOUND',
        'Поставщик не найден',
      );
    }

    const qualityClass = await this.prisma.qualityClass.findUnique({
      where: { id: input.qualityClassId },
      select: { id: true },
    });
    if (!qualityClass) {
      throw new BusinessException(
        HttpStatus.BAD_REQUEST,
        'QUALITY_CLASS_NOT_FOUND',
        'Класс качества не найден',
      );
    }

    const mapping = await this.prisma.supplierQualityMapping.findUnique({
      where: {
        supplierId_panelTypeId_qualityClassId: {
          supplierId: input.supplierId,
          panelTypeId: input.panelTypeId,
          qualityClassId: input.qualityClassId,
        },
      },
      select: { id: true },
    });
    if (!mapping) {
      throw new BusinessException(
        HttpStatus.BAD_REQUEST,
        'INVALID_QUALITY_MAPPING',
        'Выбранный класс качества недоступен для этого поставщика и типа HPL',
      );
    }

    const application = applicationFromPanelTypeCode(panelType.code);
    const thicknessResult = validateHplThickness(
      application,
      input.thicknessMm,
    );
    if (!thicknessResult.ok) {
      throw new BusinessException(
        HttpStatus.BAD_REQUEST,
        thicknessResult.errorCode,
        thicknessResult.message,
      );
    }

    const basePricePerM2 = new Prisma.Decimal(input.basePricePerM2);
    if (!basePricePerM2.isFinite() || basePricePerM2.lte(0)) {
      throw new BusinessException(
        HttpStatus.BAD_REQUEST,
        'INVALID_SUPPLIER_PRICE',
        'Закупочная цена поставщика должна быть больше 0',
      );
    }

    const now = new Date();
    const created = await this.prisma.$transaction(async (tx) => {
      await tx.panelThicknessPricing.updateMany({
        where: {
          supplierId: input.supplierId,
          qualityClassId: input.qualityClassId,
          thicknessMm: thicknessResult.thicknessMm,
          isActive: true,
        },
        data: { isActive: false, validTo: now },
      });

      const row = await tx.panelThicknessPricing.create({
        data: {
          supplierId: input.supplierId,
          qualityClassId: input.qualityClassId,
          thicknessMm: thicknessResult.thicknessMm,
          basePricePerM2,
          currencyCode: HPL_SOURCE_CURRENCY,
          validFrom: now,
          isActive: true,
        },
        include: pricingInclude,
      });

      await tx.auditLog.create({
        data: {
          userId: input.createdById,
          action: 'PANEL_THICKNESS_PRICING_CREATED',
          entityType: 'PanelThicknessPricing',
          entityId: row.id,
          newValue: {
            supplierId: row.supplierId,
            qualityClassId: row.qualityClassId,
            panelTypeId: input.panelTypeId,
            thicknessMm: row.thicknessMm.toString(),
            basePricePerM2: row.basePricePerM2.toString(),
            currencyCode: HPL_SOURCE_CURRENCY,
          },
        },
      });

      return row;
    });

    return serializePricing(created, [
      {
        id: panelType.id,
        code: panelType.code,
        displayNameRu: panelType.displayNameRu,
      },
    ]);
  }

  async update(
    id: string,
    input: { basePricePerM2?: string; isActive?: boolean; updatedById: string },
  ) {
    const existing = await this.prisma.panelThicknessPricing.findUnique({
      where: { id },
      include: pricingInclude,
    });
    if (!existing) {
      throw new BusinessException(
        HttpStatus.NOT_FOUND,
        'PRICING_NOT_FOUND',
        'Закупочная цена не найдена',
      );
    }

    const data: Prisma.PanelThicknessPricingUpdateInput = {};

    if (input.basePricePerM2 !== undefined) {
      const basePricePerM2 = new Prisma.Decimal(input.basePricePerM2);
      if (!basePricePerM2.isFinite() || basePricePerM2.lte(0)) {
        throw new BusinessException(
          HttpStatus.BAD_REQUEST,
          'INVALID_SUPPLIER_PRICE',
          'Закупочная цена поставщика должна быть больше 0',
        );
      }
      data.basePricePerM2 = basePricePerM2;
    }

    if (input.isActive !== undefined) {
      data.isActive = input.isActive;
      if (input.isActive === false) {
        data.validTo = new Date();
      }
    }

    if (Object.keys(data).length === 0) {
      throw new BusinessException(
        HttpStatus.BAD_REQUEST,
        'EMPTY_UPDATE',
        'Нет данных для обновления',
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.panelThicknessPricing.update({
        where: { id },
        data,
        include: pricingInclude,
      });

      await tx.auditLog.create({
        data: {
          userId: input.updatedById,
          action: 'PANEL_THICKNESS_PRICING_UPDATED',
          entityType: 'PanelThicknessPricing',
          entityId: row.id,
          oldValue: {
            basePricePerM2: existing.basePricePerM2.toString(),
            isActive: existing.isActive,
          },
          newValue: {
            basePricePerM2: row.basePricePerM2.toString(),
            isActive: row.isActive,
          },
        },
      });

      return row;
    });

    const panelTypesByKey = await this.panelTypesBySupplierQuality([updated]);
    return serializePricing(
      updated,
      panelTypesByKey.get(
        this.pairKey(updated.supplierId, updated.qualityClassId),
      ) ?? [],
    );
  }

  private pairKey(supplierId: string, qualityClassId: string): string {
    return `${supplierId}:${qualityClassId}`;
  }

  private async panelTypesBySupplierQuality(
    rows: Array<{ supplierId: string; qualityClassId: string }>,
  ) {
    const uniquePairs = [
      ...new Map(
        rows.map((row) => [
          this.pairKey(row.supplierId, row.qualityClassId),
          {
            supplierId: row.supplierId,
            qualityClassId: row.qualityClassId,
          },
        ]),
      ).values(),
    ];

    if (uniquePairs.length === 0) {
      return new Map<
        string,
        Array<{ id: string; code: string; displayNameRu: string }>
      >();
    }

    const mappings = await this.prisma.supplierQualityMapping.findMany({
      where: {
        OR: uniquePairs,
      },
      select: {
        supplierId: true,
        qualityClassId: true,
        panelType: {
          select: { id: true, code: true, displayNameRu: true },
        },
      },
    });

    const result = new Map<
      string,
      Array<{ id: string; code: string; displayNameRu: string }>
    >();

    for (const mapping of mappings) {
      const key = this.pairKey(mapping.supplierId, mapping.qualityClassId);
      const current = result.get(key) ?? [];
      if (!current.some((item) => item.id === mapping.panelType.id)) {
        current.push(mapping.panelType);
      }
      result.set(key, current);
    }

    return result;
  }
}
