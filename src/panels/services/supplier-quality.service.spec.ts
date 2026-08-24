import { BadRequestException } from '@nestjs/common';
import { HPL_QUALITY_CLASS_CODES } from '../hpl-catalog';
import { CRM_SUPPLIER_CODES } from '../pricing/hpl-quality-matrix';
import { SupplierQualityService } from './supplier-quality.service';

describe('SupplierQualityService', () => {
  const wuyaId = 'sup-wuya';
  const interiorId = 'type-interior';
  const exteriorId = 'type-exterior-uv';
  const economy = { id: 'q-economy', code: 'economy', nameRu: 'Эконом' };
  const medium = { id: 'q-medium', code: 'medium', nameRu: 'Медиум' };
  const premium = { id: 'q-premium', code: 'premium', nameRu: 'Премиум' };

  const mappingsFor = (panelTypeId: string) => [
    { qualityClass: economy, panelTypeId },
    { qualityClass: medium, panelTypeId },
    { qualityClass: premium, panelTypeId },
  ];

  const prisma = {
    supplier: { findFirst: jest.fn() },
    panelType: { findFirst: jest.fn(), findUnique: jest.fn() },
    supplierQualityMapping: { findMany: jest.fn() },
  };

  const service = new SupplierQualityService(prisma as never);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.supplier.findFirst.mockResolvedValue({ id: wuyaId, code: 'wuya' });
    prisma.panelType.findFirst.mockImplementation(
      ({ where }: { where: { code?: string } }) => {
        if (where.code === 'interior') {
          return { id: interiorId, code: 'interior' };
        }
        if (where.code === 'exterior_with_uv') {
          return { id: exteriorId, code: 'exterior_with_uv' };
        }
        return null;
      },
    );
    prisma.panelType.findUnique.mockResolvedValue(null);
    prisma.supplierQualityMapping.findMany.mockImplementation(
      ({ where }: { where: { supplierId: string; panelTypeId?: string } }) =>
        mappingsFor(where.panelTypeId ?? interiorId),
    );
  });

  it('returns economy/medium/premium for a supplier with mappings', async () => {
    const classes = await service.findQualityClasses('wuya', 'interior');

    expect(prisma.supplier.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { code: { equals: 'wuya', mode: 'insensitive' } },
            { id: 'wuya' },
          ],
        },
      }),
    );
    expect(prisma.supplierQualityMapping.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { supplierId: wuyaId, panelTypeId: interiorId },
      }),
    );
    expect(classes.map((item) => item.code)).toEqual([
      ...HPL_QUALITY_CLASS_CODES,
    ]);
    expect(classes.map((item) => item.nameRu)).toEqual([
      'Эконом',
      'Медиум',
      'Премиум',
    ]);
  });

  it('looks up the supplier by id as well as code', async () => {
    await service.findQualityClasses(wuyaId, 'interior');

    expect(prisma.supplier.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { code: { equals: wuyaId, mode: 'insensitive' } },
            { id: wuyaId },
          ],
        },
      }),
    );
  });

  it('resolves panelType from catalog code, application enum and exterior alias', async () => {
    await service.findQualityClasses('wuya', 'INTERIOR');
    expect(prisma.supplierQualityMapping.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { supplierId: wuyaId, panelTypeId: interiorId },
      }),
    );

    await service.findQualityClasses('wuya', 'exterior');
    expect(prisma.supplierQualityMapping.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { supplierId: wuyaId, panelTypeId: exteriorId },
      }),
    );
  });

  it('resolves panelType from a panel type id', async () => {
    prisma.panelType.findUnique.mockResolvedValue({
      id: interiorId,
      code: 'interior',
    });

    await service.findQualityClasses('wuya', interiorId);

    expect(prisma.supplierQualityMapping.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { supplierId: wuyaId, panelTypeId: interiorId },
      }),
    );
  });

  it('does not invent a fourth quality class', async () => {
    prisma.supplierQualityMapping.findMany.mockResolvedValue([
      ...mappingsFor(interiorId),
      { qualityClass: { id: 'q-extra', code: 'luxury', nameRu: 'Люкс' } },
    ]);

    const classes = await service.findQualityClasses('wuya', 'interior');
    expect(classes.map((item) => item.code)).toEqual([
      ...HPL_QUALITY_CLASS_CODES,
    ]);
  });

  it('returns an empty list only when mappings are actually missing', async () => {
    prisma.supplierQualityMapping.findMany.mockResolvedValue([]);

    await expect(
      service.findQualityClasses('wuya', 'interior'),
    ).resolves.toEqual([]);
  });

  it('covers every CRM supplier code used in seed', () => {
    expect([...CRM_SUPPLIER_CODES]).toEqual(['wuya', 'tianran', 'polybet']);
  });

  it('rejects an unknown panel type', async () => {
    await expect(
      service.findQualityClasses('wuya', 'not-a-type'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
