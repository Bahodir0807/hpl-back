import { SupplierOrderStatus } from '@prisma/client';

export const SUPPLIER_ORDER_PERMISSIONS = {
  MANAGE: 'supplier_orders:manage',
  CONFIRM_CLIENT_DELIVERY: 'supplier_orders:confirm_client_delivery',
} as const;

export const SUPPLIER_ORDER_REMINDER_KIND = {
  SOFT: 'READY_SOFT',
  DUE: 'READY_DUE',
  OVERDUE: 'READY_OVERDUE',
} as const;

export type SupplierOrderReminderKind =
  (typeof SUPPLIER_ORDER_REMINDER_KIND)[keyof typeof SUPPLIER_ORDER_REMINDER_KIND];

export const SUPPLIER_ORDER_REMINDER_TYPE = {
  SOFT: 'supplier_order_ready_soft',
  DUE: 'supplier_order_ready_due',
  OVERDUE: 'supplier_order_ready_overdue',
} as const;

export const SUPPLIER_ORDER_STATUS_TRANSITIONS: Record<
  SupplierOrderStatus,
  SupplierOrderStatus[]
> = {
  [SupplierOrderStatus.DRAFT]: [
    SupplierOrderStatus.SENT_TO_PRODUCTION,
    SupplierOrderStatus.IN_PRODUCTION,
    SupplierOrderStatus.READY_FOR_SHIPMENT,
    SupplierOrderStatus.CANCELLED,
  ],
  [SupplierOrderStatus.SENT_TO_PRODUCTION]: [
    SupplierOrderStatus.IN_PRODUCTION,
    SupplierOrderStatus.READY_FOR_SHIPMENT,
    SupplierOrderStatus.CANCELLED,
  ],
  [SupplierOrderStatus.IN_PRODUCTION]: [
    SupplierOrderStatus.READY_FOR_SHIPMENT,
    SupplierOrderStatus.CANCELLED,
  ],
  [SupplierOrderStatus.READY_FOR_SHIPMENT]: [
    SupplierOrderStatus.SHIPPED,
    SupplierOrderStatus.CANCELLED,
  ],
  [SupplierOrderStatus.SHIPPED]: [SupplierOrderStatus.DELIVERED],
  [SupplierOrderStatus.DELIVERED]: [],
  [SupplierOrderStatus.CANCELLED]: [],
};

export const READY_CONFIRMABLE_STATUSES: SupplierOrderStatus[] = [
  SupplierOrderStatus.DRAFT,
  SupplierOrderStatus.SENT_TO_PRODUCTION,
  SupplierOrderStatus.IN_PRODUCTION,
  SupplierOrderStatus.READY_FOR_SHIPMENT,
];

export const READINESS_REMINDER_STOP_STATUSES: SupplierOrderStatus[] = [
  SupplierOrderStatus.READY_FOR_SHIPMENT,
  SupplierOrderStatus.SHIPPED,
  SupplierOrderStatus.DELIVERED,
  SupplierOrderStatus.CANCELLED,
];
