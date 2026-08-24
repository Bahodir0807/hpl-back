import { HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BusinessException } from '../../common/exceptions/business.exception';
import { PanelThicknessPricingService } from './panel-thickness-pricing.service';

describe('PanelThicknessPricingService', () => {
  const prisma = {
    panelType: { findUnique: jest.fn() },
    supplier: { findUnique: jest.fn() },
    qualityClass: { findUnique: jest.fn() },
    supplierQualityMapping: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    panelThicknessPricing: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn(),
  };

  const service = new PanelThicknessPricingService(prisma as never);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(async (callback) =>
      callback(prisma),
    );
    prisma.supplierQualityMapping.findMany.mockResolvedValue([]);
  });

  it('rejects a non-positive CNY price', async () => {
    prisma.panelType.findUnique.mockResolvedValue({
      id: 'type-1',
      code: 'furniture',
      displayNameRu: 'Мебельный',
    });
    prisma.supplier.findUnique.mockResolvedValue({ id: 'sup-1' });
    prisma.qualityClass.findUnique.mockResolvedValue({ id: 'q-1' });
    prisma.supplierQualityMapping.findUnique.mockResolvedValue({ id: 'map-1' });

    await expect(
      service.create({
        supplierId: 'sup-1',
        qualityClassId: 'q-1',
        panelTypeId: 'type-1',
        thicknessMm: '2.9',
        basePricePerM2: '0',
        createdById: 'head-1',
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        errorCode: 'INVALID_SUPPLIER_PRICE',
        statusCode: HttpStatus.BAD_REQUEST,
      }),
    });
    expect(prisma.panelThicknessPricing.create).not.toHaveBeenCalled();
  });

  it('rejects an invalid supplier/quality mapping', async () => {
    prisma.panelType.findUnique.mockResolvedValue({
      id: 'type-1',
      code: 'furniture',
      displayNameRu: 'Мебельный',
    });
    prisma.supplier.findUnique.mockResolvedValue({ id: 'sup-1' });
    prisma.qualityClass.findUnique.mockResolvedValue({ id: 'q-1' });
    prisma.supplierQualityMapping.findUnique.mockResolvedValue(null);

    await expect(
      service.create({
        supplierId: 'sup-1',
        qualityClassId: 'q-1',
        panelTypeId: 'type-1',
        thicknessMm: '2.9',
        basePricePerM2: '80',
        createdById: 'head-1',
      }),
    ).rejects.toBeInstanceOf(BusinessException);
    expect(prisma.panelThicknessPricing.create).not.toHaveBeenCalled();
  });

  it('creates a CNY price and closes the previous active row', async () => {
    prisma.panelType.findUnique.mockResolvedValue({
      id: 'type-1',
      code: 'furniture',
      displayNameRu: 'Мебельный',
    });
    prisma.supplier.findUnique.mockResolvedValue({ id: 'sup-1' });
    prisma.qualityClass.findUnique.mockResolvedValue({ id: 'q-1' });
    prisma.supplierQualityMapping.findUnique.mockResolvedValue({ id: 'map-1' });
    prisma.panelThicknessPricing.updateMany.mockResolvedValue({ count: 1 });
    prisma.panelThicknessPricing.create.mockResolvedValue({
      id: 'price-1',
      supplierId: 'sup-1',
      qualityClassId: 'q-1',
      thicknessMm: new Prisma.Decimal('2.9'),
      basePricePerM2: new Prisma.Decimal('80'),
      currencyCode: 'CNY',
      validFrom: new Date('2026-08-20T00:00:00.000Z'),
      validTo: null,
      isActive: true,
      supplier: { id: 'sup-1', code: 'wuya', name: 'Wuya' },
      qualityClass: { id: 'q-1', code: 'economy', nameRu: 'Эконом' },
    });
    prisma.auditLog.create.mockResolvedValue({});

    const created = await service.create({
      supplierId: 'sup-1',
      qualityClassId: 'q-1',
      panelTypeId: 'type-1',
      thicknessMm: '2.9',
      basePricePerM2: '80',
      createdById: 'head-1',
    });

    expect(prisma.panelThicknessPricing.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          supplierId: 'sup-1',
          qualityClassId: 'q-1',
          isActive: true,
        }),
      }),
    );
    expect(created.currencyCode).toBe('CNY');
    expect(created.basePricePerM2).toBe('80');
    expect(created.thicknessMm).toBe('2.9');
  });
});
