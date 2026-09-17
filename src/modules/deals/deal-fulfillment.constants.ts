export const CLIENT_DELIVERY_PERMISSION =
  'supplier_orders:confirm_client_delivery';
export const INSTALLATION_SCHEDULE_PERMISSION = 'installation:schedule';
export const INSTALLATION_ASSESS_PERMISSION = 'installation:assess';
export const INSTALLATION_CONFIRM_SUPERVISOR_PERMISSION =
  'installation:confirm_supervisor';

export const CLIENT_DELIVERY_FORBIDDEN_MESSAGE =
  'Client delivery may be confirmed only by MANAGER, HEAD, or DIRECTOR';
export const INSTALLATION_NOT_REQUIRED_MESSAGE =
  'Installation is not required for this deal';
export const CLIENT_DELIVERY_NOT_SHIPPED_MESSAGE =
  'Client delivery can be confirmed only after the supplier order is shipped';

export const FULFILLMENT_NOTIFICATION = {
  DEAL_COMPLETED: 'deal_completed',
} as const;

export const FULFILLMENT_AUDIT = {
  CLIENT_DELIVERY_CONFIRMED: 'CLIENT_DELIVERY_CONFIRMED',
  INSTALLATION_SCHEDULED: 'INSTALLATION_SCHEDULED',
  INSTALLATION_DATES_CHANGED: 'INSTALLATION_DATES_CHANGED',
  INSTALLATION_ASSESSED: 'INSTALLATION_ASSESSED',
  INSTALLATION_SUPERVISOR_CONFIRMED: 'INSTALLATION_SUPERVISOR_CONFIRMED',
  DEAL_COMPLETED: 'DEAL_COMPLETED',
} as const;
