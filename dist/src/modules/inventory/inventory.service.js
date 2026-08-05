"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.InventoryService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const prisma_service_1 = require("../prisma/prisma.service");
let InventoryService = class InventoryService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async listBalances(filterDto) {
        const page = filterDto.page ?? 1;
        const limit = filterDto.limit ?? 20;
        const where = {
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
    async getBalance(productId) {
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
    async getExpectedReceipts(filterDto) {
        const page = filterDto.page ?? 1;
        const limit = filterDto.limit ?? 20;
        const where = {
            supplierId: filterDto.supplierId,
            status: filterDto.status,
            expectedDate: filterDto.dateFrom || filterDto.dateTo
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
    async reserveStock(orderId, items, tx) {
        const client = tx ?? this.prisma;
        const aggregatedItems = this.aggregateItems(items);
        await this.assertReservationAvailable(client, aggregatedItems);
        const reservations = [];
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
    async releaseReservation(orderId, tx) {
        const client = tx ?? this.prisma;
        const reservations = await client.stockReservation.findMany({
            where: {
                orderId,
                status: client_1.StockReservationStatus.ACTIVE,
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
                status: client_1.StockReservationStatus.ACTIVE,
            },
            data: { status: client_1.StockReservationStatus.RELEASED },
        });
    }
    async createExpectedReceipt(dto) {
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
    async processReceipt(id, dto) {
        const receipt = await this.prisma.expectedReceipt.findUnique({
            where: { id },
            include: { items: true },
        });
        if (!receipt) {
            throw new common_1.NotFoundException('Expected receipt not found');
        }
        return this.prisma.$transaction(async (tx) => {
            for (const receivedItem of dto.items) {
                const item = receipt.items.find((receiptItem) => receiptItem.id === receivedItem.itemId);
                if (!item) {
                    throw new common_1.NotFoundException(`Expected receipt item not found: ${receivedItem.itemId}`);
                }
                const newReceivedQuantity = item.receivedQuantity + receivedItem.receivedQuantity;
                if (newReceivedQuantity > item.quantity) {
                    throw new common_1.BadRequestException('Received quantity exceeds expected quantity');
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
    async assertReservationAvailable(client, items) {
        for (const item of items) {
            const balance = await client.stockBalance.findUnique({
                where: { productId: item.productId },
            });
            if (!balance || this.calculateAvailable(balance) < item.quantity) {
                throw new common_1.BadRequestException('Недостаточно товара на складе для резервирования');
            }
        }
    }
    aggregateItems(items) {
        const quantitiesByProduct = new Map();
        for (const item of items) {
            quantitiesByProduct.set(item.productId, (quantitiesByProduct.get(item.productId) ?? 0) + item.quantity);
        }
        return Array.from(quantitiesByProduct.entries()).map(([productId, quantity]) => ({
            productId,
            quantity,
        }));
    }
    calculateAvailable(balance) {
        return balance.onHand - balance.reserved;
    }
    calculateReceiptStatus(items) {
        const fullyReceived = items.every((item) => item.receivedQuantity >= item.quantity);
        if (fullyReceived) {
            return client_1.ExpectedReceiptStatus.RECEIVED;
        }
        const partiallyReceived = items.some((item) => item.receivedQuantity > 0);
        return partiallyReceived
            ? client_1.ExpectedReceiptStatus.PARTIALLY_RECEIVED
            : client_1.ExpectedReceiptStatus.PENDING;
    }
};
exports.InventoryService = InventoryService;
exports.InventoryService = InventoryService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], InventoryService);
//# sourceMappingURL=inventory.service.js.map