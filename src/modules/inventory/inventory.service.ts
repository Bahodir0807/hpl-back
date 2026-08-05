import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ExpectedReceipt,
  ExpectedReceiptStatus,
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
  ): Promise<StockReservation[]> {
    const client = tx ?? this.prisma;
    const aggregatedItems = this.aggregateItems(items);

    await this.assertReservationAvailable(client, aggregatedItems);

    const reservations: StockReservation[] = [];

    for (const item of aggregatedItems) {
      await client.stockBalance.update({
        where: { productId: item.productId },
        data: {
          reserved: { increment: item.quantity },
          available: { decrement: item.quantity },
        },
      });

      const reservation = await client.stockReservation.create({
        data: {
          orderId,
          productId: item.productId,
          quantity: item.quantity,
        },
      });

      reservations.push(reservation);
    }

    return reservations;
  }

  async releaseReservation(
    orderId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    const reservations = await client.stockReservation.findMany({
      where: {
        orderId,
        status: StockReservationStatus.ACTIVE,
      },
    });

    for (const reservation of reservations) {
      await client.stockBalance.update({
        where: { productId: reservation.productId },
        data: {
          reserved: { decrement: reservation.quantity },
          available: { increment: reservation.quantity },
        },
      });
    }

    await client.stockReservation.updateMany({
      where: {
        orderId,
        status: StockReservationStatus.ACTIVE,
      },
      data: { status: StockReservationStatus.RELEASED },
    });
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

  async processReceipt(id: string, dto: ReceiveExpectedReceiptDto) {
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

        await tx.stockBalance.upsert({
          where: { productId: item.productId },
          create: {
            productId: item.productId,
            onHand: receivedItem.receivedQuantity,
            reserved: 0,
            available: receivedItem.receivedQuantity,
          },
          update: {
            onHand: { increment: receivedItem.receivedQuantity },
            available: { increment: receivedItem.receivedQuantity },
          },
        });
      }

      const updatedItems = await tx.expectedReceiptItem.findMany({
        where: { expectedReceiptId: id },
      });
      const status = this.calculateReceiptStatus(updatedItems);

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
