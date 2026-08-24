import { Prisma } from '@prisma/client';
import type { HplApplication } from '@prisma/client';
import {
  FURNITURE_THICKNESS_MAX_MM,
  FURNITURE_THICKNESS_MIN_MM,
  HPL_DISCRETE_THICKNESS_MM,
  HPL_THICKNESS_MAX_DECIMAL_PLACES,
  canonicalizeHplApplication,
  type HplStandardApplication,
} from './hpl-catalog';

export const INVALID_THICKNESS_ERROR = 'INVALID_THICKNESS';

export type ThicknessInput =
  Prisma.Decimal | number | string | null | undefined;

export type ThicknessValidationFailure = {
  ok: false;
  errorCode: typeof INVALID_THICKNESS_ERROR;
  message: string;
};

export type ThicknessValidationSuccess = {
  ok: true;
  thicknessMm: Prisma.Decimal;
};

export type ThicknessValidationResult =
  ThicknessValidationSuccess | ThicknessValidationFailure;

const DISCRETE_THICKNESS = HPL_DISCRETE_THICKNESS_MM.map(
  (value) => new Prisma.Decimal(value),
);
const FURNITURE_MIN = new Prisma.Decimal(FURNITURE_THICKNESS_MIN_MM);
const FURNITURE_MAX = new Prisma.Decimal(FURNITURE_THICKNESS_MAX_MM);

export function parseThicknessMm(value: ThicknessInput): Prisma.Decimal | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  try {
    const thickness = new Prisma.Decimal(
      typeof value === 'string' ? value.trim() : value.toString(),
    );
    if (!thickness.isFinite() || thickness.lte(0)) {
      return null;
    }
    return thickness;
  } catch {
    return null;
  }
}

export function serializeThicknessMm(value: ThicknessInput): string | null {
  const thickness = parseThicknessMm(value);
  return thickness ? thickness.toString() : null;
}

export function transformThicknessInput(
  value: unknown,
): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || value === '') {
    return null;
  }

  const parsed = parseThicknessMm(
    typeof value === 'number' || typeof value === 'string'
      ? value
      : String(value),
  );
  return parsed ? parsed.toString() : String(value);
}

export function hasPositiveThickness(value: ThicknessInput): boolean {
  return parseThicknessMm(value) !== null;
}

export function isDiscreteHplThickness(thicknessMm: Prisma.Decimal): boolean {
  return DISCRETE_THICKNESS.some((allowed) => allowed.eq(thicknessMm));
}

export function isFurnitureContinuousThickness(
  thicknessMm: Prisma.Decimal,
): boolean {
  return thicknessMm.gte(FURNITURE_MIN) && thicknessMm.lte(FURNITURE_MAX);
}

function decimalPlaces(thicknessMm: Prisma.Decimal): number {
  const text = thicknessMm.toString();
  const dot = text.indexOf('.');
  return dot === -1 ? 0 : text.length - dot - 1;
}

export function validateHplThickness(
  application:
    HplApplication | HplStandardApplication | 'EXTERIOR' | null | undefined,
  value: ThicknessInput,
): ThicknessValidationResult {
  if (value === null || value === undefined || value === '') {
    return {
      ok: false,
      errorCode: INVALID_THICKNESS_ERROR,
      message: 'Толщина обязательна',
    };
  }

  const thicknessMm = parseThicknessMm(value);
  if (!thicknessMm) {
    return {
      ok: false,
      errorCode: INVALID_THICKNESS_ERROR,
      message: 'Толщина должна быть положительным числом',
    };
  }

  if (decimalPlaces(thicknessMm) > HPL_THICKNESS_MAX_DECIMAL_PLACES) {
    return {
      ok: false,
      errorCode: INVALID_THICKNESS_ERROR,
      message: `Толщина может содержать не более ${HPL_THICKNESS_MAX_DECIMAL_PLACES} знаков после запятой`,
    };
  }

  const canonical = canonicalizeHplApplication(application ?? undefined);
  if (!canonical) {
    return { ok: true, thicknessMm };
  }

  if (canonical === 'FURNITURE') {
    if (!isFurnitureContinuousThickness(thicknessMm)) {
      return {
        ok: false,
        errorCode: INVALID_THICKNESS_ERROR,
        message: `Для мебельного HPL толщина должна быть от ${FURNITURE_THICKNESS_MIN_MM} до ${FURNITURE_THICKNESS_MAX_MM} мм`,
      };
    }

    return { ok: true, thicknessMm };
  }

  if (!isDiscreteHplThickness(thicknessMm)) {
    return {
      ok: false,
      errorCode: INVALID_THICKNESS_ERROR,
      message:
        'Для этого типа HPL допустимы только стандартные толщины: 1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 18, 20, 25 мм',
    };
  }

  return { ok: true, thicknessMm };
}

export function assertValidHplThickness(
  application:
    HplApplication | HplStandardApplication | 'EXTERIOR' | null | undefined,
  value: ThicknessInput,
): Prisma.Decimal {
  const result = validateHplThickness(application, value);
  if (!result.ok) {
    throw Object.assign(new Error(result.message), {
      errorCode: result.errorCode,
    });
  }

  return result.thicknessMm;
}
