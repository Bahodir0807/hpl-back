import { Prisma } from '@prisma/client';

type ThicknessSource = {
  thicknessMm?: Prisma.Decimal | null;
  items?: Array<{ thicknessMm?: Prisma.Decimal | null }>;
};

function parseThicknessMm(
  value: Prisma.Decimal | number | string | null | undefined,
): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  try {
    const decimal =
      value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
    if (!decimal.isFinite() || decimal.lte(0)) {
      return null;
    }
    return decimal.toNumber();
  } catch {
    return null;
  }
}

export function collectQualificationHplThicknessesMm(
  qualification: ThicknessSource | null | undefined,
): number[] {
  if (!qualification) {
    return [];
  }

  const values = new Set<number>();
  const root = parseThicknessMm(qualification.thicknessMm);
  if (root !== null) {
    values.add(root);
  }
  for (const item of qualification.items ?? []) {
    const thickness = parseThicknessMm(item.thicknessMm);
    if (thickness !== null) {
      values.add(thickness);
    }
  }

  return [...values].sort((left, right) => left - right);
}

export function qualificationThicknessConflict(
  hplThicknessesMm: number[],
): boolean {
  return hplThicknessesMm.length > 1;
}

/** HPL panel thicknesses that map to approved facade subsystem norm sets. */
const FACADE_RELEVANT_HPL_THICKNESS_MM = new Set([4, 6, 8]);

export function requiresFacadeThicknessConfirmation(input: {
  hplThicknessesMm: number[];
  configHplThicknessMm: number | null | undefined;
  confirmThicknessMismatch?: boolean;
}): boolean {
  if (input.confirmThicknessMismatch === true) {
    return false;
  }

  if (qualificationThicknessConflict(input.hplThicknessesMm)) {
    return true;
  }

  const facadeRelevant = input.hplThicknessesMm.filter((value) =>
    FACADE_RELEVANT_HPL_THICKNESS_MM.has(value),
  );

  if (
    facadeRelevant.length === 1 &&
    input.configHplThicknessMm != null &&
    facadeRelevant[0] !== input.configHplThicknessMm
  ) {
    return true;
  }

  return false;
}
