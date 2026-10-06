import { Prisma } from '@prisma/client';
import {
  collectQualificationHplThicknessesMm,
  qualificationThicknessConflict,
  requiresFacadeThicknessConfirmation,
} from './facade-qualification-thickness';

describe('facade qualification thickness', () => {
  it('collects unique thicknesses from root and line items', () => {
    expect(
      collectQualificationHplThicknessesMm({
        thicknessMm: new Prisma.Decimal('6'),
        items: [
          { thicknessMm: new Prisma.Decimal('8') },
          { thicknessMm: new Prisma.Decimal('6') },
        ],
      }),
    ).toEqual([6, 8]);
  });

  it('marks mixed thickness as conflict', () => {
    expect(qualificationThicknessConflict([6, 8])).toBe(true);
    expect(qualificationThicknessConflict([6])).toBe(false);
    expect(qualificationThicknessConflict([])).toBe(false);
  });

  it('requires confirmation for mixed thickness without explicit flag', () => {
    expect(
      requiresFacadeThicknessConfirmation({
        hplThicknessesMm: [6, 8],
        configHplThicknessMm: 6,
        confirmThicknessMismatch: false,
      }),
    ).toBe(true);
    expect(
      requiresFacadeThicknessConfirmation({
        hplThicknessesMm: [6, 8],
        configHplThicknessMm: 6,
        confirmThicknessMismatch: true,
      }),
    ).toBe(false);
  });

  it('requires confirmation when sole facade-relevant thickness differs from system', () => {
    expect(
      requiresFacadeThicknessConfirmation({
        hplThicknessesMm: [6],
        configHplThicknessMm: 8,
      }),
    ).toBe(true);
    expect(
      requiresFacadeThicknessConfirmation({
        hplThicknessesMm: [6],
        configHplThicknessMm: 6,
        confirmThicknessMismatch: false,
      }),
    ).toBe(false);
  });

  it('does not require confirmation for non-facade qualification thickness such as 10 mm', () => {
    expect(
      requiresFacadeThicknessConfirmation({
        hplThicknessesMm: [10],
        configHplThicknessMm: 6,
      }),
    ).toBe(false);
  });
});
