import { Prisma } from '@prisma/client';
import {
  parseThicknessMm,
  serializeThicknessMm,
  validateHplThickness,
} from './hpl-thickness';

describe('HPL thickness policy', () => {
  it('accepts furniture continuous thicknesses 0.5, 1.5 and 2.9', () => {
    expect(validateHplThickness('FURNITURE', '0.5')).toEqual({
      ok: true,
      thicknessMm: new Prisma.Decimal('0.5'),
    });
    expect(validateHplThickness('FURNITURE', 1.5).ok).toBe(true);
    expect(validateHplThickness('FURNITURE', '2.9').ok).toBe(true);
  });

  it('rejects furniture thicknesses outside 0.5–2.9', () => {
    expect(validateHplThickness('FURNITURE', '0.49').ok).toBe(false);
    expect(validateHplThickness('FURNITURE', '3.0').ok).toBe(false);
    expect(validateHplThickness('FURNITURE', 3).ok).toBe(false);
  });

  it('rejects arbitrary decimals for non-furniture standard types', () => {
    for (const application of [
      'INTERIOR',
      'EXTERIOR_WITH_UV',
      'LABORATORY',
    ] as const) {
      expect(validateHplThickness(application, '1.5').ok).toBe(false);
      expect(validateHplThickness(application, 10).ok).toBe(true);
      expect(validateHplThickness(application, '8').ok).toBe(true);
      expect(validateHplThickness(application, '16').ok).toBe(false);
    }
  });

  it('keeps historical integer thickness readable as Decimal', () => {
    const migrated = parseThicknessMm(10);
    expect(migrated?.toString()).toBe('10');
    expect(serializeThicknessMm(migrated)).toBe('10');
    expect(validateHplThickness('INTERIOR', migrated).ok).toBe(true);
  });
});
