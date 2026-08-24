import { Prisma, PrismaClient } from '@prisma/client';
import {
  HPL_CANONICAL_PANEL_SIZES,
  HPL_CUSTOM_PANEL_TYPE_CODE,
  HPL_CUSTOM_PANEL_TYPE_DISPLAY_RU,
  HPL_PANEL_TYPE_CODES,
  HPL_PANEL_TYPE_DISPLAY_RU,
  HPL_QUALITY_CLASS_CODES,
  isCanonicalPanelSize,
  panelSizeAreaM2,
  panelSizeDisplayName,
  type HplPanelTypeCode,
} from '../../src/panels/hpl-catalog';
import {
  HPL_SELLING_CURRENCY,
  HPL_SOURCE_CURRENCY,
  HPL_FIXTURE_CNY_USD_RATE,
} from '../../src/panels/pricing/hpl-pricing.constants';
import { SEEDED_SUPPLIER_QUALITY_MAPPINGS } from '../../src/panels/pricing/hpl-quality-matrix';

const panelTypes: Array<{ code: HplPanelTypeCode; displayNameRu: string }> = (
  Object.values(HPL_PANEL_TYPE_CODES) as HplPanelTypeCode[]
).map((code) => ({
  code,
  displayNameRu: HPL_PANEL_TYPE_DISPLAY_RU[code],
}));

const qualityClasses = [
  { code: 'economy', nameRu: 'Эконом' },
  { code: 'medium', nameRu: 'Медиум' },
  { code: 'premium', nameRu: 'Премиум' },
] as const;

const panelSuppliers = [
  { code: 'wuya', name: 'Wuya', deliveryDays: 10, marginPercent: 15 },
  { code: 'tianran', name: 'Tianran', deliveryDays: 14, marginPercent: 15 },
  { code: 'polybet', name: 'Polybet', deliveryDays: 12, marginPercent: 15 },
] as const;

const LEGACY_EXTERIOR_CODE = 'exterior';
const LEGACY_THICKNESS_MM_TO_DEACTIVATE = ['16'];

export type ReferenceSeedReport = {
  panelTypeCodes: string[];
  canonicalSizeCount: number;
  deactivatedLegacySizeCount: number;
  deactivatedLegacyPricingCount: number;
  qualityClassCodes: string[];
  supplierCodes: string[];
  mappingCount: number;
  activeCnyUsdRate: boolean;
};

export async function seedFixtureCnyUsdRate(
  prisma: PrismaClient,
  createdById: string,
): Promise<void> {
  const now = new Date();
  await prisma.currencyRate.updateMany({
    where: {
      fromCurrency: HPL_SOURCE_CURRENCY,
      toCurrency: HPL_SELLING_CURRENCY,
      effectiveTo: null,
    },
    data: { effectiveTo: now },
  });
  await prisma.currencyRate.create({
    data: {
      fromCurrency: HPL_SOURCE_CURRENCY,
      toCurrency: HPL_SELLING_CURRENCY,
      rate: new Prisma.Decimal(HPL_FIXTURE_CNY_USD_RATE),
      effectiveFrom: now,
      createdById,
    },
  });
}

export async function hasActiveCnyUsdRate(
  prisma: PrismaClient,
): Promise<boolean> {
  const now = new Date();
  const row = await prisma.currencyRate.findFirst({
    where: {
      fromCurrency: HPL_SOURCE_CURRENCY,
      toCurrency: HPL_SELLING_CURRENCY,
      effectiveFrom: { lte: now },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
    },
    select: { id: true },
  });
  return row !== null;
}

async function migrateLegacyExteriorType(prisma: PrismaClient): Promise<void> {
  const canonical = await prisma.panelType.findUnique({
    where: { code: HPL_PANEL_TYPE_CODES.EXTERIOR_WITH_UV },
    select: { id: true },
  });
  const legacy = await prisma.panelType.findUnique({
    where: { code: LEGACY_EXTERIOR_CODE },
    select: { id: true },
  });

  if (legacy && !canonical) {
    await prisma.panelType.update({
      where: { id: legacy.id },
      data: {
        code: HPL_PANEL_TYPE_CODES.EXTERIOR_WITH_UV,
        displayNameRu:
          HPL_PANEL_TYPE_DISPLAY_RU[HPL_PANEL_TYPE_CODES.EXTERIOR_WITH_UV],
        isActive: true,
      },
    });
    return;
  }

  if (legacy && canonical) {
    await prisma.panelType.update({
      where: { id: legacy.id },
      data: { isActive: false },
    });
  }
}

export async function seedPanels(
  prisma: PrismaClient,
): Promise<Pick<
  ReferenceSeedReport,
  | 'panelTypeCodes'
  | 'canonicalSizeCount'
  | 'deactivatedLegacySizeCount'
  | 'deactivatedLegacyPricingCount'
  | 'qualityClassCodes'
  | 'supplierCodes'
  | 'mappingCount'
>> {
  await migrateLegacyExteriorType(prisma);

  for (const panelType of panelTypes) {
    await prisma.panelType.upsert({
      where: { code: panelType.code },
      update: {
        displayNameRu: panelType.displayNameRu,
        isActive: true,
      },
      create: {
        code: panelType.code,
        displayNameRu: panelType.displayNameRu,
        isActive: true,
      },
    });
  }

  await prisma.panelType.upsert({
    where: { code: HPL_CUSTOM_PANEL_TYPE_CODE },
    update: {
      displayNameRu: HPL_CUSTOM_PANEL_TYPE_DISPLAY_RU,
      isActive: true,
    },
    create: {
      code: HPL_CUSTOM_PANEL_TYPE_CODE,
      displayNameRu: HPL_CUSTOM_PANEL_TYPE_DISPLAY_RU,
      isActive: true,
    },
  });

  let sortOrder = 1;
  for (const size of HPL_CANONICAL_PANEL_SIZES) {
    await prisma.panelSize.upsert({
      where: {
        widthMm_heightMm: {
          widthMm: size.widthMm,
          heightMm: size.heightMm,
        },
      },
      update: {
        displayName: panelSizeDisplayName(size.widthMm, size.heightMm),
        sortOrder,
        areaM2: panelSizeAreaM2(size.widthMm, size.heightMm),
        isActive: true,
      },
      create: {
        widthMm: size.widthMm,
        heightMm: size.heightMm,
        displayName: panelSizeDisplayName(size.widthMm, size.heightMm),
        sortOrder,
        areaM2: panelSizeAreaM2(size.widthMm, size.heightMm),
        isActive: true,
      },
    });
    sortOrder += 1;
  }

  const legacySizes = await prisma.panelSize.findMany({
    where: { isActive: true },
    select: { id: true, widthMm: true, heightMm: true },
  });
  const legacySizeIds = legacySizes
    .filter((size) => !isCanonicalPanelSize(size.widthMm, size.heightMm))
    .map((size) => size.id);
  let deactivatedLegacySizeCount = 0;
  if (legacySizeIds.length > 0) {
    const deactivated = await prisma.panelSize.updateMany({
      where: { id: { in: legacySizeIds } },
      data: { isActive: false },
    });
    deactivatedLegacySizeCount = deactivated.count;
  }

  await prisma.qualityClass.createMany({
    data: qualityClasses.map((item) => ({ ...item })),
    skipDuplicates: true,
  });

  for (const qualityClass of qualityClasses) {
    await prisma.qualityClass.update({
      where: { code: qualityClass.code },
      data: { nameRu: qualityClass.nameRu },
    });
  }

  for (const supplier of panelSuppliers) {
    await prisma.supplier.upsert({
      where: { code: supplier.code },
      update: {
        name: supplier.name,
        deliveryDays: supplier.deliveryDays,
        marginPercent: new Prisma.Decimal(supplier.marginPercent),
        isDirectDelivery: true,
      },
      create: {
        code: supplier.code,
        name: supplier.name,
        contacts: {},
        deliveryDays: supplier.deliveryDays,
        marginPercent: new Prisma.Decimal(supplier.marginPercent),
        isDirectDelivery: true,
      },
    });
  }

  const deactivatedLegacyPricing = await prisma.panelThicknessPricing.updateMany({
    where: {
      isActive: true,
      thicknessMm: {
        in: LEGACY_THICKNESS_MM_TO_DEACTIVATE.map(
          (value) => new Prisma.Decimal(value),
        ),
      },
    },
    data: { isActive: false },
  });

  const allowedKeys = new Set(
    SEEDED_SUPPLIER_QUALITY_MAPPINGS.map(
      (mapping) =>
        `${mapping.supplierCode}|${mapping.panelTypeCode}|${mapping.qualityClassCode}`,
    ),
  );

  const existingMappings = await prisma.supplierQualityMapping.findMany({
    where: {
      supplier: {
        code: { in: [...panelSuppliers.map((item) => item.code)] },
      },
    },
    include: {
      supplier: { select: { code: true } },
      panelType: { select: { code: true } },
      qualityClass: { select: { code: true } },
    },
  });

  const staleMappingIds = existingMappings
    .filter((mapping) => {
      const isKnownPanelType = Object.values(HPL_PANEL_TYPE_CODES).includes(
        mapping.panelType.code as HplPanelTypeCode,
      );
      // Keep extra FURNITURE / LABORATORY rows. Those types only have an MVP
      // working-assumption matrix; do not delete unknown existing mappings.
      if (
        mapping.panelType.code === HPL_PANEL_TYPE_CODES.LABORATORY ||
        mapping.panelType.code === HPL_PANEL_TYPE_CODES.FURNITURE
      ) {
        return false;
      }

      return (
        isKnownPanelType &&
        !allowedKeys.has(
          `${mapping.supplier.code}|${mapping.panelType.code}|${mapping.qualityClass.code}`,
        )
      );
    })
    .map((mapping) => mapping.id);

  if (staleMappingIds.length > 0) {
    await prisma.supplierQualityMapping.deleteMany({
      where: { id: { in: staleMappingIds } },
    });
  }

  for (const mapping of SEEDED_SUPPLIER_QUALITY_MAPPINGS) {
    const supplier = await prisma.supplier.findUniqueOrThrow({
      where: { code: mapping.supplierCode },
    });
    const panelType = await prisma.panelType.findUniqueOrThrow({
      where: { code: mapping.panelTypeCode },
    });
    const qualityClass = await prisma.qualityClass.findUniqueOrThrow({
      where: { code: mapping.qualityClassCode },
    });

    await prisma.supplierQualityMapping.upsert({
      where: {
        supplierId_panelTypeId_qualityClassId: {
          supplierId: supplier.id,
          panelTypeId: panelType.id,
          qualityClassId: qualityClass.id,
        },
      },
      update: { isDefault: mapping.isDefault },
      create: {
        supplierId: supplier.id,
        panelTypeId: panelType.id,
        qualityClassId: qualityClass.id,
        isDefault: mapping.isDefault,
      },
    });
  }

  return {
    panelTypeCodes: panelTypes.map((item) => item.code),
    canonicalSizeCount: HPL_CANONICAL_PANEL_SIZES.length,
    deactivatedLegacySizeCount,
    deactivatedLegacyPricingCount: deactivatedLegacyPricing.count,
    qualityClassCodes: [...HPL_QUALITY_CLASS_CODES],
    supplierCodes: panelSuppliers.map((item) => item.code),
    mappingCount: SEEDED_SUPPLIER_QUALITY_MAPPINGS.length,
  };
}
