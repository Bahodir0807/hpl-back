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

export const QUOTE_STATUS_TRANSITIONS: Record<string, QuoteStatus[]> = {
  [QUOTE_STATUS.DRAFT]: [QUOTE_STATUS.SENT],
  [QUOTE_STATUS.SENT]: [QUOTE_STATUS.APPROVED, QUOTE_STATUS.REJECTED],
  [QUOTE_STATUS.APPROVED]: [QUOTE_STATUS.CONVERTED],
  [QUOTE_STATUS.REJECTED]: [],
  [QUOTE_STATUS.CONVERTED]: [],
};

export const DEFAULT_QUOTE_VALIDITY_DAYS = 14;
