export const CALCULATION_STATUS = {
  DRAFT: 'draft',
  FINALIZED: 'finalized',
} as const;

export type CalculationStatus =
  (typeof CALCULATION_STATUS)[keyof typeof CALCULATION_STATUS];

export const CALCULATION_REQUEST_STATUS = {
  DRAFT: 'draft',
  SUBMITTED: 'submitted',
  PROCESSING: 'processing',
  QUOTED: 'quoted',
} as const;

export type CalculationRequestStatus =
  (typeof CALCULATION_REQUEST_STATUS)[keyof typeof CALCULATION_REQUEST_STATUS];

export const CALCULATION_PERMISSIONS = {
  READ: 'calculations:read',
  READ_ALL: 'calculations:read_all',
  CREATE: 'calculations:create',
  UPDATE: 'calculations:update',
  DELETE: 'calculations:delete',
} as const;

export const LEADS_READ_ALL_PERMISSION = 'leads:read_all';

/** HEAD-only commercial authority to enter a calculation purchase price. */
export const MANUAL_PURCHASE_PRICE_PERMISSION = 'leads:commercial_qualify';

export const QUOTE_COMMERCIAL_CURRENCIES = ['USD', 'UZS'] as const;
export type QuoteCommercialCurrency =
  (typeof QUOTE_COMMERCIAL_CURRENCIES)[number];
