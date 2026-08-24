import { BadRequestException, ConflictException } from '@nestjs/common';
import { ExpectedReceiptStatus, StockReservationStatus } from '@prisma/client';
import { InventoryService } from './inventory.service';

function createPrismaMock() {
  const receipt = {
    id: 'receipt-1',
    supplierId: 'supplier-1',
    orderedAt: new Date('2026-08-18T09:00:00.000Z'),
    expectedDate: new Date('2026-08-25T09:00:00.000Z'),
    status: ExpectedReceiptStatus.PENDING,
    comment: null,
    createdById: 'head-1',
    createdAt: new Date('2026-08-18T09:00:00.000Z'),
    updatedAt: new Date('2026-08-18T09:00:00.000Z'),
    items: [
      {
        id: 'item-1',
        expectedReceiptId: 'receipt-1',
        productId: 'product-1',
        quantity: 100,
        receivedQuantity: 0,
        createdAt: new Date('2026-08-18T09:00:00.000Z'),
        updatedAt: new Date('2026-08-18T09:00:00.000Z'),
      },
    ],
  };
  const stockBalance = {
    id: 'balance-1',
    productId: 'product-1',
    onHand: 0,
    reserved: 0,
    available: 0,
    version: 0,
  };
  const events: unknown[] = [];
  const eventItems: unknown[] = [];
  const audits: unknown[] = [];

  const tx = {
    order: { findMany: jest.fn(async () => []) },
    expectedReceipt: {
      updateMany: jest.fn(async ({ where }: { where: { id: string } }) => ({
        count: where.id === receipt.id ? 1 : 0,
      })),
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
        where.id === receipt.id
          ? {
              ...receipt,
              supplier: null,
              createdBy: null,
              receiptEvents: events,
              items: receipt.items.map((item) => ({ ...item })),
            }
          : null,
      ),
      findUniqueOrThrow: jest.fn(
        async ({ where }: { where: { id: string } }) => {
          if (where.id !== receipt.id) throw new Error('not found');
          return {
            ...receipt,
            items: receipt.items.map((item) => ({ ...item })),
          };
        },
      ),
      update: jest.fn(
        async ({ data }: { data: { status?: ExpectedReceiptStatus } }) => {
          if (data.status) {
            receipt.status = data.status;
          }
          return { ...receipt };
        },
      ),
    },
    expectedReceiptItem: {
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: {
            id: string;
            receivedQuantity: { lte: number };
          };
          data: { receivedQuantity: { increment: number } };
        }) => {
          const item = receipt.items.find(
            (candidate) => candidate.id === where.id,
          );
          if (!item || item.receivedQuantity > where.receivedQuantity.lte) {
            return { count: 0 };
          }
          item.receivedQuantity += data.receivedQuantity.increment;
          return { count: 1 };
        },
      ),
      findMany: jest.fn(async () => receipt.items.map((item) => ({ ...item }))),
    },
    expectedReceiptEvent: {
      findFirst: jest.fn(
        async ({ where }: { where: { clientReceiptId?: string | null } }) =>
          events.find(
            (event) =>
              (event as { clientReceiptId?: string | null }).clientReceiptId ===
              where.clientReceiptId,
          ) ?? null,
      ),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const event = { id: `event-${events.length + 1}`, ...data };
        events.push(event);
        return event;
      }),
    },
    expectedReceiptEventItem: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        eventItems.push(data);
        return { id: `event-item-${eventItems.length}`, ...data };
      }),
    },
    stockBalance: {
      findUnique: jest.fn(async () => ({ ...stockBalance })),
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { version: number };
          data: {
            onHand: { increment: number };
            available: { increment: number };
            version: { increment: number };
          };
        }) => {
          if (where.version !== stockBalance.version) {
            return { count: 0 };
          }
          stockBalance.onHand += data.onHand.increment;
          stockBalance.available += data.available.increment;
          stockBalance.version += data.version.increment;
          return { count: 1 };
        },
      ),
      create: jest.fn(),
    },
    auditLog: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        audits.push(data);
        return data;
      }),
    },
  };

  const prisma = {
    ...tx,
    $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
  };

  return { prisma, receipt, stockBalance, events, eventItems };
}

describe('InventoryService warehouse purchase receiving', () => {
  it('records partial receipts and increases stock only by accepted quantity', async () => {
    const { prisma, receipt, stockBalance, eventItems } = createPrismaMock();
    const service = new InventoryService(prisma as never);

    await service.processReceipt(
      'receipt-1',
      {
        clientReceiptId: 'physical-doc-1',
        comment: '70 accepted, 5 damaged',
        items: [
          {
            itemId: 'item-1',
            acceptedQuantity: 70,
            rejectedQuantity: 5,
          },
        ],
      },
      'storekeeper-1',
    );

    expect(receipt.items[0].receivedQuantity).toBe(70);
    expect(receipt.status).toBe(ExpectedReceiptStatus.PARTIALLY_RECEIVED);
    expect(stockBalance.onHand).toBe(70);
    expect(stockBalance.available).toBe(70);
    expect(eventItems).toContainEqual(
      expect.objectContaining({
        acceptedQuantity: 70,
        rejectedQuantity: 5,
      }),
    );
  });

  it('rejects over-receipt without increasing stock', async () => {
    const { prisma, stockBalance } = createPrismaMock();
    const service = new InventoryService(prisma as never);

    await expect(
      service.processReceipt(
        'receipt-1',
        {
          items: [{ itemId: 'item-1', acceptedQuantity: 101 }],
        },
        'storekeeper-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(stockBalance.onHand).toBe(0);
  });

  it('does not double-apply a repeated receipt idempotency key', async () => {
    const { prisma, receipt, stockBalance, events } = createPrismaMock();
    const service = new InventoryService(prisma as never);
    const dto = {
      clientReceiptId: 'retry-key-1',
      items: [{ itemId: 'item-1', acceptedQuantity: 30 }],
    };

    await service.processReceipt('receipt-1', dto, 'storekeeper-1');
    await service.processReceipt('receipt-1', dto, 'storekeeper-1');

    expect(receipt.items[0].receivedQuantity).toBe(30);
    expect(stockBalance.onHand).toBe(30);
    expect(events).toHaveLength(1);
  });
});

describe('InventoryService reservation consumption', () => {
  function createReservationTx(quantity: number) {
    const reservation = {
      id: 'reservation-1',
      orderId: 'order-1',
      productId: 'product-1',
      quantity,
      status: StockReservationStatus.ACTIVE,
      createdAt: new Date('2026-08-18T09:00:00.000Z'),
    };
    const balance = {
      id: 'balance-1',
      productId: 'product-1',
      onHand: quantity,
      reserved: quantity,
      available: 0,
      version: 0,
    };
    const tx = {
      stockReservation: {
        findMany: jest.fn(async () =>
          reservation.status === StockReservationStatus.ACTIVE
            ? [{ ...reservation }]
            : [],
        ),
        updateMany: jest.fn(async ({ where, data }: any) => {
          if (
            reservation.status !== where.status ||
            reservation.quantity !== where.quantity
          ) {
            return { count: 0 };
          }
          if (data.status) reservation.status = data.status;
          if (data.quantity?.decrement) {
            reservation.quantity -= data.quantity.decrement;
          }
          return { count: 1 };
        }),
      },
      stockBalance: {
        findUnique: jest.fn(async () => ({ ...balance })),
        updateMany: jest.fn(async ({ where, data }: any) => {
          if (
            balance.version !== where.version ||
            balance.onHand < where.onHand.gte ||
            balance.reserved < where.reserved.gte
          ) {
            return { count: 0 };
          }
          balance.onHand -= data.onHand.decrement;
          balance.reserved -= data.reserved.decrement;
          balance.version += data.version.increment;
          return { count: 1 };
        }),
      },
      auditLog: { create: jest.fn(async () => ({})) },
    };
    return { tx, reservation, balance };
  }

  it('keeps only the undelivered quantity active and closes it on final delivery', async () => {
    const { tx, reservation, balance } = createReservationTx(100);
    const service = new InventoryService({} as never);

    await service.commitReservation(
      'order-1',
      [{ productId: 'product-1', quantity: 70 }],
      tx as never,
      'storekeeper-1',
    );

    expect(reservation).toMatchObject({
      quantity: 30,
      status: StockReservationStatus.ACTIVE,
    });
    expect(balance).toMatchObject({ onHand: 30, reserved: 30, available: 0 });

    await service.commitReservation(
      'order-1',
      [{ productId: 'product-1', quantity: 30 }],
      tx as never,
      'storekeeper-1',
    );

    expect(reservation.status).toBe(StockReservationStatus.FULFILLED);
    expect(balance).toMatchObject({ onHand: 0, reserved: 0, available: 0 });
  });

  it('uses stock version CAS so concurrent partial deliveries cannot over-consume', async () => {
    const { tx, reservation, balance } = createReservationTx(30);
    const service = new InventoryService({} as never);

    const outcomes = await Promise.allSettled([
      service.commitReservation(
        'order-1',
        [{ productId: 'product-1', quantity: 20 }],
        tx as never,
      ),
      service.commitReservation(
        'order-1',
        [{ productId: 'product-1', quantity: 20 }],
        tx as never,
      ),
    ]);

    expect(
      outcomes.filter((outcome) => outcome.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      outcomes.find((outcome) => outcome.status === 'rejected'),
    ).toMatchObject({
      reason: expect.any(ConflictException),
    });
    expect(reservation).toMatchObject({
      quantity: 10,
      status: StockReservationStatus.ACTIVE,
    });
    expect(balance).toMatchObject({ onHand: 10, reserved: 10 });
  });
});
