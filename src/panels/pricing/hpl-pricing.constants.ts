import { Prisma } from '@prisma/client';

export const HPL_SOURCE_CURRENCY = 'CNY';
export const HPL_SELLING_CURRENCY = 'USD';
export const HPL_SELLING_COEFFICIENT = new Prisma.Decimal('2');

export const CURRENCY_RATES_MANAGE_PERMISSION = 'currency_rates:manage';

/** Development/test fixture only. Not a live market rate. */
export const HPL_FIXTURE_CNY_USD_RATE = '0.1';
export const HPL_FIXTURE_ECONOMY_10MM_CNY_PER_M2 = '100';
