export const INSTALLATION_PERMISSIONS = {
  READ: 'installation:read',
  UPDATE_TECHNICAL: 'installation:update_technical',
} as const;

export const INSTALLATION_PRICING_PERMISSIONS = {
  READ_COST: 'installation_pricing:read_cost',
  MANAGE_CONTRACTORS: 'installation_pricing:manage_contractors',
  MANAGE_RATES: 'installation_pricing:manage_rates',
  PREPARE: 'installation_pricing:prepare',
  APPROVE: 'installation_pricing:approve',
} as const;

export const INSTALLATION_PRICING_NOTIFICATION_TYPE = {
  TECHNICAL_READY: 'installation_pricing_technical_ready',
  READY_FOR_APPROVAL: 'installation_pricing_ready_for_approval',
  APPROVED: 'installation_pricing_approved',
  STALE_TECHNICAL: 'installation_pricing_stale_technical',
} as const;

export const INSTALLATION_PRICE_STATUS = {
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  ZERO: 'ZERO',
  CONFIGURED: 'CONFIGURED',
  INCOMPATIBLE_UNIT: 'INCOMPATIBLE_UNIT',
} as const;

export type InstallationPriceStatus =
  (typeof INSTALLATION_PRICE_STATUS)[keyof typeof INSTALLATION_PRICE_STATUS];
