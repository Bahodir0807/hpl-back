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
import { UpdateWarehousePurchaseDto } from './dto/update-warehouse-purchase.dto';

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
    createdBy: {
      select: {
        id: true;
        email: true;
        firstName: true;
        lastName: true;
      };
    };
    items: {
      include: {
        product: true;
      };
    };
    receiptEvents: {
      include: {
        items: true;
        receivedBy: {
          select: {
            id: true;
            email: true;
            firstName: true;
            lastName: true;
          };
        };
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
          createdBy: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
            },
          },
          items: {
            include: {
              product: true,
            },
          },
          receiptEvents: {
            include: {
              items: true,
              receivedBy: {
                select: {
                  id: true,
                  email: true,
                  firstName: true,
                  lastName: true,
                },
              },
            },
            orderBy: { receivedAt: 'desc' },
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
    const quantitiesByProduct = new Map<string, number>();
    for (const item of items) {
      quantitiesByProduct.set(
        item.productId,
        (quantitiesByProduct.get(item.productId) ?? 0) + item.quantity,
      );
    }

    for (const [productId, quantity] of quantitiesByProduct) {
      const reservations = await tx.stockReservation.findMany({
        where: {
          orderId,
          productId,
          status: StockReservationStatus.ACTIVE,
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      const reservedQuantity = reservations.reduce(
        (sum, reservation) => sum + reservation.quantity,
        0,
      );

      if (reservedQuantity + Number.EPSILON < quantity) {
        throw new ConflictException(
          `Insufficient active reservation for product ${productId}`,
        );
      }

      const balance = await tx.stockBalance.findUnique({
        where: { productId },
        select: {
          id: true,
          version: true,
          onHand: true,
          reserved: true,
        },
      });

      if (!balance) {
        throw new NotFoundException(
          `Stock balance not found for product ${productId}`,
        );
      }

      const updated = await tx.stockBalance.updateMany({
        where: {
          productId,
          onHand: { gte: quantity },
          reserved: { gte: quantity },
          version: balance.version,
        },
        data: {
          onHand: { decrement: quantity },
          reserved: { decrement: quantity },
          updatedBy: orderId,
          version: { increment: 1 },
        },
      });

      if (updated.count === 0) {
        throw new ConflictException(
          `Insufficient stock or concurrent modification for product ${productId}`,
        );
      }

      let remaining = quantity;
      for (const reservation of reservations) {
        if (remaining <= Number.EPSILON) {
          break;
        }

        const consumed = Math.min(remaining, reservation.quantity);
        const fullyConsumed = reservation.quantity - consumed <= Number.EPSILON;
        const claimed = await tx.stockReservation.updateMany({
          where: {
            id: reservation.id,
            status: StockReservationStatus.ACTIVE,
            quantity: reservation.quantity,
          },
          data: fullyConsumed
            ? { status: StockReservationStatus.FULFILLED }
            : { quantity: { decrement: consumed } },
        });

        if (claimed.count === 0) {
          throw new ConflictException(
            `Reservation modified concurrently for product ${productId}`,
          );
        }
        remaining -= consumed;
      }

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
            productId,
            quantity,
            onHand: balance.onHand - quantity,
            reserved: balance.reserved - quantity,
          },
        },
      });
    }
  }

  async createExpectedReceipt(
    dto: CreateExpectedReceiptDto,
    actorId?: string,
  ): Promise<ExpectedReceipt> {
    if (dto.items.length === 0) {
      throw new BadRequestException('Warehouse purchase must contain items');
    }

    const receipt = await this.prisma.expectedReceipt.create({
      data: {
        supplierId: dto.supplierId,
        orderedAt: dto.orderedAt ?? new Date(),
        expectedDate: dto.expectedDate,
        comment: dto.comment,
        createdById: actorId,
        items: {
          create: dto.items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
          })),
        },
      },
      include: {
        supplier: true,
        createdBy: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
          },
        },
        items: {
          include: { product: true },
        },
        receiptEvents: {
          include: { items: true },
        },
      },
    });

    await this.prisma.auditLog.create({
      data: {
        userId: actorId,
        action: 'WAREHOUSE_PURCHASE_CREATED',
        entityType: 'ExpectedReceipt',
        entityId: receipt.id,
        newValue: {
          supplierId: receipt.supplierId,
          orderedAt: receipt.orderedAt,
          expectedDate: receipt.expectedDate,
          itemCount: receipt.items.length,
        },
      },
    });

    return receipt;
  }

  async updateWarehousePurchase(
    id: string,
    dto: UpdateWarehousePurchaseDto,
    actorId?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const receipt = await this.lockExpectedReceipt(tx, id);

      if (receipt.status === ExpectedReceiptStatus.CANCELLED) {
        throw new BadRequestException(
          'Cancelled warehouse purchase cannot be updated',
        );
      }

      if (dto.items) {
        for (const itemUpdate of dto.items) {
          const item = receipt.items.find(
            (receiptItem) => receiptItem.id === itemUpdate.itemId,
          );

          if (!item) {
            throw new NotFoundException(
              `Warehouse purchase item not found: ${itemUpdate.itemId}`,
            );
          }

          if (itemUpdate.orderedQuantity < item.receivedQuantity) {
            throw new BadRequestException(
              'Ordered quantity cannot be reduced below already received quantity',
            );
          }

          await tx.expectedReceiptItem.update({
            where: { id: item.id },
            data: { quantity: itemUpdate.orderedQuantity },
          });
        }
      }

      const updatedItems = await tx.expectedReceiptItem.findMany({
        where: { expectedReceiptId: id },
      });
      const status = this.calculateReceiptStatus(updatedItems);

      await tx.expectedReceipt.update({
        where: { id },
        data: {
          expectedDate: dto.expectedDate,
          comment: dto.comment,
          status,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: actorId,
          action: 'WAREHOUSE_PURCHASE_UPDATED',
          entityType: 'ExpectedReceipt',
          entityId: id,
          oldValue: {
            expectedDate: receipt.expectedDate,
            comment: receipt.comment,
            items: receipt.items.map((item) => ({
              itemId: item.id,
              quantity: item.quantity,
            })),
          },
          newValue: {
            expectedDate: dto.expectedDate ?? receipt.expectedDate,
            comment: dto.comment ?? receipt.comment,
            items: updatedItems.map((item) => ({
              itemId: item.id,
              quantity: item.quantity,
              receivedQuantity: item.receivedQuantity,
            })),
            status,
          },
        },
      });

      return this.getExpectedReceiptById(id, tx);
    });
  }

  async cancelWarehousePurchase(id: string, actorId?: string) {
    return this.prisma.$transaction(async (tx) => {
      const receipt = await this.lockExpectedReceipt(tx, id);

      if (receipt.status === ExpectedReceiptStatus.CANCELLED) {
        return this.getExpectedReceiptById(id, tx);
      }

      if (receipt.items.some((item) => item.receivedQuantity > 0)) {
        throw new BadRequestException(
          'Warehouse purchase cannot be cancelled after receiving begins',
        );
      }

      await tx.expectedReceipt.update({
        where: { id },
        data: { status: ExpectedReceiptStatus.CANCELLED },
      });

      await tx.auditLog.create({
        data: {
          userId: actorId,
          action: 'WAREHOUSE_PURCHASE_CANCELLED',
          entityType: 'ExpectedReceipt',
          entityId: id,
          oldValue: { status: receipt.status },
          newValue: { status: ExpectedReceiptStatus.CANCELLED },
        },
      });

      return this.getExpectedReceiptById(id, tx);
    });
  }

  async processReceipt(
    id: string,
    dto: ReceiveExpectedReceiptDto,
    actorId?: string,
  ) {
    if (dto.items.length === 0) {
      throw new BadRequestException('Warehouse receipt must contain items');
    }

    return this.prisma.$transaction(async (tx) => {
      if (!actorId) {
        throw new BadRequestException('Receiving actor is required');
      }

      const receipt = await this.lockExpectedReceipt(tx, id);

      if (dto.clientReceiptId) {
        const existingEvent = await tx.expectedReceiptEvent.findFirst({
          where: {
            expectedReceiptId: id,
            clientReceiptId: dto.clientReceiptId,
          },
          select: { id: true },
        });

        if (existingEvent) {
          return this.getExpectedReceiptById(id, tx);
        }
      }

      if (receipt.status === ExpectedReceiptStatus.CANCELLED) {
        throw new BadRequestException(
          'Cancelled warehouse purchase cannot be received',
        );
      }

      const event = await tx.expectedReceiptEvent.create({
        data: {
          expectedReceiptId: id,
          receivedById: actorId,
          comment: dto.comment,
          clientReceiptId: dto.clientReceiptId,
        },
      });

      for (const receivedItem of dto.items) {
        const item = receipt.items.find(
          (receiptItem) => receiptItem.id === receivedItem.itemId,
        );

        if (!item) {
          throw new NotFoundException(
            `Expected receipt item not found: ${receivedItem.itemId}`,
          );
        }

        const acceptedQuantity =
          receivedItem.acceptedQuantity ?? receivedItem.receivedQuantity;

        if (!acceptedQuantity || acceptedQuantity <= 0) {
          throw new BadRequestException('Accepted quantity must be positive');
        }

        const newReceivedQuantity = item.receivedQuantity + acceptedQuantity;

        if (newReceivedQuantity > item.quantity) {
          throw new BadRequestException(
            'Received quantity exceeds expected quantity',
          );
        }

        if ((receivedItem.rejectedQuantity ?? 0) < 0) {
          throw new BadRequestException('Rejected quantity cannot be negative');
        }

        const updated = await tx.expectedReceiptItem.updateMany({
          where: {
            id: item.id,
            receivedQuantity: {
              lte: item.quantity - acceptedQuantity,
            },
          },
          data: { receivedQuantity: { increment: acceptedQuantity } },
        });

        if (updated.count === 0) {
          throw new BadRequestException(
            'Received quantity exceeds expected quantity',
          );
        }

        await tx.expectedReceiptEventItem.create({
          data: {
            receiptEventId: event.id,
            expectedReceiptItemId: item.id,
            productId: item.productId,
            acceptedQuantity,
            rejectedQuantity: receivedItem.rejectedQuantity ?? 0,
          },
        });

        await this.applyReceiptQuantity(
          tx,
          item.productId,
          acceptedQuantity,
          actorId,
        );
      }

      await this.processWaitingOrders(tx, actorId);

      // Контейнер пришёл — пытаемся дорезервировать заказы в WAITING_STOCK
      // по FIFO (кто раньше заказал, тот раньше получает товар).
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
              acceptedQuantity: item.acceptedQuantity,
              rejectedQuantity: item.rejectedQuantity ?? 0,
            })),
          },
        },
      });

      return tx.expectedReceipt.update({
        where: { id },
        data: { status },
        include: {
          supplier: true,
          createdBy: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
            },
          },
          items: {
            include: { product: true },
          },
          receiptEvents: {
            include: {
              items: true,
              receivedBy: {
                select: {
                  id: true,
                  email: true,
                  firstName: true,
                  lastName: true,
                },
              },
            },
            orderBy: { receivedAt: 'desc' },
          },
        },
      });
    });
  }

  // FIFO-раздача свежепришедшего товара заказам в WAITING_STOCK.
  // Заказ, под который не хватило товара, остаётся в WAITING_STOCK
  // и ждёт следующий контейнер — processReceipt при этом не откатывается.
  private async getExpectedReceiptById(
    id: string,
    client: PrismaClientLike = this.prisma,
  ) {
    const receipt = await client.expectedReceipt.findUnique({
      where: { id },
      include: {
        supplier: true,
        createdBy: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
          },
        },
        items: {
          include: { product: true },
        },
        receiptEvents: {
          include: {
            items: true,
            receivedBy: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
              },
            },
          },
          orderBy: { receivedAt: 'desc' },
        },
      },
    });

    if (!receipt) {
      throw new NotFoundException('Expected receipt not found');
    }

    return receipt;
  }

  private async lockExpectedReceipt(tx: Prisma.TransactionClient, id: string) {
    const claimed = await tx.expectedReceipt.updateMany({
      where: { id },
      data: { updatedAt: new Date() },
    });

    if (claimed.count === 0) {
      throw new NotFoundException('Expected receipt not found');
    }

    return tx.expectedReceipt.findUniqueOrThrow({
      where: { id },
      include: { items: true },
    });
  }

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
