import { Prisma } from '@prisma/client';
import { QuoteStockService } from './quote-stock.service';

describe('QuoteStockService', () => {
  const prisma = {
    product: { findMany: jest.fn() },
    expectedReceipt: { findMany: jest.fn() },
    expectedReceiptEventItem: { findMany: jest.fn() },
  };
  const item = {
    id: 'quote-item',
    areaM2: new Prisma.Decimal('3'),
    thicknessMm: 12,
    supplierCode: 'SUP',
    colorCode: 'C01',
    colorName: 'White',
    panelSizeName: '1220x2440',
    panelTypeCode: 'EXTERIOR_WITH_UV',
    qualityClassCode: 'A',
    application: 'EXTERIOR_WITH_UV',
    sheetsCount: 2,
  };
  let service: QuoteStockService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new QuoteStockService(prisma as never);
  });

  it('does not treat an apparently unique Product as exact', async () => {
    prisma.product.findMany.mockResolvedValue([
      {
        id: 'product-id',
        sku: 'HPL-01',
        unit: 'm2',
        stockBalance: { onHand: 10, reserved: 3 },
      },
    ]);

    const result = await service.check([item]);

    expect(result.status).toBe('SKU_UNRESOLVED');
    expect(result.lines[0].resolution).toBe('UNREPRESENTABLE_SPEC');
    expect(prisma.product.findMany).not.toHaveBeenCalled();
  });

  it('keeps a zero-candidate result unresolved', async () => {
    prisma.product.findMany.mockResolvedValue([]);

    const result = await service.check([item]);

    expect(result.status).toBe('SKU_UNRESOLVED');
    expect(prisma.product.findMany).not.toHaveBeenCalled();
  });

  it('does not read expected purchases or rejected receipt quantities', async () => {
    prisma.product.findMany.mockResolvedValue([
      {
        id: 'product-id',
        sku: 'HPL-01',
        unit: 'm2',
        stockBalance: { onHand: 2, reserved: 0 },
      },
    ]);

    const result = await service.check([item]);

    expect(result.status).toBe('SKU_UNRESOLVED');
    expect(prisma.expectedReceipt.findMany).not.toHaveBeenCalled();
    expect(prisma.expectedReceiptEventItem.findMany).not.toHaveBeenCalled();
  });

  it('does not let multiple apparent candidates bypass missing identity', async () => {
    prisma.product.findMany.mockResolvedValue([
      { id: 'one', sku: 'ONE', unit: 'm2', stockBalance: null },
      { id: 'two', sku: 'TWO', unit: 'm2', stockBalance: null },
    ]);

    const result = await service.check([item]);

    expect(result.status).toBe('SKU_UNRESOLVED');
    expect(result.lines[0].resolution).toBe('UNREPRESENTABLE_SPEC');
    expect(prisma.product.findMany).not.toHaveBeenCalled();
  });

  it('fails unresolved for colorName-only identity', async () => {
    const result = await service.check([
      { ...item, colorCode: null, colorName: 'Free text white' },
    ]);

    expect(result.status).toBe('SKU_UNRESOLVED');
    expect(result.lines[0].resolution).toBe('UNSAFE_COLOR_IDENTITY');
    expect(prisma.product.findMany).not.toHaveBeenCalled();
  });
});
