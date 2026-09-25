import { BASE_FACADE_NORMS_V1 } from './facade-norms';
import { multiplyAreaByNorm } from './facade-decimal';
import { Prisma } from '@prisma/client';
import {
  FACADE_SYSTEM_TABLES,
  HPL_ADHESIVE_4MM,
  HPL_DRY_6MM_50MM,
  HPL_DRY_8MM_80MM,
} from './facade-system-tables';

describe('facade system tables', () => {
  it('keeps the historical Stage 2 quantities and does not rewrite those material codes', () => {
    const historicalCodes = new Set(BASE_FACADE_NORMS_V1.map((row) => row.code));
    const nextCodes = FACADE_SYSTEM_TABLES.flatMap((table) =>
      table.norms.map((row) => row.code),
    );
    expect(nextCodes.filter((code) => historicalCodes.has(code))).toEqual([]);
    expect(HPL_DRY_6MM_50MM.norms.map((row) => row.qtyPerM2)).toEqual(
      BASE_FACADE_NORMS_V1.map((row) => row.qtyPerM2),
    );
  });

  it('defines 18 dry 6 mm lines, 18 dry 8 mm lines and 10 adhesive lines', () => {
    expect(HPL_DRY_6MM_50MM.norms).toHaveLength(18);
    expect(HPL_DRY_8MM_80MM.norms).toHaveLength(18);
    expect(HPL_ADHESIVE_4MM.norms).toHaveLength(10);
    expect(HPL_ADHESIVE_4MM.norms.some((row) => row.category === 'HPL')).toBe(
      false,
    );
  });

  it('does not share bracket or dowel lines between 6 mm and 8 mm', () => {
    const six = HPL_DRY_6MM_50MM.norms;
    const eight = HPL_DRY_8MM_80MM.norms;
    expect(six[3].nameRu).toContain('50×100×80');
    expect(six[4].nameRu).toContain('50×100×100');
    expect(six[13].nameRu).toContain('8×115');
    expect(six[13].qtyPerM2).toBe('6.99');
    expect(eight[3].nameRu).toContain('50×130×80');
    expect(eight[4].nameRu).toContain('50×130×100');
    expect(eight[13].nameRu).toContain('8×135');
    expect(eight[13].qtyPerM2).toBe('7.26');
    expect(eight[1].nameRu).toContain('80 мм');
    expect(eight[2].nameRu).toBe('Мембрана НГ');
    const adhesiveCodes = new Set(HPL_ADHESIVE_4MM.norms.map((row) => row.code));
    expect(
      six.some((row) => adhesiveCodes.has(row.code)),
    ).toBe(false);
  });

  it('multiplies each published norm by cladding area without extra waste', () => {
    const area = new Prisma.Decimal('10');
    for (const table of FACADE_SYSTEM_TABLES) {
      for (const row of table.norms) {
        expect(multiplyAreaByNorm(area, row.qtyPerM2).toString()).toBe(
          new Prisma.Decimal(row.qtyPerM2).mul(area).toString(),
        );
      }
    }
  });
});
