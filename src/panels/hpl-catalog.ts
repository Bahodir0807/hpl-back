import { Prisma } from '@prisma/client';
import type { HplApplication } from '@prisma/client';

/**
 * Canonical HPL product reference for MVP.
 *
 * Migration decision: historical HplApplication.EXTERIOR and PanelType.code
 * "exterior" mean the confirmed exterior-with-UV product in this CRM.
 * They are remapped to EXTERIOR_WITH_UV / exterior_with_uv. EXTERIOR is not a
 * competing standard business value; request-body aliasing is internal only.
 *
 * OTHER is not a standard HPL type. It is a custom/manual path and is not stored
 * on HplApplication.
 */
export const HPL_STANDARD_APPLICATIONS = [
  'INTERIOR',
  'EXTERIOR_WITH_UV',
  'LABORATORY',
  'FURNITURE',
] as const;

export type HplStandardApplication = (typeof HPL_STANDARD_APPLICATIONS)[number];

export const HPL_PANEL_TYPE_CODES = {
  INTERIOR: 'interior',
  EXTERIOR_WITH_UV: 'exterior_with_uv',
  LABORATORY: 'laboratory',
  FURNITURE: 'furniture',
} as const;

export type HplPanelTypeCode =
  (typeof HPL_PANEL_TYPE_CODES)[keyof typeof HPL_PANEL_TYPE_CODES];

export const HPL_PANEL_TYPE_DISPLAY_RU: Record<HplPanelTypeCode, string> = {
  interior: 'Интерьерный',
  exterior_with_uv: 'Exterior с УФ',
  laboratory: 'Лабораторный',
  furniture: 'Мебельный',
};

export const HPL_APPLICATION_ALIASES: Record<string, HplStandardApplication> = {
  EXTERIOR: 'EXTERIOR_WITH_UV',
};

export const HPL_PANEL_TYPE_CODE_ALIASES: Record<string, HplPanelTypeCode> = {
  exterior: 'exterior_with_uv',
};

export const HPL_CANONICAL_PANEL_SIZES = [
  { widthMm: 1220, heightMm: 1830 },
  { widthMm: 1220, heightMm: 2440 },
  { widthMm: 1220, heightMm: 2800 },
  { widthMm: 1220, heightMm: 3050 },
  { widthMm: 1220, heightMm: 3660 },
  { widthMm: 1220, heightMm: 4270 },
  { widthMm: 1300, heightMm: 1830 },
  { widthMm: 1300, heightMm: 2440 },
  { widthMm: 1300, heightMm: 2800 },
  { widthMm: 1300, heightMm: 3050 },
  { widthMm: 1300, heightMm: 3660 },
  { widthMm: 1300, heightMm: 4270 },
  { widthMm: 1525, heightMm: 1830 },
  { widthMm: 1525, heightMm: 2440 },
  { widthMm: 1525, heightMm: 2800 },
  { widthMm: 1525, heightMm: 3050 },
  { widthMm: 1525, heightMm: 3660 },
  { widthMm: 1525, heightMm: 4270 },
  { widthMm: 1830, heightMm: 1830 },
  { widthMm: 1830, heightMm: 2440 },
  { widthMm: 1830, heightMm: 2800 },
  { widthMm: 1830, heightMm: 3050 },
  { widthMm: 1830, heightMm: 3660 },
  { widthMm: 1830, heightMm: 4270 },
] as const;

export const HPL_DISCRETE_THICKNESS_MM = [
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '8',
  '10',
  '12',
  '15',
  '18',
  '20',
  '25',
] as const;

export const FURNITURE_THICKNESS_MIN_MM = '0.5';
export const FURNITURE_THICKNESS_MAX_MM = '2.9';
export const HPL_THICKNESS_MAX_DECIMAL_PLACES = 2;

export const HPL_QUALITY_CLASS_CODES = [
  'economy',
  'medium',
  'premium',
] as const;

/** Non-standard HPL type. Not an HplApplication enum value; stores a manual description. */
export const HPL_CUSTOM_PANEL_TYPE_CODE = 'other' as const;
export const HPL_CUSTOM_PANEL_TYPE_DISPLAY_RU = 'Другой';

export function canonicalizeHplApplication(
  value: string | null | undefined,
): HplStandardApplication | null {
  if (value == null || value === '') {
    return null;
  }

  const aliased = HPL_APPLICATION_ALIASES[value] ?? value;
  return HPL_STANDARD_APPLICATIONS.includes(aliased) ? aliased : null;
}

export function canonicalizePanelTypeCode(
  value: string | null | undefined,
): HplPanelTypeCode | null {
  if (value == null || value === '') {
    return null;
  }

  const aliased = HPL_PANEL_TYPE_CODE_ALIASES[value] ?? value;
  return Object.values(HPL_PANEL_TYPE_CODES).includes(aliased) ? aliased : null;
}

export function panelTypeCodeForApplication(
  application: HplApplication | HplStandardApplication | 'EXTERIOR',
): HplPanelTypeCode {
  const canonical = canonicalizeHplApplication(application);
  if (!canonical) {
    throw new Error(`Unsupported HPL application: ${application}`);
  }

  return HPL_PANEL_TYPE_CODES[canonical];
}

export function resolvePanelTypeQuery(
  value: string | null | undefined,
): HplPanelTypeCode | null {
  const asCode = canonicalizePanelTypeCode(value);
  if (asCode) {
    return asCode;
  }

  const asApplication = canonicalizeHplApplication(value);
  return asApplication ? HPL_PANEL_TYPE_CODES[asApplication] : null;
}

export function applicationForPanelTypeCode(
  value: string | null | undefined,
): HplStandardApplication | null {
  const fromApplication = canonicalizeHplApplication(value);
  if (fromApplication) {
    return fromApplication;
  }

  const code = canonicalizePanelTypeCode(value);
  if (!code) {
    return null;
  }

  const match = (
    Object.keys(HPL_PANEL_TYPE_CODES) as HplStandardApplication[]
  ).find((application) => HPL_PANEL_TYPE_CODES[application] === code);
  return match ?? null;
}

export function supplierQualityMatrixApplies(
  application: HplApplication | HplStandardApplication | 'EXTERIOR' | null,
): boolean {
  return canonicalizeHplApplication(application ?? undefined) !== null;
}

export function panelSizeDisplayName(
  widthMm: number,
  heightMm: number,
): string {
  return `${widthMm}×${heightMm}`;
}

export function panelSizeAreaM2(
  widthMm: number,
  heightMm: number,
): Prisma.Decimal {
  return new Prisma.Decimal(widthMm).mul(heightMm).div(1_000_000);
}

export function isCanonicalPanelSize(
  widthMm: number,
  heightMm: number,
): boolean {
  return HPL_CANONICAL_PANEL_SIZES.some(
    (size) => size.widthMm === widthMm && size.heightMm === heightMm,
  );
}
