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
exports.DealsService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const prisma_service_1 = require("../prisma/prisma.service");
const READ_ALL_DEALS_PERMISSION = 'deals:read_all';
const STAGE_EXCEPTION_PERMISSION = 'deals:stage_exception';
const FIRST_DEAL_ACTION_SLA_MS = 2 * 60 * 60 * 1000;
const DEAL_RELATED_TYPE = 'Deal';
const OPEN_TASK_STATUSES = [client_1.TaskStatus.PENDING, client_1.TaskStatus.IN_PROGRESS];
const CLOSED_DEAL_STAGES = [client_1.DealStage.WON, client_1.DealStage.LOST];
const dealDetailsInclude = client_1.Prisma.validator()({
    client: true,
    projectObject: true,
    owner: true,
    items: {
        include: {
            product: true,
        },
    },
    offers: {
        orderBy: { version: 'desc' },
    },
    stageHistory: {
        include: {
            changedBy: true,
            approvedBy: true,
        },
        orderBy: { createdAt: 'desc' },
    },
    order: true,
});
const dealListInclude = client_1.Prisma.validator()({
    client: true,
    projectObject: true,
    owner: true,
    items: {
        include: {
            product: true,
        },
    },
    offers: {
        orderBy: { version: 'desc' },
    },
});
let DealsService = class DealsService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async create(dto, currentUserId) {
        const ownerId = dto.ownerId ?? currentUserId;
        const initialTaskDueDate = new Date(Date.now() + FIRST_DEAL_ACTION_SLA_MS);
        return this.prisma.$transaction(async (tx) => {
            const calculatedItems = await this.calculateDealItems(tx, dto.items ?? []);
            const totals = this.calculateTotals(calculatedItems);
            const deal = await tx.deal.create({
                data: {
                    title: dto.title,
                    clientId: dto.clientId,
                    projectObjectId: dto.projectObjectId,
                    ownerId,
                    expectedCloseDate: dto.expectedCloseDate,
                    totalAmount: totals.totalAmount,
                    margin: totals.margin,
                    nextActionAt: initialTaskDueDate,
                    items: {
                        create: calculatedItems.map((item) => ({
                            productId: item.productId,
                            quantitySheets: item.quantitySheets,
                            quantityM2: item.quantityM2,
                            unitPrice: item.unitPrice,
                            discount: item.discount,
                            totalPrice: item.totalPrice,
                            purchasePriceSnapshot: item.purchasePriceSnapshot,
                        })),
                    },
                },
            });
            await this.ensureOpenTaskForActiveDeal(tx, {
                dealId: deal.id,
                title: deal.title,
                ownerId: deal.ownerId,
                currentUserId,
                preferredDueDate: initialTaskDueDate,
            });
            const createdDeal = await tx.deal.findUnique({
                where: { id: deal.id },
                include: dealDetailsInclude,
            });
            if (!createdDeal) {
                throw new common_1.NotFoundException('Deal not found');
            }
            return createdDeal;
        });
    }
    async findAll(filterDto, currentUserId, permissions) {
        const page = filterDto.page ?? 1;
        const limit = filterDto.limit ?? 20;
        const where = this.buildDealWhere(filterDto, currentUserId, permissions);
        const [items, total] = await this.prisma.$transaction([
            this.prisma.deal.findMany({
                where,
                include: dealListInclude,
                orderBy: { createdAt: 'desc' },
                skip: (page - 1) * limit,
                take: limit,
            }),
            this.prisma.deal.count({ where }),
        ]);
        return { items, total, page, limit };
    }
    async findOne(id) {
        const deal = await this.prisma.deal.findFirst({
            where: { id, deletedAt: null },
            include: dealDetailsInclude,
        });
        if (!deal) {
            throw new common_1.NotFoundException('Deal not found');
        }
        return deal;
    }
    async update(id, dto) {
        await this.ensureDealExists(id);
        const updatedDeal = await this.prisma.deal.update({
            where: { id },
            data: {
                title: dto.title,
                clientId: dto.clientId,
                projectObjectId: dto.projectObjectId,
                ownerId: dto.ownerId,
                expectedCloseDate: dto.expectedCloseDate,
            },
            include: dealDetailsInclude,
        });
        return updatedDeal;
    }
    async setItems(dealId, dto) {
        await this.ensureDealExists(dealId);
        return this.prisma.$transaction(async (tx) => {
            const calculatedItems = await this.calculateDealItems(tx, dto.items);
            const totals = this.calculateTotals(calculatedItems);
            await tx.dealItem.deleteMany({ where: { dealId } });
            if (calculatedItems.length > 0) {
                await tx.dealItem.createMany({
                    data: calculatedItems.map((item) => ({
                        dealId,
                        productId: item.productId,
                        quantitySheets: item.quantitySheets,
                        quantityM2: item.quantityM2,
                        unitPrice: item.unitPrice,
                        discount: item.discount,
                        totalPrice: item.totalPrice,
                        purchasePriceSnapshot: item.purchasePriceSnapshot,
                    })),
                });
            }
            const deal = await tx.deal.update({
                where: { id: dealId },
                data: {
                    totalAmount: totals.totalAmount,
                    margin: totals.margin,
                },
                include: dealDetailsInclude,
            });
            return deal;
        });
    }
    async changeStage(id, dto, currentUserId, permissions) {
        const deal = await this.prisma.deal.findFirst({
            where: { id, deletedAt: null },
            include: {
                items: true,
                offers: true,
            },
        });
        if (!deal) {
            throw new common_1.NotFoundException('Deal not found');
        }
        const violations = this.getStageTransitionViolations(deal, dto);
        const isException = violations.length > 0 && dto.isException === true;
        if (violations.length > 0) {
            this.assertStageExceptionAllowed(dto, permissions, violations);
        }
        return this.prisma.$transaction(async (tx) => {
            const activeStage = this.isActiveStage(dto.newStage);
            const nextActionAt = activeStage
                ? await this.getNextOpenTaskDueDate(tx, id)
                : null;
            const updatedDeal = await tx.deal.update({
                where: { id },
                data: {
                    stage: dto.newStage,
                    lossReason: dto.newStage === client_1.DealStage.LOST ? dto.lossReason?.trim() : null,
                    competitorName: dto.newStage === client_1.DealStage.LOST ? dto.competitorName?.trim() : null,
                    nextActionAt,
                },
            });
            await tx.dealStageHistory.create({
                data: {
                    dealId: id,
                    oldStage: deal.stage,
                    newStage: dto.newStage,
                    changedById: currentUserId,
                    reason: dto.reason?.trim(),
                    isException,
                    approvedById: isException ? currentUserId : undefined,
                },
            });
            await tx.activity.create({
                data: {
                    authorId: currentUserId,
                    relatedType: 'Deal',
                    relatedId: id,
                    type: client_1.ActivityType.STAGE_CHANGED,
                    content: `Deal stage changed from ${deal.stage} to ${dto.newStage}`,
                    metadata: {
                        oldStage: deal.stage,
                        newStage: dto.newStage,
                        isException,
                    },
                },
            });
            await tx.auditLog.create({
                data: {
                    userId: currentUserId,
                    action: 'DEAL_STAGE_CHANGED',
                    entityType: 'Deal',
                    entityId: id,
                    oldValue: { stage: deal.stage },
                    newValue: {
                        stage: dto.newStage,
                        lossReason: dto.lossReason?.trim(),
                        competitorName: dto.competitorName?.trim(),
                        isException,
                    },
                },
            });
            if (activeStage) {
                await this.ensureOpenTaskForActiveDeal(tx, {
                    dealId: updatedDeal.id,
                    title: updatedDeal.title,
                    ownerId: updatedDeal.ownerId,
                    currentUserId,
                });
                await this.updateDealNextActionAt(tx, id);
            }
            const result = await tx.deal.findUnique({
                where: { id },
                include: dealDetailsInclude,
            });
            if (!result) {
                throw new common_1.NotFoundException('Deal not found');
            }
            return result;
        });
    }
    async addOffer(dealId, dto) {
        const deal = await this.ensureDealExists(dealId);
        const latestOffer = await this.prisma.dealOffer.findFirst({
            where: { dealId },
            orderBy: { version: 'desc' },
            select: { version: true },
        });
        const version = (latestOffer?.version ?? 0) + 1;
        return this.prisma.dealOffer.create({
            data: {
                dealId,
                version,
                number: this.buildOfferNumber(dealId, version),
                amount: deal.totalAmount,
                validUntil: dto.validUntil,
                pdfFileId: dto.pdfFileId,
            },
        });
    }
    async approveOffer(dealId, offerId) {
        await this.ensureDealExists(dealId);
        const offer = await this.prisma.dealOffer.findFirst({
            where: { id: offerId, dealId },
            select: { id: true },
        });
        if (!offer) {
            throw new common_1.NotFoundException('Deal offer not found');
        }
        return this.prisma.dealOffer.update({
            where: { id: offerId },
            data: { isApproved: true },
        });
    }
    async softDelete(id) {
        await this.ensureDealExists(id);
        return this.prisma.deal.update({
            where: { id },
            data: { deletedAt: new Date() },
        });
    }
    async syncNextActionDate(dealId) {
        await this.ensureDealExists(dealId);
        const nextActionAt = await this.getNextOpenTaskDueDate(this.prisma, dealId);
        return this.prisma.deal.update({
            where: { id: dealId },
            data: { nextActionAt },
        });
    }
    buildDealWhere(filterDto, currentUserId, permissions) {
        const canReadAllDeals = permissions.includes(READ_ALL_DEALS_PERMISSION);
        return {
            deletedAt: null,
            stage: filterDto.stage,
            clientId: filterDto.clientId,
            projectObjectId: filterDto.projectObjectId,
            ownerId: canReadAllDeals
                ? filterDto.ownerId
                : (filterDto.ownerId ?? currentUserId),
            OR: filterDto.search
                ? [
                    { title: { contains: filterDto.search, mode: 'insensitive' } },
                    {
                        client: {
                            name: { contains: filterDto.search, mode: 'insensitive' },
                        },
                    },
                    {
                        projectObject: {
                            name: { contains: filterDto.search, mode: 'insensitive' },
                        },
                    },
                ]
                : undefined,
        };
    }
    async calculateDealItems(tx, items) {
        const now = new Date();
        const calculatedItems = [];
        for (const item of items) {
            const product = await tx.product.findFirst({
                where: { id: item.productId, deletedAt: null },
                select: { id: true, sheetArea: true },
            });
            if (!product) {
                throw new common_1.NotFoundException(`Product not found: ${item.productId}`);
            }
            const purchasePrice = await tx.productPrice.findFirst({
                where: {
                    productId: item.productId,
                    type: client_1.ProductPriceType.PURCHASE,
                    validFrom: { lte: now },
                    OR: [{ validTo: null }, { validTo: { gte: now } }],
                },
                orderBy: { validFrom: 'desc' },
                select: { amount: true },
            });
            const calculatedQuantityM2 = product.sheetArea * item.quantitySheets;
            const quantityM2 = new client_1.Prisma.Decimal(calculatedQuantityM2);
            const unitPrice = new client_1.Prisma.Decimal(item.unitPrice);
            const discount = new client_1.Prisma.Decimal(item.discount ?? 0);
            const totalPrice = quantityM2.mul(unitPrice).minus(discount);
            const purchasePriceSnapshot = purchasePrice?.amount ?? null;
            const purchaseCost = purchasePriceSnapshot
                ? quantityM2.mul(purchasePriceSnapshot)
                : new client_1.Prisma.Decimal(0);
            calculatedItems.push({
                productId: item.productId,
                quantitySheets: item.quantitySheets,
                quantityM2: calculatedQuantityM2,
                unitPrice,
                discount,
                totalPrice,
                purchasePriceSnapshot,
                purchaseCost,
            });
        }
        return calculatedItems;
    }
    calculateTotals(items) {
        const totalAmount = items.reduce((sum, item) => sum.plus(item.totalPrice), new client_1.Prisma.Decimal(0));
        const purchaseCost = items.reduce((sum, item) => sum.plus(item.purchaseCost), new client_1.Prisma.Decimal(0));
        return {
            totalAmount,
            margin: totalAmount.minus(purchaseCost),
        };
    }
    getStageTransitionViolations(deal, dto) {
        const violations = [];
        if (dto.newStage === client_1.DealStage.OFFER_PREPARATION &&
            deal.items.length === 0) {
            violations.push('items');
        }
        if (dto.newStage === client_1.DealStage.AGREEMENT_PENDING &&
            !deal.offers.some((offer) => offer.isApproved)) {
            violations.push('approvedOffer');
        }
        if (dto.newStage === client_1.DealStage.LOST && !dto.lossReason?.trim()) {
            violations.push('lossReason');
        }
        return violations;
    }
    assertStageExceptionAllowed(dto, permissions, violations) {
        const reason = dto.reason?.trim();
        const canApproveException = permissions.includes(STAGE_EXCEPTION_PERMISSION);
        if (dto.isException === true && canApproveException && reason) {
            return;
        }
        throw new common_1.BadRequestException({
            message: 'Deal stage requirements are not met',
            violations,
            requiredPermissionForException: STAGE_EXCEPTION_PERMISSION,
        });
    }
    async ensureOpenTaskForActiveDeal(tx, input) {
        const existingOpenTask = await tx.task.findFirst({
            where: {
                relatedType: DEAL_RELATED_TYPE,
                relatedId: input.dealId,
                status: { in: OPEN_TASK_STATUSES },
            },
            select: { id: true },
        });
        if (existingOpenTask) {
            return;
        }
        const dueDate = input.preferredDueDate ?? new Date(Date.now() + FIRST_DEAL_ACTION_SLA_MS);
        await tx.task.create({
            data: {
                title: `Next action: ${input.title}`,
                type: client_1.TaskType.CALL,
                priority: client_1.TaskPriority.HIGH,
                dueDate,
                originalDueDate: dueDate,
                assigneeId: input.ownerId,
                createdById: input.currentUserId,
                relatedType: DEAL_RELATED_TYPE,
                relatedId: input.dealId,
            },
        });
    }
    async updateDealNextActionAt(tx, dealId) {
        const nextActionAt = await this.getNextOpenTaskDueDate(tx, dealId);
        await tx.deal.update({
            where: { id: dealId },
            data: { nextActionAt },
        });
    }
    async getNextOpenTaskDueDate(client, dealId) {
        const task = await client.task.findFirst({
            where: {
                relatedType: DEAL_RELATED_TYPE,
                relatedId: dealId,
                status: { in: OPEN_TASK_STATUSES },
            },
            orderBy: { dueDate: 'asc' },
            select: { dueDate: true },
        });
        return task?.dueDate ?? null;
    }
    buildOfferNumber(dealId, version) {
        return `KP-${dealId.slice(0, 8)}-v${version}`;
    }
    isActiveStage(stage) {
        return !CLOSED_DEAL_STAGES.includes(stage);
    }
    async ensureDealExists(id) {
        const deal = await this.prisma.deal.findFirst({
            where: { id, deletedAt: null },
        });
        if (!deal) {
            throw new common_1.NotFoundException('Deal not found');
        }
        return deal;
    }
};
exports.DealsService = DealsService;
exports.DealsService = DealsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], DealsService);
//# sourceMappingURL=deals.service.js.map