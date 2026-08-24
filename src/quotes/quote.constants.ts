export const QUOTE_STATUS = {
  DRAFT: 'draft',
  SENT: 'sent',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  CONVERTED: 'converted',
} as const;

export type QuoteStatus = (typeof QUOTE_STATUS)[keyof typeof QUOTE_STATUS];

export const QUOTE_PERMISSIONS = {
  READ: 'quotes:read',
  READ_ALL: 'quotes:read_all',
  CREATE: 'quotes:create',
  UPDATE: 'quotes:update',
  APPROVE: 'quotes:approve',
  CLIENT_ACCEPT: 'quotes:client_accept',
} as const;

/**
 * MANAGER customer-facing authority to write Quote Примечание
 * (`quotes:client_accept`). HEAD mutates the same Quote note via `quotes:approve`.
 * Lead handoff Manager note stays manager-only (`canWriteQuoteCommercialNote`).
 */
export const QUOTE_COMMERCIAL_NOTE_PERMISSION = QUOTE_PERMISSIONS.CLIENT_ACCEPT;

/** HEAD-owned client-facing КП fields (production, delivery, validity). */
export function canWriteQuoteClientFacingTerms(
  permissions: readonly string[],
): boolean {
  return permissions.includes(QUOTE_PERMISSIONS.APPROVE);
}

export function canWriteQuoteCommercialNote(
  permissions: readonly string[],
): boolean {
  return permissions.includes(QUOTE_COMMERCIAL_NOTE_PERMISSION);
}

export function canMutateQuoteCommercialNote(
  permissions: readonly string[],
): boolean {
  return permissions.includes(QUOTE_PERMISSIONS.APPROVE);
}

export const QUOTE_STATUS_TRANSITIONS: Record<string, QuoteStatus[]> = {
  [QUOTE_STATUS.DRAFT]: [QUOTE_STATUS.SENT],
  [QUOTE_STATUS.SENT]: [QUOTE_STATUS.APPROVED, QUOTE_STATUS.REJECTED],
  [QUOTE_STATUS.APPROVED]: [QUOTE_STATUS.CONVERTED],
  [QUOTE_STATUS.REJECTED]: [],
  [QUOTE_STATUS.CONVERTED]: [],
};

export const DEFAULT_QUOTE_VALIDITY_DAYS = 14;

/** Calculator snapshot is reference-only until HEAD explicitly approves it. */
export const QUOTE_PRICE_NOT_APPROVED = 'QUOTE_PRICE_NOT_APPROVED';
