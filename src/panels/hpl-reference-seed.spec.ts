import { Prisma } from '@prisma/client';
import {
  HPL_CANONICAL_PANEL_SIZES,
  HPL_CUSTOM_PANEL_TYPE_CODE,
  HPL_PANEL_TYPE_CODES,
} from './hpl-catalog';
import { seedPanels } from '../../prisma/seed/panels';
import { SEEDED_SUPPLIER_QUALITY_MAPPINGS } from './pricing/hpl-quality-matrix';

function createSeedPrisma() {
  const panelTypes = new Map<
    string,
    { id: string; code: string; isActive: boolean }
  >();
  const panelSizes = new Map<
    string,
    { id: string; widthMm: number; heightMm: number; isActive: boolean }
  >();
  const qualityClasses = new Map<string, { id: string; code: string }>();
  const suppliers = new Map<string, { id: string; code: string }>();
  const mappings = new Map<
    string,
    {
      id: string;
      supplierCode: string;
      panelTypeCode: string;
      qualityClassCode: string;
    }
  >();
  const pricing: Array<{ thicknessMm: Prisma.Decimal; isActive: boolean }> = [
    { thicknessMm: new Prisma.Decimal('16'), isActive: true },
  ];

  let id = 1;
  const nextId = () => `id-${id++}`;

  return {
    panelTypes,
    panelSizes,
    qualityClasses,
    suppliers,
    mappings,
    pricing,
    panelType: {
      findUnique: jest.fn(
        async ({ where }: { where: { code: string } }) =>
          panelTypes.get(where.code) ?? null,
      ),
      findUniqueOrThrow: jest.fn(
        async ({ where }: { where: { code: string } }) => {
          const row = panelTypes.get(where.code);
          if (!row) throw new Error(`missing panel type ${where.code}`);
          return row;
        },
      ),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id?: string; code?: string };
          data: Record<string, unknown>;
        }) => {
          const current = [...panelTypes.values()].find(
            (row) => row.id === where.id || row.code === where.code,
          );
          if (current && data.code) {
            panelTypes.delete(current.code);
            current.code = data.code as string;
            panelTypes.set(current.code, current);
          }
          return current;
        },
      ),
      upsert: jest.fn(
        async ({
          where,
          create,
        }: {
          where: { code: string };
          create: { code: string };
        }) => {
          const existing = panelTypes.get(where.code);
          if (existing) {
            existing.isActive = true;
            return existing;
          }
          const created = { id: nextId(), code: create.code, isActive: true };
          panelTypes.set(create.code, created);
          return created;
        },
      ),
    },
    panelSize: {
      upsert: jest.fn(
        async ({
          where,
          create,
        }: {
          where: { widthMm_heightMm: { widthMm: number; heightMm: number } };
          create: { widthMm: number; heightMm: number };
        }) => {
          const key = `${create.widthMm}x${create.heightMm}`;
          const existing = panelSizes.get(key);
          if (existing) {
            existing.isActive = true;
            return existing;
          }
          const created = {
            id: nextId(),
            widthMm: where.widthMm_heightMm.widthMm,
            heightMm: where.widthMm_heightMm.heightMm,
            isActive: true,
          };
          panelSizes.set(key, created);
          return created;
        },
      ),
      findMany: jest.fn(async () => [...panelSizes.values()]),
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: { in: string[] } };
          data: { isActive: boolean };
        }) => {
          let count = 0;
          for (const size of panelSizes.values()) {
            if (where.id.in.includes(size.id)) {
              size.isActive = data.isActive;
              count += 1;
            }
          }
          return { count };
        },
      ),
    },
    qualityClass: {
      createMany: jest.fn(
        async ({ data }: { data: Array<{ code: string }> }) => {
          for (const row of data) {
            if (!qualityClasses.has(row.code)) {
              qualityClasses.set(row.code, { id: nextId(), code: row.code });
            }
          }
          return { count: data.length };
        },
      ),
      update: jest.fn(async ({ where }: { where: { code: string } }) =>
        qualityClasses.get(where.code),
      ),
      findUniqueOrThrow: jest.fn(
        async ({ where }: { where: { code: string } }) => {
          const row = qualityClasses.get(where.code);
          if (!row) throw new Error(`missing quality ${where.code}`);
          return row;
        },
      ),
    },
    supplier: {
      upsert: jest.fn(
        async ({
          where,
          create,
        }: {
          where: { code: string };
          create: { code: string };
        }) => {
          const existing = suppliers.get(where.code);
          if (existing) return existing;
          const created = { id: nextId(), code: create.code };
          suppliers.set(create.code, created);
          return created;
        },
      ),
      findUniqueOrThrow: jest.fn(
        async ({ where }: { where: { code: string } }) => {
          const row = suppliers.get(where.code);
          if (!row) throw new Error(`missing supplier ${where.code}`);
          return row;
        },
      ),
    },
    panelThicknessPricing: {
      updateMany: jest.fn(async () => {
        let count = 0;
        for (const row of pricing) {
          if (row.isActive && row.thicknessMm.eq(16)) {
            row.isActive = false;
            count += 1;
          }
        }
        return { count };
      }),
    },
    supplierQualityMapping: {
      findMany: jest.fn(async () =>
        [...mappings.values()].map((mapping) => ({
          id: mapping.id,
          supplier: { code: mapping.supplierCode },
          panelType: { code: mapping.panelTypeCode },
          qualityClass: { code: mapping.qualityClassCode },
        })),
      ),
      deleteMany: jest.fn(async () => ({ count: 0 })),
      upsert: jest.fn(
        async ({
          create,
        }: {
          create: {
            supplierId: string;
            panelTypeId: string;
            qualityClassId: string;
          };
        }) => {
          const supplier = [...suppliers.values()].find(
            (row) => row.id === create.supplierId,
          );
          const panelType = [...panelTypes.values()].find(
            (row) => row.id === create.panelTypeId,
          );
          const qualityClass = [...qualityClasses.values()].find(
            (row) => row.id === create.qualityClassId,
          );
          const key = `${supplier?.code}|${panelType?.code}|${qualityClass?.code}`;
          const existing = mappings.get(key);
          if (existing) return existing;
          const created = {
            id: nextId(),
            supplierCode: supplier!.code,
            panelTypeCode: panelType!.code,
            qualityClassCode: qualityClass!.code,
          };
          mappings.set(key, created);
          return created;
        },
      ),
    },
  };
}

describe('HPL reference seed', () => {
  it('upserts canonical types and 24 sizes without duplicating on a second run', async () => {
    const prisma = createSeedPrisma();

    await seedPanels(prisma as never);
    const firstTypeCount = prisma.panelTypes.size;
    const firstSizeCount = prisma.panelSizes.size;
    const firstMappingCount = prisma.mappings.size;

    await seedPanels(prisma as never);

    expect(firstTypeCount).toBe(5);
    expect(firstSizeCount).toBe(24);
    expect(prisma.panelTypes.size).toBe(firstTypeCount);
    expect(prisma.panelSizes.size).toBe(firstSizeCount);
    expect(prisma.mappings.size).toBe(firstMappingCount);
    expect(prisma.mappings.size).toBe(SEEDED_SUPPLIER_QUALITY_MAPPINGS.length);
    expect(
      [...prisma.mappings.values()].some(
        (mapping) =>
          mapping.supplierCode === 'wuya' &&
          mapping.panelTypeCode === HPL_PANEL_TYPE_CODES.FURNITURE &&
          mapping.qualityClassCode === 'economy',
      ),
    ).toBe(true);
    expect(
      [...prisma.mappings.values()].some(
        (mapping) =>
          mapping.supplierCode === 'tianran' &&
          mapping.panelTypeCode === HPL_PANEL_TYPE_CODES.LABORATORY &&
          mapping.qualityClassCode === 'medium',
      ),
    ).toBe(true);
    expect([...prisma.panelTypes.keys()].sort()).toEqual(
      [...Object.values(HPL_PANEL_TYPE_CODES), HPL_CUSTOM_PANEL_TYPE_CODE]
        .slice()
        .sort(),
    );
    expect(
      [...prisma.panelSizes.values()].every((size) =>
        HPL_CANONICAL_PANEL_SIZES.some(
          (canonical) =>
            canonical.widthMm === size.widthMm &&
            canonical.heightMm === size.heightMm,
        ),
      ),
    ).toBe(true);
  });

  it('deactivates leftover 16 mm pricing instead of keeping it as a standard option', async () => {
    const prisma = createSeedPrisma();
    await seedPanels(prisma as never);
    expect(prisma.pricing[0]?.isActive).toBe(false);
  });

  it('does not invent supplier CNY thickness prices', async () => {
    const prisma = createSeedPrisma();
    await seedPanels(prisma as never);
    expect(prisma.panelThicknessPricing.updateMany).toHaveBeenCalled();
    expect(prisma.pricing).toHaveLength(1);
    expect(prisma.pricing[0]?.thicknessMm.toString()).toBe('16');
    expect(prisma.pricing[0]?.isActive).toBe(false);
  });
});
