export const FACADE_PRICING_PERMISSIONS = {
  READ_PURCHASE: 'facade_pricing:read_purchase',
  MANAGE_OFFERS: 'facade_pricing:manage_offers',
  PREPARE: 'facade_pricing:prepare',
  APPROVE: 'facade_pricing:approve',
} as const;

export const FACADE_PRICING_NOTIFICATION_TYPE = {
  TECHNICAL_READY: 'facade_pricing_technical_ready',
  APPROVED: 'facade_pricing_approved',
  STALE_TECHNICAL: 'facade_pricing_stale_technical',
} as const;

export const HPL_REFERENCE_MATERIAL_CODE = 'hpl_panel_1220_3050';

export const FACADE_PRICE_STATUS = {
  EXCLUDED: 'EXCLUDED',
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  ZERO: 'ZERO',
  CONFIGURED: 'CONFIGURED',
} as const;

export type FacadePriceStatus =
  (typeof FACADE_PRICE_STATUS)[keyof typeof FACADE_PRICE_STATUS];
