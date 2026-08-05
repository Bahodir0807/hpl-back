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
exports.OrdersService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const inventory_service_1 = require("../inventory/inventory.service");
const prisma_service_1 = require("../prisma/prisma.service");
const orderDetailsInclude = client_1.Prisma.validator()({
    deal: {
        include: {
            client: true,
            projectObject: true,
            owner: true,
        },
    },
    items: {
        include: {
            product: true,
            deliveryItems: true,
        },
    },
    payments: {
        orderBy: { createdAt: 'desc' },
    },
    deliveries: {
        include: {
            items: true,
        },
        orderBy: { deliveryDate: 'desc' },
    },
    reservations: true,
});
let OrdersService = class OrdersService {
    prisma;
    inventoryService;
    constructor(prisma, inventoryService) {
        this.prisma = prisma;
        this.inventoryService = inventoryService;
    }
    async createFromDeal(dto, currentUserId) {
        void currentUserId;
        const existingOrder = await this.prisma.order.findUnique({
            where: { dealId: dto.dealId },
            select: { id: true },
        });
        if (existingOrder) {
            throw new common_1.ConflictException('Order for this deal already exists');
        }
        const deal = await this.prisma.deal.findFirst({
            where: { id: dto.dealId, deletedAt: null },
            include: { items: true },
        });
        if (!deal) {
            throw new common_1.NotFoundException('Deal not found');
        }
        if (deal.items.length === 0) {
            throw new common_1.BadRequestException('Deal has no items to create order');
        }
        if (deal.stage !== client_1.DealStage.WON) {
            throw new common_1.BadRequestException('Order can be created only from won deal');
        }
        return this.prisma.$transaction(async (tx) => {
            const order = await tx.order.create({
                data: {
                    orderNumber: this.generateOrderNumber(),
                    dealId: deal.id,
                    status: client_1.OrderStatus.WAITING_PAYMENT,
                    totalAmount: deal.totalAmount,
                    remainingAmount: deal.totalAmount,
                    paymentTerms: dto.paymentTerms,
                    promisedDate: dto.promisedDate,
                    deliveryAddress: dto.deliveryAddress,
                    items: {
                        create: deal.items.map((item) => ({
                            productId: item.productId,
                            quantity: item.quantityM2,
                            unitPrice: item.unitPrice,
                            totalPrice: item.totalPrice,
                        })),
                    },
                },
                include: {
                    items: true,
                },
            });
            try {
                await this.inventoryService.reserveStock(order.id, order.items.map((item) => ({
                    productId: item.productId,
                    quantity: item.quantity,
                })), tx);
                await Promise.all(order.items.map((item) => tx.orderItem.update({
                    where: { id: item.id },
                    data: { reservedQuantity: item.quantity },
                })));
            }
            catch (error) {
                if (!(error instanceof common_1.BadRequestException)) {
                    throw error;
                }
                await tx.order.update({
                    where: { id: order.id },
                    data: { status: client_1.OrderStatus.WAITING_STOCK },
                });
            }
            const createdOrder = await tx.order.findUnique({
                where: { id: order.id },
                include: orderDetailsInclude,
            });
            if (!createdOrder) {
                throw new common_1.NotFoundException('Order not found');
            }
            return createdOrder;
        });
    }
    async addPayment(dto, currentUserId) {
        await this.ensureOrderExists(dto.orderId);
        return this.prisma.payment.create({
            data: {
                orderId: dto.orderId,
                amount: dto.amount,
                paymentDate: dto.paymentDate,
                comment: dto.comment,
                fileId: dto.fileId,
                createdById: currentUserId,
            },
        });
    }
    async confirmPayment(paymentId, dto, currentUserId) {
        if (dto.status !== client_1.PaymentRecordStatus.CONFIRMED &&
            dto.status !== client_1.PaymentRecordStatus.REJECTED) {
            throw new common_1.BadRequestException('Payment status must be CONFIRMED or REJECTED');
        }
        const payment = await this.prisma.payment.findUnique({
            where: { id: paymentId },
            select: { id: true, orderId: true },
        });
        if (!payment) {
            throw new common_1.NotFoundException('Payment not found');
        }
        return this.prisma.$transaction(async (tx) => {
            await tx.payment.update({
                where: { id: paymentId },
                data: { status: dto.status },
            });
            const order = await tx.order.findUnique({
                where: { id: payment.orderId },
            });
            if (!order) {
                throw new common_1.NotFoundException('Order not found');
            }
            const aggregate = await tx.payment.aggregate({
                where: {
                    orderId: payment.orderId,
                    status: client_1.PaymentRecordStatus.CONFIRMED,
                },
                _sum: { amount: true },
            });
            const paidAmount = aggregate._sum.amount ?? new client_1.Prisma.Decimal(0);
            const remainingAmount = client_1.Prisma.Decimal.max(new client_1.Prisma.Decimal(0), order.totalAmount.minus(paidAmount));
            const paymentStatus = this.calculatePaymentStatus(paidAmount, order.totalAmount);
            const updatedOrder = await tx.order.update({
                where: { id: payment.orderId },
                data: {
                    paidAmount,
                    remainingAmount,
                    paymentStatus,
                },
                include: orderDetailsInclude,
            });
            if (currentUserId) {
                await tx.activity.create({
                    data: {
                        authorId: currentUserId,
                        relatedType: 'Order',
                        relatedId: payment.orderId,
                        type: client_1.ActivityType.PAYMENT_RECEIVED,
                        content: `Payment ${dto.status.toLowerCase()}`,
                        metadata: {
                            paymentId,
                            status: dto.status,
                            paidAmount: paidAmount.toString(),
                            remainingAmount: remainingAmount.toString(),
                        },
                    },
                });
                await tx.auditLog.create({
                    data: {
                        userId: currentUserId,
                        action: 'PAYMENT_STATUS_CHANGED',
                        entityType: 'Payment',
                        entityId: paymentId,
                        newValue: {
                            status: dto.status,
                            orderId: payment.orderId,
                            paidAmount: paidAmount.toString(),
                            remainingAmount: remainingAmount.toString(),
                            paymentStatus,
                        },
                    },
                });
            }
            return updatedOrder;
        });
    }
    async createDelivery(dto) {
        await this.ensureOrderExists(dto.orderId);
        return this.prisma.$transaction(async (tx) => {
            const orderItems = await tx.orderItem.findMany({
                where: {
                    orderId: dto.orderId,
                    id: { in: dto.items.map((item) => item.orderItemId) },
                },
            });
            if (orderItems.length !== dto.items.length) {
                throw new common_1.NotFoundException('One or more order items were not found');
            }
            const delivery = await tx.delivery.create({
                data: {
                    orderId: dto.orderId,
                    deliveryDate: dto.deliveryDate,
                    recipient: dto.recipient,
                    trackingNumber: dto.trackingNumber,
                    status: client_1.DeliveryStatus.DELIVERED,
                    items: {
                        create: dto.items.map((item) => ({
                            orderItemId: item.orderItemId,
                            quantity: item.quantity,
                        })),
                    },
                },
                include: {
                    items: true,
                },
            });
            for (const deliveryItem of dto.items) {
                const orderItem = orderItems.find((item) => item.id === deliveryItem.orderItemId);
                if (!orderItem) {
                    throw new common_1.NotFoundException('Order item not found');
                }
                const remainingToDeliver = orderItem.quantity - orderItem.deliveredQuantity;
                if (deliveryItem.quantity > remainingToDeliver) {
                    throw new common_1.BadRequestException('Delivery quantity exceeds remaining order item quantity');
                }
                const balance = await tx.stockBalance.findUnique({
                    where: { productId: orderItem.productId },
                });
                if (!balance ||
                    balance.onHand < deliveryItem.quantity ||
                    balance.reserved < deliveryItem.quantity) {
                    throw new common_1.BadRequestException('Недостаточно товара на складе для резервирования');
                }
                await tx.stockBalance.update({
                    where: { productId: orderItem.productId },
                    data: {
                        onHand: { decrement: deliveryItem.quantity },
                        reserved: { decrement: deliveryItem.quantity },
                    },
                });
                await tx.orderItem.update({
                    where: { id: orderItem.id },
                    data: {
                        deliveredQuantity: { increment: deliveryItem.quantity },
                    },
                });
            }
            await this.updateReservationFulfillment(tx, dto.orderId);
            await this.updateOrderShipmentStatus(tx, dto.orderId);
            return delivery;
        });
    }
    async findAll(filterDto) {
        const page = filterDto.page ?? 1;
        const limit = filterDto.limit ?? 20;
        const where = {
            deletedAt: null,
            status: filterDto.status,
            paymentStatus: filterDto.paymentStatus,
            dealId: filterDto.dealId,
        };
        const [items, total] = await this.prisma.$transaction([
            this.prisma.order.findMany({
                where,
                include: orderDetailsInclude,
                orderBy: { createdAt: 'desc' },
                skip: (page - 1) * limit,
                take: limit,
            }),
            this.prisma.order.count({ where }),
        ]);
        return { items, total, page, limit };
    }
    async findOne(id) {
        const order = await this.prisma.order.findFirst({
            where: { id, deletedAt: null },
            include: orderDetailsInclude,
        });
        if (!order) {
            throw new common_1.NotFoundException('Order not found');
        }
        return order;
    }
    calculatePaymentStatus(paidAmount, totalAmount) {
        if (paidAmount.lessThanOrEqualTo(0)) {
            return client_1.PaymentStatus.UNPAID;
        }
        return paidAmount.greaterThanOrEqualTo(totalAmount)
            ? client_1.PaymentStatus.PAID
            : client_1.PaymentStatus.PARTIALLY_PAID;
    }
    async updateReservationFulfillment(tx, orderId) {
        const orderItems = await tx.orderItem.findMany({
            where: { orderId },
        });
        const allDelivered = orderItems.every((item) => item.deliveredQuantity >= item.quantity);
        if (!allDelivered) {
            return;
        }
        await tx.stockReservation.updateMany({
            where: {
                orderId,
                status: client_1.StockReservationStatus.ACTIVE,
            },
            data: { status: client_1.StockReservationStatus.FULFILLED },
        });
    }
    async updateOrderShipmentStatus(tx, orderId) {
        const orderItems = await tx.orderItem.findMany({
            where: { orderId },
        });
        const deliveredItems = orderItems.filter((item) => item.deliveredQuantity > 0);
        const allDelivered = orderItems.every((item) => item.deliveredQuantity >= item.quantity);
        if (allDelivered) {
            await tx.order.update({
                where: { id: orderId },
                data: { status: client_1.OrderStatus.SHIPPED },
            });
            return;
        }
        if (deliveredItems.length > 0) {
            await tx.order.update({
                where: { id: orderId },
                data: { status: client_1.OrderStatus.PARTIALLY_SHIPPED },
            });
        }
    }
    generateOrderNumber() {
        return `ORD-${Date.now()}`;
    }
    async ensureOrderExists(id) {
        const order = await this.prisma.order.findFirst({
            where: { id, deletedAt: null },
        });
        if (!order) {
            throw new common_1.NotFoundException('Order not found');
        }
        return order;
    }
};
exports.OrdersService = OrdersService;
exports.OrdersService = OrdersService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        inventory_service_1.InventoryService])
], OrdersService);
//# sourceMappingURL=orders.service.js.map