import {
  DealStage,
  FulfillmentSource,
  OrderStatus,
  PaymentStatus,
  SupplierOrderStatus,
} from '@prisma/client';
import {
  areAllClientSupplierOrdersDelivered,
  areMaterialsDelivered,
  evaluateDealCompletion,
  isInstallationDualConfirmed,
  isInstallationRequired,
} from './deal-completion.rules';

describe('deal completion rules', () => {
  const base = {
    stage: DealStage.WON,
    completedAt: null,
    paymentStatus: PaymentStatus.PAID,
    fulfillmentSource: FulfillmentSource.SUPPLIER_ORDER,
    orderStatus: OrderStatus.PENDING,
    supplierOrderStatuses: [SupplierOrderStatus.DELIVERED],
    installationRequired: false,
    installerConfirmedById: null,
    supervisorConfirmedById: null,
    installationCompletedAt: null,
  };

  it('treats only explicit true as installation required', () => {
    expect(isInstallationRequired(true)).toBe(true);
    expect(isInstallationRequired(false)).toBe(false);
    expect(isInstallationRequired(null)).toBe(false);
    expect(isInstallationRequired(undefined)).toBe(false);
  });

  it('requires every non-cancelled client SupplierOrder to be DELIVERED', () => {
    expect(
      areAllClientSupplierOrdersDelivered([
        SupplierOrderStatus.DELIVERED,
        SupplierOrderStatus.SHIPPED,
      ]),
    ).toBe(false);
    expect(
      areAllClientSupplierOrdersDelivered([
        SupplierOrderStatus.DELIVERED,
        SupplierOrderStatus.DELIVERED,
      ]),
    ).toBe(true);
    expect(areAllClientSupplierOrdersDelivered([])).toBe(false);
    expect(
      areAllClientSupplierOrdersDelivered([SupplierOrderStatus.CANCELLED]),
    ).toBe(false);
    expect(
      areAllClientSupplierOrdersDelivered([
        SupplierOrderStatus.DELIVERED,
        SupplierOrderStatus.CANCELLED,
      ]),
    ).toBe(true);
  });

  it('treats supplier DELIVERED and warehouse SHIPPED/COMPLETED as materials delivered', () => {
    expect(
      areMaterialsDelivered({
        fulfillmentSource: FulfillmentSource.SUPPLIER_ORDER,
        orderStatus: OrderStatus.PENDING,
        supplierOrderStatuses: [SupplierOrderStatus.DELIVERED],
      }),
    ).toBe(true);
    expect(
      areMaterialsDelivered({
        fulfillmentSource: FulfillmentSource.WAREHOUSE_STOCK,
        orderStatus: OrderStatus.SHIPPED,
        supplierOrderStatuses: [],
      }),
    ).toBe(true);
    expect(
      areMaterialsDelivered({
        fulfillmentSource: FulfillmentSource.SUPPLIER_ORDER,
        orderStatus: OrderStatus.PENDING,
        supplierOrderStatuses: [SupplierOrderStatus.SHIPPED],
      }),
    ).toBe(false);
  });

  it('requires distinct installer and supervisor user ids', () => {
    expect(
      isInstallationDualConfirmed({
        installerConfirmedById: 'installer',
        supervisorConfirmedById: 'head',
      }),
    ).toBe(true);
    expect(
      isInstallationDualConfirmed({
        installerConfirmedById: 'same',
        supervisorConfirmedById: 'same',
      }),
    ).toBe(false);
    expect(
      isInstallationDualConfirmed({
        installerConfirmedById: 'installer',
        supervisorConfirmedById: null,
      }),
    ).toBe(false);
  });

  it('completes a fully paid delivered deal without installation', () => {
    expect(evaluateDealCompletion(base).canCompleteDeal).toBe(true);
  });

  it('does not complete when one SupplierOrder is still SHIPPED', () => {
    expect(
      evaluateDealCompletion({
        ...base,
        supplierOrderStatuses: [
          SupplierOrderStatus.DELIVERED,
          SupplierOrderStatus.SHIPPED,
        ],
      }).canCompleteDeal,
    ).toBe(false);
  });

  it('completes a fully shipped warehouse-stock Deal', () => {
    expect(
      evaluateDealCompletion({
        ...base,
        fulfillmentSource: FulfillmentSource.WAREHOUSE_STOCK,
        orderStatus: OrderStatus.SHIPPED,
        supplierOrderStatuses: [],
      }).canCompleteDeal,
    ).toBe(true);
  });

  it('does not complete a partially shipped warehouse-stock Deal', () => {
    expect(
      evaluateDealCompletion({
        ...base,
        fulfillmentSource: FulfillmentSource.WAREHOUSE_STOCK,
        orderStatus: OrderStatus.PARTIALLY_SHIPPED,
        supplierOrderStatuses: [],
      }).canCompleteDeal,
    ).toBe(false);
  });

  it('does not complete before the Deal is WON', () => {
    expect(
      evaluateDealCompletion({ ...base, stage: DealStage.NEGOTIATION })
        .canCompleteDeal,
    ).toBe(false);
  });

  it('does not guess a historical null installation obligation', () => {
    expect(
      evaluateDealCompletion({ ...base, installationRequired: null })
        .canCompleteDeal,
    ).toBe(false);
  });

  it('does not complete when payment is only PARTIALLY_PAID', () => {
    expect(
      evaluateDealCompletion({
        ...base,
        paymentStatus: PaymentStatus.PARTIALLY_PAID,
      }).canCompleteDeal,
    ).toBe(false);
  });

  it('does not complete an installation deal without both confirmations', () => {
    expect(
      evaluateDealCompletion({
        ...base,
        installationRequired: true,
      }).canCompleteDeal,
    ).toBe(false);
    expect(
      evaluateDealCompletion({
        ...base,
        installationRequired: true,
        installerConfirmedById: 'installer',
      }).canCompleteDeal,
    ).toBe(false);
    expect(
      evaluateDealCompletion({
        ...base,
        installationRequired: true,
        supervisorConfirmedById: 'head',
      }).canCompleteDeal,
    ).toBe(false);
  });

  it('completes when installer and HEAD or DIRECTOR are distinct', () => {
    expect(
      evaluateDealCompletion({
        ...base,
        installationRequired: true,
        installerConfirmedById: 'installer',
        supervisorConfirmedById: 'head',
      }).canCompleteDeal,
    ).toBe(true);
    expect(
      evaluateDealCompletion({
        ...base,
        installationRequired: true,
        installerConfirmedById: 'installer',
        supervisorConfirmedById: 'director',
      }).canCompleteDeal,
    ).toBe(true);
  });

  it('does not treat HEAD+DIRECTOR as installation completion', () => {
    expect(
      evaluateDealCompletion({
        ...base,
        installationRequired: true,
        installerConfirmedById: null,
        supervisorConfirmedById: 'head',
      }).canCompleteDeal,
    ).toBe(false);
  });

  it('does not complete a LOST deal or rewrite completedAt', () => {
    expect(
      evaluateDealCompletion({
        ...base,
        stage: DealStage.LOST,
      }).canCompleteDeal,
    ).toBe(false);
    expect(
      evaluateDealCompletion({
        ...base,
        completedAt: new Date('2026-08-01T00:00:00.000Z'),
      }).canCompleteDeal,
    ).toBe(false);
  });
});
