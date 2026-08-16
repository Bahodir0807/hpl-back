import { ConflictException } from '@nestjs/common';
import { PaymentStatus, SupplierOrderStatus } from '@prisma/client';

export const SHIPMENT_PAYMENT_NOT_CONFIRMED_MESSAGE =
  'Delivery blocked because required payment is not confirmed';

const CLIENT_SHIPMENT_SUPPLIER_STATUSES: SupplierOrderStatus[] = [
  SupplierOrderStatus.SHIPPED,
  SupplierOrderStatus.DELIVERED,
];

export function isClientShipmentSupplierStatus(
  status: SupplierOrderStatus,
): boolean {
  return CLIENT_SHIPMENT_SUPPLIER_STATUSES.includes(status);
}

export function assertPaidForClientShipment(
  paymentStatus: PaymentStatus | null | undefined,
): void {
  if (paymentStatus !== PaymentStatus.PAID) {
    throw new ConflictException(SHIPMENT_PAYMENT_NOT_CONFIRMED_MESSAGE);
  }
}
