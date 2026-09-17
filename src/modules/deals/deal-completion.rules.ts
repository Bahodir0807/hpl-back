import {
  DealStage,
  FulfillmentSource,
  OrderStatus,
  PaymentStatus,
  SupplierOrderStatus,
} from '@prisma/client';

export type DealCompletionSnapshot = {
  stage: DealStage;
  completedAt: Date | null;
  paymentStatus: PaymentStatus | null | undefined;
  fulfillmentSource: FulfillmentSource | null | undefined;
  orderStatus: OrderStatus | null | undefined;
  supplierOrderStatuses: SupplierOrderStatus[];
  installationRequired: boolean | null | undefined;
  /** Legacy completion actor data retained for historical installation records. */
  installerConfirmedById?: string | null | undefined;
  supervisorConfirmedById: string | null | undefined;
  installationCompletedAt: Date | null | undefined;
};

export function isInstallationRequired(
  value: boolean | null | undefined,
): boolean {
  return value === true;
}

export function clientRequiredSupplierStatuses(
  statuses: SupplierOrderStatus[],
): SupplierOrderStatus[] {
  return statuses.filter((status) => status !== SupplierOrderStatus.CANCELLED);
}

export function areAllClientSupplierOrdersDelivered(
  statuses: SupplierOrderStatus[],
): boolean {
  const required = clientRequiredSupplierStatuses(statuses);
  if (required.length === 0) {
    return false;
  }

  return required.every((status) => status === SupplierOrderStatus.DELIVERED);
}

export function areMaterialsDelivered(input: {
  fulfillmentSource: FulfillmentSource | null | undefined;
  orderStatus: OrderStatus | null | undefined;
  supplierOrderStatuses: SupplierOrderStatus[];
}): boolean {
  if (input.fulfillmentSource === FulfillmentSource.SUPPLIER_ORDER) {
    return areAllClientSupplierOrdersDelivered(input.supplierOrderStatuses);
  }

  if (input.fulfillmentSource === FulfillmentSource.WAREHOUSE_STOCK) {
    return (
      input.orderStatus === OrderStatus.SHIPPED ||
      input.orderStatus === OrderStatus.COMPLETED
    );
  }

  return false;
}

export function evaluateDealCompletion(snapshot: DealCompletionSnapshot): {
  canCompleteDeal: boolean;
  canCompleteInstallation: boolean;
} {
  const canCompleteInstallation =
    snapshot.installationRequired === true &&
    !snapshot.installationCompletedAt &&
    Boolean(snapshot.supervisorConfirmedById);

  if (snapshot.completedAt || snapshot.stage === DealStage.LOST) {
    return { canCompleteDeal: false, canCompleteInstallation };
  }

  if (snapshot.stage !== DealStage.WON) {
    return { canCompleteDeal: false, canCompleteInstallation };
  }

  if (snapshot.installationRequired == null) {
    return { canCompleteDeal: false, canCompleteInstallation };
  }

  const paid = snapshot.paymentStatus === PaymentStatus.PAID;
  const delivered = areMaterialsDelivered(snapshot);

  if (!paid || !delivered) {
    return { canCompleteDeal: false, canCompleteInstallation };
  }

  if (snapshot.installationRequired === true) {
    return {
      canCompleteDeal: canCompleteInstallation,
      canCompleteInstallation,
    };
  }

  return { canCompleteDeal: true, canCompleteInstallation };
}
