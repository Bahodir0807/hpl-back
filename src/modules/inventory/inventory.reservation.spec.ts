import { BadRequestException } from '@nestjs/common';
import { InventoryService } from './inventory.service';

describe('InventoryService atomic reservation', () => {
  it('allows only one concurrent reservation when both cannot fit', async () => {
    const balance = {
      id: 'balance-id',
      productId: 'product-id',
      version: 0,
      reserved: 0,
      available: 10,
    };
    const prisma = {
      stockBalance: {
        findUnique: jest.fn(async () => ({ ...balance })),
        updateMany: jest.fn(async ({ where, data }: any) => {
          if (
            where.version !== balance.version ||
            balance.available < where.available.gte
          ) {
            return { count: 0 };
          }
          balance.reserved += data.reserved.increment;
          balance.available -= data.available.decrement;
          balance.version += data.version.increment;
          return { count: 1 };
        }),
      },
      stockReservation: {
        create: jest.fn(async ({ data }: any) => ({
          id: `reservation-${data.orderId}`,
          ...data,
        })),
      },
      auditLog: { create: jest.fn() },
    };
    const service = new InventoryService(prisma as never);

    const results = await Promise.allSettled([
      service.reserveStock('order-a', [
        { productId: 'product-id', quantity: 6 },
      ]),
      service.reserveStock('order-b', [
        { productId: 'product-id', quantity: 6 },
      ]),
    ]);

    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected).toMatchObject({ reason: expect.any(BadRequestException) });
    expect(balance).toMatchObject({ reserved: 6, available: 4, version: 1 });
  });
});
