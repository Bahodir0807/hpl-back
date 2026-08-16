import { Prisma, PrismaClient, ProductPriceType, ProductStatus } from '@prisma/client';

const CALCULATOR_PRODUCT_SKU = 'HPL-CALC-PANEL';

export async function seedCalculatorProduct(
  prisma: PrismaClient,
): Promise<{ id: string }> {
  const existing = await prisma.product.findUnique({
    where: { sku: CALCULATOR_PRODUCT_SKU },
    select: { id: true },
  });

  if (existing) {
    return existing;
  }

  const brand = await prisma.brand.upsert({
    where: { code: 'HPLPRO' },
    update: {},
    create: { code: 'HPLPRO', name: 'HPL Pro' },
  });

  const supplier = await prisma.supplier.upsert({
    where: { code: 'wuya' },
    update: {},
    create: { code: 'wuya', name: 'Wuya', contacts: {} },
  });

  const product = await prisma.product.create({
    data: {
      sku: CALCULATOR_PRODUCT_SKU,
      name: 'HPL-панель (калькулятор)',
      brandId: brand.id,
      supplierId: supplier.id,
      thickness: 10,
      length: 2440,
      width: 1220,
      unit: 'm2',
      sheetArea: 2.9768,
      status: ProductStatus.ACTIVE,
      prices: {
        create: {
          type: ProductPriceType.BASE,
          amount: new Prisma.Decimal(0),
          currency: 'UZS',
          validFrom: new Date(),
        },
      },
    },
    select: { id: true },
  });

  return product;
}
