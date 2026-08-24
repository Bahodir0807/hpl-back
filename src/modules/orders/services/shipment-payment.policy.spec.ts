import { ConflictException } from '@nestjs/common';
import { PaymentStatus, SupplierOrderStatus } from '@prisma/client';
import {
  SHIPMENT_PAYMENT_NOT_CONFIRMED_MESSAGE,
  assertPaidForClientShipment,
  isClientShipmentSupplierStatus,
} from './shipment-payment.policy';

describe('shipment-payment.policy', () => {
  it('allows shipment only when paymentStatus is PAID', () => {
    expect(() => assertPaidForClientShipment(PaymentStatus.PAID)).not.toThrow();
  });

  it.each([
    PaymentStatus.UNPAID,
    PaymentStatus.PARTIALLY_PAID,
    undefined,
    null,
  ])('blocks shipment when paymentStatus is %s', (status) => {
    expect(() => assertPaidForClientShipment(status)).toThrow(
      ConflictException,
    );
    expect(() => assertPaidForClientShipment(status)).toThrow(
      SHIPMENT_PAYMENT_NOT_CONFIRMED_MESSAGE,
    );
  });

  it('treats supplier SHIPPED and DELIVERED as client shipment', () => {
    expect(isClientShipmentSupplierStatus(SupplierOrderStatus.SHIPPED)).toBe(
      true,
    );
    expect(isClientShipmentSupplierStatus(SupplierOrderStatus.DELIVERED)).toBe(
      true,
    );
    expect(
      isClientShipmentSupplierStatus(SupplierOrderStatus.READY_FOR_SHIPMENT),
    ).toBe(false);
    expect(isClientShipmentSupplierStatus(SupplierOrderStatus.DRAFT)).toBe(
      false,
    );
  });
});
