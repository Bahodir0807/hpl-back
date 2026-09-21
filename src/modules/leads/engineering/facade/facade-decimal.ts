import { Prisma } from '@prisma/client';

export function toDecimal(value: Prisma.Decimal.Value): Prisma.Decimal {
  return value instanceof Prisma.Decimal
    ? value
    : new Prisma.Decimal(value);
}

export function multiplyAreaByNorm(
  areaM2: Prisma.Decimal.Value,
  qtyPerM2: Prisma.Decimal.Value,
): Prisma.Decimal {
  return toDecimal(areaM2).mul(toDecimal(qtyPerM2));
}

export function decimalToString(value: Prisma.Decimal.Value | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return toDecimal(value).toFixed();
}
