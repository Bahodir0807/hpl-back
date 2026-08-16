export const CALCULATION_STATUS = {
  DRAFT: 'draft',
  FINALIZED: 'finalized',
} as const;

export type CalculationStatus =
  (typeof CALCULATION_STATUS)[keyof typeof CALCULATION_STATUS];

export const CALCULATION_PERMISSIONS = {
  READ: 'calculations:read',
  READ_ALL: 'calculations:read_all',
  CREATE: 'calculations:create',
  UPDATE: 'calculations:update',
  DELETE: 'calculations:delete',
} as const;

export const LEADS_READ_ALL_PERMISSION = 'leads:read_all';
