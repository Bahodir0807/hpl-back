import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ExpectedReceipt,
  ExpectedReceiptStatus,
  OrderStatus,
  Prisma,
  StockReservation,
  StockReservationStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateExpectedReceiptDto } from './dto/create-expected-receipt.dto';
import { FilterExpectedReceiptDto } from './dto/filter-expected-receipt.dto';
import { FilterStockBalanceDto } from './dto/filter-stock-balance.dto';
import { ReceiveExpectedReceiptDto } from './dto/receive-expected-receipt.dto';

type PrismaClientLike = Prisma.TransactionClient | PrismaService;

// Резерв живёт 72 часа (3 дня): товар транзитный, «замороженный» резерв
// без оплаты — упущенная сделка с другим клиентом.
export const RESERVATION_TTL_MS = 3 * 24 * 60 * 60 * 1000;

export type StockBalanceSnapshot = {
  productId: string;
  onHand: number;
  reserved: number;
  available: number;
};

export type ReserveStockItem = {
  productId: string;
  quantity: number;
};

type StockBalanceListItem = Prisma.StockBalanceGetPayload<{
  include: { product: true };
}> & {
  available: number;
};

type StockBalanceListResult = {
  items: StockBalanceListItem[];
  total: number;
  page: number;
  limit: number;
};

type ExpectedReceiptListItem = Prisma.ExpectedReceiptGetPayload<{
  include: {
    supplier: true;
    items: {
      include: {
        product: true;
      };
    };
  };
}>;

type ExpectedReceiptListResult = {
  items: ExpectedReceiptListItem[];
  total: number;
  page: number;
  limit: number;
};

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(private readonly prisma: PrismaService) {}

  async listBalances(
    filterDto: FilterStockBalanceDto,
  ): Promise<StockBalanceListResult> {
    const page = filterDto.page ?? 1;
    const limit = filterDto.limit ?? 20;
    const where: Prisma.StockBalanceWhereInput = {
      productId: filterDto.productId,
    };

    const [balances, total] = await this.prisma.$transaction([
      this.prisma.stockBalance.findMany({
        where,
        include: { product: true },
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.stockBalance.count({ where }),
    ]);

    return {
      items: balances.map((balance) => ({
        ...balance,
        available: this.calculateAvailable(balance),
      })),
      total,
      page,
      limit,
    };
  }

  async getBalance(productId: string): Promise<StockBalanceSnapshot> {
    const balance = await this.prisma.stockBalance.findUnique({
      where: { productId },
    });

    return {
      productId,
      onHand: balance?.onHand ?? 0,
      reserved: balance?.reserved ?? 0,
      available: balance ? this.calculateAvailable(balance) : 0,
    };
  }

  async getExpectedReceipts(
    filterDto: FilterExpectedReceiptDto,
  ): Promise<ExpectedReceiptListResult> {
    const page = filterDto.page ?? 1;
    const limit = filterDto.limit ?? 20;
    const where: Prisma.ExpectedReceiptWhereInput = {
      supplierId: filterDto.supplierId,
      status: filterDto.status,
      expectedDate:
        filterDto.dateFrom || filterDto.dateTo
          ? {
              gte: filterDto.dateFrom,
              lte: filterDto.dateTo,
            }
          : undefined,
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.expectedReceipt.findMany({
        where,
        include: {
          supplier: true,
          items: {
            include: {
              product: true,
            },
          },
        },
        orderBy: { expectedDate: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.expectedReceipt.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  async reserveStock(
    orderId: string,
    items: ReserveStockItem[],
    tx?: Prisma.TransactionClient,
    actorId?: string,
  ): Promise<StockReservation[]> {
    const client = tx ?? this.prisma;
    const aggregatedItems = this.aggregateItems(items);

    const reservations: StockReservation[] = [];

    for (const item of aggregatedItems) {
      const balance = await client.stockBalance.findUnique({
        where: { productId: item.productId },
        select: { id: true, version: true, reserved: true, available: true },
      });

      // Атомарный условный резерв: БД сама проверяет доступный остаток
      // и version (optimistic locking), иначе два параллельных резерва
      // уводят available в минус (oversell) или теряют чужое обновление
      const updated = await client.stockBalance.updateMany({
        where: {
          productId: item.productId,
          available: { gte: item.quantity },
          version: balance?.version ?? -1,
        },
        data: {
          reserved: { increment: item.quantity },
          available: { decrement: item.quantity },
          updatedBy: orderId,
          version: { increment: 1 },
        },
      });

      if (updated.count === 0) {
        throw new BadRequestException(
          'Недостаточно товара на складе для резервирования',
        );
      }

      const reservation = await client.stockReservation.create({
        data: {
          orderId,
          productId: item.productId,
          quantity: item.quantity,
          expiresAt: new Date(Date.now() + RESERVATION_TTL_MS),
        },
      });

      // STOCK-05: изменение резерва — в журнал аудита.
      // actorId может отсутствовать (cron-резерв из processWaitingOrders).
      await client.auditLog.create({
        data: {
          userId: actorId,
          action: 'STOCK_RESERVED',
          entityType: 'StockBalance',
          entityId: balance?.id ?? item.productId,
          oldValue: balance
            ? { reserved: balance.reserved, available: balance.available }
            : undefined,
          newValue: {
            orderId,
            productId: item.productId,
            quantity: item.quantity,
            reserved: (balance?.reserved ?? 0) + item.quantity,
            available: (balance?.available ?? 0) - item.quantity,
            expiresAt: reservation.expiresAt,
          },
        },
      });

      reservations.push(reservation);
    }

    return reservations;
  }

  async releaseReservation(
    orderId: string,
    tx?: Prisma.TransactionClient,
    actorId?: string,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    const reservations = await client.stockReservation.findMany({
      where: {
        orderId,
        status: StockReservationStatus.ACTIVE,
      },
    });

    for (const reservation of reservations) {
      const balance = await client.stockBalance.findUnique({
        where: { productId: reservation.productId },
        select: { id: true, version: true, reserved: true, available: true },
      });
      if (!balance) continue;

      const updated = await client.stockBalance.updateMany({
        where: {
          productId: reservation.productId,
          version: balance.version,
        },
        data: {
          reserved: { decrement: reservation.quantity },
          available: { increment: reservation.quantity },
          updatedBy: orderId,
          version: { increment: 1 },
        },
      });

      if (updated.count === 0) {
        throw new ConflictException(
          'Stock balance modified concurrently during reservation release',
        );
      }

      await client.stockReservation.update({
        where: { id: reservation.id },
        data: { status: StockReservationStatus.RELEASED },
      });

      await client.auditLog.create({
        data: {
          userId: actorId,
          action: 'STOCK_RELEASED',
          entityType: 'StockBalance',
          entityId: balance.id,
          oldValue: {
            reserved: balance.reserved,
            available: balance.available,
          },
          newValue: {
            orderId,
            productId: reservation.productId,
            quantity: reservation.quantity,
            reserved: balance.reserved - reservation.quantity,
            available: balance.available + reservation.quantity,
          },
        },
      });
    }
  }

  // Снимает просроченные резервы (TTL 72ч) и возвращает товар в продажу.
  // Если по заказу не осталось активных резервов — заказ возвращается
  // в WAITING_STOCK (терминальные и отменённые статусы не трогаем).
  // Возвращает количество снятых резервов.
  async releaseExpiredReservations(): Promise<number> {
    const expired = await this.prisma.stockReservation.findMany({
      where: {
        status: StockReservationStatus.ACTIVE,
        expiresAt: { lt: new Date() },
      },
    });

    let releasedCount = 0;

    for (const reservation of expired) {
      try {
        const released = await this.prisma.$transaction(async (tx) => {
          // Двойная проверка внутри транзакции: параллельный cron-процесс
          // мог уже обработать этот резерв.
          const current = await tx.stockReservation.findUnique({
            where: { id: reservation.id },
          });

          if (!current || current.status !== StockReservationStatus.ACTIVE) {
            return false;
          }

          const balance = await tx.stockBalance.findUnique({
            where: { productId: reservation.productId },
            select: { id: true, version: true },
          });

          if (!balance) {
            return false;
          }

          const updated = await tx.stockBalance.updateMany({
            where: {
              productId: reservation.productId,
              version: balance.version,
            },
            data: {
              reserved: { decrement: reservation.quantity },
              available: { increment: reservation.quantity },
              version: { increment: 1 },
            },
          });

          if (updated.count === 0) {
            throw new ConflictException(
              'Stock balance modified concurrently during reservation expiry',
            );
          }

          // Отдельного статуса EXPIRED в enum нет — используем RELEASED,
          // просроченные различимы по expiresAt < now.
          await tx.stockReservation.update({
            where: { id: reservation.id },
            data: { status: StockReservationStatus.RELEASED },
          });

          const remainingActive = await tx.stockReservation.count({
            where: {
              orderId: reservation.orderId,
              status: StockReservationStatus.ACTIVE,
            },
          });

          if (remainingActive === 0) {
            await tx.order.updateMany({
              where: {
                id: reservation.orderId,
                deletedAt: null,
                status: {
                  notIn: [
                    OrderStatus.CANCELLED,
                    OrderStatus.PARTIALLY_SHIPPED,
                    OrderStatus.SHIPPED,
                    OrderStatus.COMPLETED,
                  ],
                },
              },
              data: {
                status: OrderStatus.WAITING_STOCK,
                version: { increment: 1 },
              },
            });
          }

          return true;
        });

        if (released) {
          releasedCount += 1;
        }
      } catch (error) {
        // Пропускаем один упавший резерв, не ломаем весь batch.
        this.logger.warn(
          `Failed to release expired reservation ${reservation.id}: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
      }
    }

    return releasedCount;
  }

  // Отгрузка по резерву: onHand и reserved уменьшаются равно,
  // available не трогаем — инвариант available = onHand - reserved сохраняется.
  async commitReservation(
    orderId: string,
    items: ReserveStockItem[],
    tx: Prisma.TransactionClient,
    actorId?: string,
  ): Promise<void> {
    for (const item of items) {
      const balance = await tx.stockBalance.findUnique({
        where: { productId: item.productId },
        select: {
          id: true,
          version: true,
          onHand: true,
          reserved: true,
        },
      });

      if (!balance) {
        throw new NotFoundException(
          `Stock balance not found for product ${item.productId}`,
        );
      }

      const updated = await tx.stockBalance.updateMany({
        where: {
          productId: item.productId,
          onHand: { gte: item.quantity },
          reserved: { gte: item.quantity },
          version: balance.version,
        },
        data: {
          onHand: { decrement: item.quantity },
          reserved: { decrement: item.quantity },
          updatedBy: orderId,
          version: { increment: 1 },
        },
      });

      if (updated.count === 0) {
        throw new ConflictException(
          `Insufficient stock or concurrent modification for product ${item.productId}`,
        );
      }

      await tx.stockReservation.updateMany({
        where: {
          orderId,
          productId: item.productId,
          status: StockReservationStatus.ACTIVE,
        },
        data: { status: StockReservationStatus.FULFILLED },
      });

      await tx.auditLog.create({
        data: {
          userId: actorId,
          action: 'STOCK_COMMITTED',
          entityType: 'StockBalance',
          entityId: balance.id,
          oldValue: {
            onHand: balance.onHand,
            reserved: balance.reserved,
          },
          newValue: {
            orderId,
            productId: item.productId,
            quantity: item.quantity,
            onHand: balance.onHand - item.quantity,
            reserved: balance.reserved - item.quantity,
          },
        },
      });
    }
  }

  async createExpectedReceipt(
    dto: CreateExpectedReceiptDto,
  ): Promise<ExpectedReceipt> {
    return this.prisma.expectedReceipt.create({
      data: {
        supplierId: dto.supplierId,
        expectedDate: dto.expectedDate,
        items: {
          create: dto.items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
          })),
        },
      },
      include: {
        supplier: true,
        items: {
          include: { product: true },
        },
      },
    });
  }

  async processReceipt(
    id: string,
    dto: ReceiveExpectedReceiptDto,
    actorId?: string,
  ) {
    const receipt = await this.prisma.expectedReceipt.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!receipt) {
      throw new NotFoundException('Expected receipt not found');
    }

    return this.prisma.$transaction(async (tx) => {
      for (const receivedItem of dto.items) {
        const item = receipt.items.find(
          (receiptItem) => receiptItem.id === receivedItem.itemId,
        );

        if (!item) {
          throw new NotFoundException(
            `Expected receipt item not found: ${receivedItem.itemId}`,
          );
        }

        const newReceivedQuantity =
          item.receivedQuantity + receivedItem.receivedQuantity;

        if (newReceivedQuantity > item.quantity) {
          throw new BadRequestException(
            'Received quantity exceeds expected quantity',
          );
        }

        await tx.expectedReceiptItem.update({
          where: { id: item.id },
          data: { receivedQuantity: newReceivedQuantity },
        });

        await this.applyReceiptQuantity(
          tx,
          item.productId,
          receivedItem.receivedQuantity,
          actorId,
        );
      }

      // Контейнер пришёл — пытаемся дорезервировать заказы в WAITING_STOCK
      // по FIFO (кто раньше заказал, тот раньше получает товар).
      await this.processWaitingOrders(tx, actorId);

      const updatedItems = await tx.expectedReceiptItem.findMany({
        where: { expectedReceiptId: id },
      });
      const status = this.calculateReceiptStatus(updatedItems);

      await tx.auditLog.create({
        data: {
          userId: actorId,
          action: 'STOCK_RECEIPT_PROCESSED',
          entityType: 'ExpectedReceipt',
          entityId: id,
          newValue: {
            status,
            items: dto.items.map((item) => ({
              itemId: item.itemId,
              receivedQuantity: item.receivedQuantity,
            })),
          },
        },
      });

      return tx.expectedReceipt.update({
        where: { id },
        data: { status },
        include: {
          supplier: true,
          items: {
            include: { product: true },
          },
        },
      });
    });
  }

  // FIFO-раздача свежепришедшего товара заказам в WAITING_STOCK.
  // Заказ, под который не хватило товара, остаётся в WAITING_STOCK
  // и ждёт следующий контейнер — processReceipt при этом не откатывается.
  private async processWaitingOrders(
    tx: Prisma.TransactionClient,
    actorId?: string,
  ): Promise<void> {
    const waitingOrders = await tx.order.findMany({
      where: {
        status: OrderStatus.WAITING_STOCK,
        deletedAt: null,
      },
      orderBy: { createdAt: 'asc' },
      take: 50,
      include: { items: true },
    });

    for (const order of waitingOrders) {
      if (order.items.length === 0) {
        continue;
      }

      try {
        await this.reserveStock(
          order.id,
          order.items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
          })),
          tx,
          actorId,
        );

        await Promise.all(
          order.items.map((item) =>
            tx.orderItem.update({
              where: { id: item.id },
              data: { reservedQuantity: item.quantity },
            }),
          ),
        );

        // Зеркалим успешный путь createFromDeal: товар зарезервирован —
        // заказ ждёт оплаты.
        await tx.order.update({
          where: { id: order.id },
          data: {
            status: OrderStatus.WAITING_PAYMENT,
            version: { increment: 1 },
          },
        });
      } catch (error) {
        if (
          error instanceof BadRequestException ||
          error instanceof ConflictException
        ) {
          continue;
        }

        throw error;
      }
    }
  }

  private async applyReceiptQuantity(
    tx: Prisma.TransactionClient,
    productId: string,
    quantity: number,
    actorId?: string,
  ): Promise<void> {
    const balance = await tx.stockBalance.findUnique({
      where: { productId },
      select: { id: true, version: true, onHand: true, available: true },
    });

    if (!balance) {
      try {
        await tx.stockBalance.create({
          data: {
            productId,
            onHand: quantity,
            reserved: 0,
            available: quantity,
            version: 0,
            updatedBy: actorId,
          },
        });
        return;
      } catch (error) {
        if (
          !(error instanceof Prisma.PrismaClientKnownRequestError) ||
          error.code !== 'P2002'
        ) {
          throw error;
        }
      }
    }

    const current =
      balance ??
      (await tx.stockBalance.findUnique({
        where: { productId },
        select: { id: true, version: true, onHand: true, available: true },
      }));

    if (!current) {
      throw new ConflictException(
        `Stock balance modified concurrently for product ${productId}`,
      );
    }

    const updated = await tx.stockBalance.updateMany({
      where: {
        productId,
        version: current.version,
      },
      data: {
        onHand: { increment: quantity },
        available: { increment: quantity },
        updatedBy: actorId,
        version: { increment: 1 },
      },
    });

    if (updated.count === 0) {
      throw new ConflictException(
        `Stock balance modified concurrently for product ${productId}`,
      );
    }
  }

  private async assertReservationAvailable(
    client: PrismaClientLike,
    items: ReserveStockItem[],
  ): Promise<void> {
    for (const item of items) {
      const balance = await client.stockBalance.findUnique({
        where: { productId: item.productId },
      });

      if (!balance || this.calculateAvailable(balance) < item.quantity) {
        throw new BadRequestException(
          'Недостаточно товара на складе для резервирования',
        );
      }
    }
  }

  private aggregateItems(items: ReserveStockItem[]): ReserveStockItem[] {
    const quantitiesByProduct = new Map<string, number>();

    for (const item of items) {
      quantitiesByProduct.set(
        item.productId,
        (quantitiesByProduct.get(item.productId) ?? 0) + item.quantity,
      );
    }

    return Array.from(quantitiesByProduct.entries()).map(
      ([productId, quantity]) => ({
        productId,
        quantity,
      }),
    );
  }

  private calculateAvailable(balance: {
    onHand: number;
    reserved: number;
  }): number {
    return balance.onHand - balance.reserved;
  }

  private calculateReceiptStatus(
    items: { quantity: number; receivedQuantity: number }[],
  ): ExpectedReceiptStatus {
    const fullyReceived = items.every(
      (item) => item.receivedQuantity >= item.quantity,
    );

    if (fullyReceived) {
      return ExpectedReceiptStatus.RECEIVED;
    }

    const partiallyReceived = items.some((item) => item.receivedQuantity > 0);

    return partiallyReceived
      ? ExpectedReceiptStatus.PARTIALLY_RECEIVED
      : ExpectedReceiptStatus.PENDING;
  }
}
