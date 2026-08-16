import { Prisma, PrismaClient } from '@prisma/client';

const panelTypes = [
  { code: 'exterior', displayNameRu: 'Экстерьерные' },
  { code: 'interior', displayNameRu: 'Интерьерные' },
  { code: 'laboratory', displayNameRu: 'Лабораторные' },
] as const;

const sizeDefinitions = [
  { widthMm: 1220, heightMm: 2440, displayName: '1220×2440', sortOrder: 1 },
  { widthMm: 1220, heightMm: 3050, displayName: '1220×3050', sortOrder: 2 },
  { widthMm: 1300, heightMm: 2800, displayName: '1300×2800', sortOrder: 3 },
  { widthMm: 1300, heightMm: 3050, displayName: '1300×3050', sortOrder: 4 },
  { widthMm: 1500, heightMm: 3000, displayName: '1500×3000', sortOrder: 5 },
  { widthMm: 1500, heightMm: 3050, displayName: '1500×3050', sortOrder: 6 },
  { widthMm: 1525, heightMm: 3050, displayName: '1525×3050', sortOrder: 7 },
  { widthMm: 1525, heightMm: 3660, displayName: '1525×3660', sortOrder: 8 },
  { widthMm: 1830, heightMm: 2440, displayName: '1830×2440', sortOrder: 9 },
  { widthMm: 1830, heightMm: 3050, displayName: '1830×3050', sortOrder: 10 },
  { widthMm: 1830, heightMm: 3660, displayName: '1830×3660', sortOrder: 11 },
  { widthMm: 2000, heightMm: 3000, displayName: '2000×3000', sortOrder: 12 },
  { widthMm: 2000, heightMm: 3050, displayName: '2000×3050', sortOrder: 13 },
  { widthMm: 2000, heightMm: 3660, displayName: '2000×3660', sortOrder: 14 },
  { widthMm: 2130, heightMm: 3050, displayName: '2130×3050', sortOrder: 15 },
  { widthMm: 2130, heightMm: 3660, displayName: '2130×3660', sortOrder: 16 },
  { widthMm: 2440, heightMm: 3050, displayName: '2440×3050', sortOrder: 17 },
  { widthMm: 2440, heightMm: 3660, displayName: '2440×3660', sortOrder: 18 },
  { widthMm: 2500, heightMm: 3050, displayName: '2500×3050', sortOrder: 19 },
  { widthMm: 2500, heightMm: 3660, displayName: '2500×3660', sortOrder: 20 },
] as const;

const thicknessPricings = [
  { thicknessMm: 6, basePricePerM2: 45000.0 },
  { thicknessMm: 8, basePricePerM2: 52000.0 },
  { thicknessMm: 10, basePricePerM2: 60000.0 },
  { thicknessMm: 12, basePricePerM2: 75000.0 },
  { thicknessMm: 16, basePricePerM2: 90000.0 },
  { thicknessMm: 18, basePricePerM2: 110000.0 },
  { thicknessMm: 20, basePricePerM2: 130000.0 },
] as const;

const qualityClasses = [
  { code: 'economy', nameRu: 'Эконом' },
  { code: 'medium', nameRu: 'Медиум' },
  { code: 'premium', nameRu: 'Премиум' },
] as const;

const qualityPriceMultipliers: Record<
  (typeof qualityClasses)[number]['code'],
  number
> = {
  economy: 1,
  medium: 1.2,
  premium: 1.5,
};

const panelSuppliers = [
  { code: 'wuya', name: 'Wuya', deliveryDays: 10, marginPercent: 15 },
  { code: 'tianran', name: 'Tianran', deliveryDays: 14, marginPercent: 15 },
  { code: 'polybet', name: 'Polybet', deliveryDays: 12, marginPercent: 15 },
] as const;

function calcAreaM2(widthMm: number, heightMm: number): Prisma.Decimal {
  return new Prisma.Decimal((widthMm * heightMm) / 1_000_000);
}

export async function seedPanels(prisma: PrismaClient): Promise<void> {
  await prisma.panelType.createMany({
    data: panelTypes.map((item) => ({ ...item })),
    skipDuplicates: true,
  });

  for (const size of sizeDefinitions) {
    await prisma.panelSize.upsert({
      where: {
        widthMm_heightMm: {
          widthMm: size.widthMm,
          heightMm: size.heightMm,
        },
      },
      update: {
        displayName: size.displayName,
        sortOrder: size.sortOrder,
        areaM2: calcAreaM2(size.widthMm, size.heightMm),
        isActive: true,
      },
      create: {
        widthMm: size.widthMm,
        heightMm: size.heightMm,
        displayName: size.displayName,
        sortOrder: size.sortOrder,
        areaM2: calcAreaM2(size.widthMm, size.heightMm),
        isActive: true,
      },
    });
  }

  await prisma.qualityClass.createMany({
    data: qualityClasses.map((item) => ({ ...item })),
    skipDuplicates: true,
  });

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

  const validFrom = new Date();
  const seededSuppliers = await prisma.supplier.findMany({
    where: { code: { in: [...panelSuppliers.map((item) => item.code)] } },
  });
  const seededQualityClasses = await prisma.qualityClass.findMany({
    where: { code: { in: [...qualityClasses.map((item) => item.code)] } },
  });

  for (const supplier of seededSuppliers) {
    for (const qualityClass of seededQualityClasses) {
      const multiplier =
        qualityPriceMultipliers[
          qualityClass.code as (typeof qualityClasses)[number]['code']
        ];

      for (const pricing of thicknessPricings) {
        const existing = await prisma.panelThicknessPricing.findFirst({
          where: {
            supplierId: supplier.id,
            qualityClassId: qualityClass.id,
            thicknessMm: pricing.thicknessMm,
            isActive: true,
          },
        });

        if (!existing) {
          await prisma.panelThicknessPricing.create({
            data: {
              supplierId: supplier.id,
              qualityClassId: qualityClass.id,
              thicknessMm: pricing.thicknessMm,
              basePricePerM2: new Prisma.Decimal(pricing.basePricePerM2)
                .mul(multiplier)
                .toDecimalPlaces(2),
              currencyCode: 'UZS',
              validFrom,
              validTo: null,
              isActive: true,
            },
          });
        }
      }
    }
  }

  const mappings: Array<{
    supplierCode: string;
    panelTypeCode: string;
    qualityClassCode: string;
    isDefault: boolean;
  }> = [
    { supplierCode: 'wuya', panelTypeCode: 'exterior', qualityClassCode: 'economy', isDefault: true },
    { supplierCode: 'wuya', panelTypeCode: 'interior', qualityClassCode: 'economy', isDefault: true },
    { supplierCode: 'polybet', panelTypeCode: 'exterior', qualityClassCode: 'premium', isDefault: true },
    { supplierCode: 'polybet', panelTypeCode: 'interior', qualityClassCode: 'premium', isDefault: true },
    { supplierCode: 'tianran', panelTypeCode: 'exterior', qualityClassCode: 'economy', isDefault: true },
    { supplierCode: 'tianran', panelTypeCode: 'exterior', qualityClassCode: 'medium', isDefault: false },
    { supplierCode: 'tianran', panelTypeCode: 'exterior', qualityClassCode: 'premium', isDefault: false },
    { supplierCode: 'tianran', panelTypeCode: 'interior', qualityClassCode: 'economy', isDefault: true },
    { supplierCode: 'tianran', panelTypeCode: 'interior', qualityClassCode: 'medium', isDefault: false },
    { supplierCode: 'tianran', panelTypeCode: 'interior', qualityClassCode: 'premium', isDefault: false },
    { supplierCode: 'tianran', panelTypeCode: 'laboratory', qualityClassCode: 'economy', isDefault: true },
    { supplierCode: 'tianran', panelTypeCode: 'laboratory', qualityClassCode: 'medium', isDefault: false },
    { supplierCode: 'tianran', panelTypeCode: 'laboratory', qualityClassCode: 'premium', isDefault: false },
  ];

  for (const mapping of mappings) {
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
}
