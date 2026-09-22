import {
  FacadeMaterialCategory,
  FacadeMaterialUnit,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import {
  BASE_FACADE_CONFIG_CODE,
  BASE_FACADE_NORMS_V1,
  BASE_FACADE_NORM_SET_CODE,
  BASE_FACADE_PANEL_AREA_M2,
  BASE_FACADE_PANEL_HEIGHT_MM,
  BASE_FACADE_PANEL_WIDTH_MM,
} from '../../src/modules/leads/engineering/facade/facade-norms';

export async function seedFacadeSubsystemCatalog(
  prisma: PrismaClient,
): Promise<void> {
  const config = await prisma.facadeSystemConfig.upsert({
    where: { code: BASE_FACADE_CONFIG_CODE },
    update: {
      nameRu: 'Базовая фасадная подсистема 1220×3050',
      nameEn: 'Base facade subsystem 1220×3050',
      nameUz: 'Asosiy fasad podsistemasi 1220×3050',
      panelWidthMm: BASE_FACADE_PANEL_WIDTH_MM,
      panelHeightMm: BASE_FACADE_PANEL_HEIGHT_MM,
      panelAreaM2: new Prisma.Decimal(BASE_FACADE_PANEL_AREA_M2),
      isCalculable: true,
    },
    create: {
      code: BASE_FACADE_CONFIG_CODE,
      nameRu: 'Базовая фасадная подсистема 1220×3050',
      nameEn: 'Base facade subsystem 1220×3050',
      nameUz: 'Asosiy fasad podsistemasi 1220×3050',
      panelWidthMm: BASE_FACADE_PANEL_WIDTH_MM,
      panelHeightMm: BASE_FACADE_PANEL_HEIGHT_MM,
      panelAreaM2: new Prisma.Decimal(BASE_FACADE_PANEL_AREA_M2),
      isCalculable: true,
    },
  });

  await prisma.facadeSystemConfig.upsert({
    where: { code: 'HPL_FACADE_GLUE' },
    update: {
      nameRu: 'Клеевая система (нормы не утверждены)',
      nameEn: 'Adhesive system (norms not approved)',
      nameUz: 'Yelim tizimi (normlar tasdiqlanmagan)',
      isCalculable: false,
    },
    create: {
      code: 'HPL_FACADE_GLUE',
      nameRu: 'Клеевая система (нормы не утверждены)',
      nameEn: 'Adhesive system (norms not approved)',
      nameUz: 'Yelim tizimi (normlar tasdiqlanmagan)',
      isCalculable: false,
    },
  });

  const materials: Array<{
    def: (typeof BASE_FACADE_NORMS_V1)[number];
    material: { id: string };
  }> = [];
  for (const def of BASE_FACADE_NORMS_V1) {
    const material = await prisma.facadeMaterial.upsert({
      where: { code: def.code },
      update: {
        nameRu: def.nameRu,
        nameEn: def.nameEn,
        nameUz: def.nameUz,
        category: def.category as FacadeMaterialCategory,
        unit: def.unit as FacadeMaterialUnit,
        spec: def.spec,
        isActive: true,
        sortOrder: def.sortOrder,
      },
      create: {
        code: def.code,
        nameRu: def.nameRu,
        nameEn: def.nameEn,
        nameUz: def.nameUz,
        category: def.category as FacadeMaterialCategory,
        unit: def.unit as FacadeMaterialUnit,
        spec: def.spec,
        isActive: true,
        sortOrder: def.sortOrder,
      },
    });
    materials.push({ def, material });
  }

  const normSet = await prisma.facadeNormSet.upsert({
    where: { code: BASE_FACADE_NORM_SET_CODE },
    update: {
      configId: config.id,
      version: 'V1',
      isCurrent: true,
    },
    create: {
      code: BASE_FACADE_NORM_SET_CODE,
      configId: config.id,
      version: 'V1',
      isCurrent: true,
    },
  });

  for (const { def, material } of materials) {
    await prisma.facadeConsumptionNorm.upsert({
      where: {
        normSetId_materialId: {
          normSetId: normSet.id,
          materialId: material.id,
        },
      },
      update: {
        unit: def.unit as FacadeMaterialUnit,
        qtyPerM2: new Prisma.Decimal(def.qtyPerM2),
        sortOrder: def.sortOrder,
      },
      create: {
        normSetId: normSet.id,
        materialId: material.id,
        unit: def.unit as FacadeMaterialUnit,
        qtyPerM2: new Prisma.Decimal(def.qtyPerM2),
        sortOrder: def.sortOrder,
      },
    });
  }
}
