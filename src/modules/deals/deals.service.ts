import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Deal,
  DealOffer,
  DealStage,
  ActivityType,
  Prisma,
  ProductPriceType,
  RoleName,
  TaskPriority,
  TaskStatus,
  TaskType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CurrentUser } from '../../common/interfaces/current-user.interface';
import {
  hasRole,
  POLICY_FORBIDDEN_MESSAGE,
} from '../../common/enums/role.enum';
import {
  COMMERCIAL_FIELDS_LOCKED_MESSAGE,
  DealPolicyService,
} from './services/deal-policy.service';
import { PricingPolicyService } from '../orders/services/pricing-policy.service';
import {
  DEAL_STAGE_TRANSITIONS,
  OVERRIDE_TERMINAL_STAGE_PERMISSION,
  TERMINAL_DEAL_STAGES,
} from './constants';
import { ChangeStageDto } from './dto/change-stage.dto';
import { CreateDealItemDto } from './dto/create-deal-item.dto';
import { CreateDealDto } from './dto/create-deal.dto';
import { CreateOfferDto } from './dto/create-offer.dto';
import { FilterDealDto } from './dto/filter-deal.dto';
import { SetDealItemsDto } from './dto/set-deal-items.dto';
import { UpdateDealDto } from './dto/update-deal.dto';

const STAGE_EXCEPTION_PERMISSION = 'deals:stage_exception';
const FIRST_DEAL_ACTION_SLA_MS = 2 * 60 * 60 * 1000;
const DEAL_RELATED_TYPE = 'Deal';
const OPEN_TASK_STATUSES = [TaskStatus.PENDING, TaskStatus.IN_PROGRESS];
const CLOSED_DEAL_STAGES: DealStage[] = [DealStage.WON, DealStage.LOST];

const dealDetailsInclude = Prisma.validator<Prisma.DealInclude>()({
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
  supplierOrders: {
    select: {
      id: true,
      status: true,
      estimatedDate: true,
      trackingNumber: true,
      supplierId: true,
      orderedAt: true,
      expectedReadyAt: true,
      expectedShipmentAt: true,
      expectedArrivalAt: true,
      readyConfirmedAt: true,
    },
    orderBy: { createdAt: 'asc' },
  },
  panelQuotes: {
    select: { id: true },
  },
});

// Лёгкий include для списка: без items/offers — они нужны только в карточке
const dealListInclude = Prisma.validator<Prisma.DealInclude>()({
  client: {
    select: { id: true, name: true },
  },
  projectObject: {
    select: { id: true, name: true },
  },
  owner: {
    select: { id: true, firstName: true, lastName: true },
  },
});

type DealDetails = Prisma.DealGetPayload<{
  include: typeof dealDetailsInclude;
}>;

type DealListItem = Prisma.DealGetPayload<{
  include: typeof dealListInclude;
}>;

type DealListResult = {
  items: Array<
    DealListItem & { _permissions: ReturnType<DealPolicyService['getPermissions']> }
  >;
  total: number;
  page: number;
  limit: number;
};

type DealDetailsWithPermissions = DealDetails & {
  _permissions: ReturnType<DealPolicyService['getPermissions']>;
};

type CalculatedDealItem = {
  productId: string;
  quantitySheets: number;
  quantityM2: number;
  unitPrice: Prisma.Decimal;
  discount: Prisma.Decimal;
  totalPrice: Prisma.Decimal;
  purchasePriceSnapshot: Prisma.Decimal | null;
  purchaseCost: Prisma.Decimal;
};

@Injectable()
export class DealsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dealPolicy: DealPolicyService,
    private readonly pricingPolicy: PricingPolicyService,
  ) {}

  async create(
    dto: CreateDealDto,
    user: CurrentUser,
  ): Promise<DealDetails> {
    const ownerId = this.resolveCreateOwnerId(dto.ownerId, user);
    const initialTaskDueDate = new Date(Date.now() + FIRST_DEAL_ACTION_SLA_MS);

    return this.prisma.$transaction(async (tx) => {
      await this.validateDealItemPricing(user, tx, dto.items ?? []);
      const calculatedItems = await this.calculateDealItems(
        tx,
        dto.items ?? [],
        user,
      );
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
        currentUserId: user.id,
        preferredDueDate: initialTaskDueDate,
      });

      const createdDeal = await tx.deal.findUnique({
        where: { id: deal.id },
        include: dealDetailsInclude,
      });

      if (!createdDeal) {
        throw new NotFoundException('Deal not found');
      }

      return createdDeal;
    });
  }

  async findAll(
    filterDto: FilterDealDto,
    user: CurrentUser,
  ): Promise<DealListResult> {
    const page = filterDto.page ?? 1;
    const limit = filterDto.limit ?? 20;
    const where = this.buildDealWhere(filterDto, user);

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

    return {
      items: items.map((deal) => this.attachDealPermissions(user, deal)),
      total,
      page,
      limit,
    };
  }

  async findOne(
    id: string,
    user: CurrentUser,
  ): Promise<DealDetailsWithPermissions> {
    const deal = await this.prisma.deal.findFirst({
      where: { id, deletedAt: null },
      include: dealDetailsInclude,
    });

    if (!deal) {
      throw new NotFoundException('Deal not found');
    }

    this.assertDealReadAccess(deal, user);

    return this.attachDealPermissions(user, deal);
  }

  async update(
    id: string,
    dto: UpdateDealDto,
    user: CurrentUser,
  ): Promise<DealDetailsWithPermissions> {
    const existingDeal = await this.ensureDealExists(id);
    this.assertDealReadAccess(existingDeal, user);
    this.assertDealMutationAllowed(user, existingDeal, (perms) => perms.canEdit);

    const updatedDeal = await this.prisma.deal.update({
      where: { id },
      data: {
        title: dto.title,
        clientId: dto.clientId,
        projectObjectId: dto.projectObjectId,
        expectedCloseDate: dto.expectedCloseDate,
      },
      include: dealDetailsInclude,
    });

    return this.attachDealPermissions(user, updatedDeal);
  }

  async setItems(
    dealId: string,
    dto: SetDealItemsDto,
    user: CurrentUser,
  ): Promise<DealDetailsWithPermissions> {
    const existingDeal = await this.ensureDealExists(dealId);
    this.assertDealReadAccess(existingDeal, user);
    this.assertCommercialMutationAllowed(user, existingDeal);

    return this.prisma.$transaction(async (tx) => {
      const previousItems = await tx.dealItem.findMany({
        where: { dealId },
        select: {
          productId: true,
          quantitySheets: true,
          quantityM2: true,
          unitPrice: true,
          discount: true,
          totalPrice: true,
        },
      });

      await this.validateDealItemPricing(user, tx, dto.items);
      const calculatedItems = await this.calculateDealItems(tx, dto.items, user);
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

      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: 'DEAL_ITEMS_UPDATED',
          entityType: 'Deal',
          entityId: dealId,
          oldValue: {
            totalAmount: existingDeal.totalAmount,
            items: previousItems,
          },
          newValue: {
            totalAmount: totals.totalAmount,
            items: calculatedItems.map((item) => ({
              productId: item.productId,
              quantitySheets: item.quantitySheets,
              quantityM2: item.quantityM2,
              unitPrice: item.unitPrice,
              discount: item.discount,
              totalPrice: item.totalPrice,
            })),
          },
        },
      });

      return this.attachDealPermissions(user, deal);
    });
  }

  async changeStage(
    id: string,
    dto: ChangeStageDto,
    user: CurrentUser,
  ): Promise<DealDetailsWithPermissions> {
    const deal = await this.prisma.deal.findFirst({
      where: { id, deletedAt: null },
      include: {
        items: true,
        offers: true,
      },
    });

    if (!deal) {
      throw new NotFoundException('Deal not found');
    }

    this.assertDealReadAccess(deal, user);

    const dealPermissions = this.dealPolicy.getPermissions(user, deal);

    // Идемпотентность: переход «в ту же стадию» — no-op без валидаций.
    const isStageChange = deal.stage !== dto.newStage;

    if (isStageChange && !dealPermissions.canChangeStage) {
      const isTerminalOverride = TERMINAL_DEAL_STAGES.includes(deal.stage);
      if (!isTerminalOverride) {
        throw new ForbiddenException(POLICY_FORBIDDEN_MESSAGE);
      }
    }

    // Выход из терминальной стадии (WON/LOST) — только с отдельным
    // permission и обязательной причиной (ТЗ 5.5, правило 4).
    const isTerminalOverride =
      isStageChange && TERMINAL_DEAL_STAGES.includes(deal.stage);

    if (isTerminalOverride) {
      this.assertTerminalOverrideAllowed(deal.stage, dto, user.permissions);
    }

    // Сначала матрица переходов from → to, потом prerequisites стадии.
    const violations = isStageChange
      ? [
          ...this.getStageMatrixViolations(
            deal.stage,
            dto.newStage,
            isTerminalOverride,
          ),
          ...this.getStageTransitionViolations(deal, dto),
        ]
      : [];
    const isException =
      (violations.length > 0 && dto.isException === true) || isTerminalOverride;

    if (violations.length > 0) {
      this.assertStageExceptionAllowed(dto, user, deal, violations);
    }

    const changedDeal = await this.prisma.$transaction(async (tx) => {
      const activeStage = this.isActiveStage(dto.newStage);
      const nextActionAt = activeStage
        ? await this.getNextOpenTaskDueDate(tx, id)
        : null;

      const updatedDeal = await tx.deal.update({
        where: { id },
        data: {
          stage: dto.newStage,
          lossReason:
            dto.newStage === DealStage.LOST ? dto.lossReason?.trim() : null,
          competitorName:
            dto.newStage === DealStage.LOST ? dto.competitorName?.trim() : null,
          nextActionAt,
        },
      });

      await tx.dealStageHistory.create({
        data: {
          dealId: id,
          oldStage: deal.stage,
          newStage: dto.newStage,
          changedById: user.id,
          reason: dto.reason?.trim(),
          isException,
          approvedById: isException ? user.id : undefined,
        },
      });

      await tx.activity.create({
        data: {
          authorId: user.id,
          relatedType: 'Deal',
          relatedId: id,
          type: ActivityType.STAGE_CHANGED,
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
          userId: user.id,
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
          currentUserId: user.id,
        });

        await this.updateDealNextActionAt(tx, id);
      }

      const result = await tx.deal.findUnique({
        where: { id },
        include: dealDetailsInclude,
      });

      if (!result) {
        throw new NotFoundException('Deal not found');
      }

      return result;
    });

    return this.attachDealPermissions(user, changedDeal);
  }

  async getDeliveryStatus(
    dealId: string,
    user: CurrentUser,
  ): Promise<{
    source: 'SUPPLIER_ORDER' | 'ORDER' | null;
    status: string | null;
    supplierOrderId: string | null;
    orderId: string | null;
  }> {
    const deal = await this.prisma.deal.findFirst({
      where: { id: dealId, deletedAt: null },
      include: {
        supplierOrders: {
          select: { id: true, status: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
        },
        order: {
          select: { id: true, status: true },
        },
      },
    });

    if (!deal) {
      throw new NotFoundException('Deal not found');
    }

    this.assertDealReadAccess(deal, user);

    if (deal.supplierOrders.length > 0) {
      const latest = deal.supplierOrders[0];
      return {
        source: 'SUPPLIER_ORDER',
        status: latest.status,
        supplierOrderId: latest.id,
        orderId: deal.order?.id ?? null,
      };
    }

    if (deal.order) {
      return {
        source: 'ORDER',
        status: deal.order.status,
        supplierOrderId: null,
        orderId: deal.order.id,
      };
    }

    return {
      source: null,
      status: null,
      supplierOrderId: null,
      orderId: null,
    };
  }

  async addOffer(
    dealId: string,
    dto: CreateOfferDto,
    user: CurrentUser,
  ): Promise<DealOffer> {
    const deal = await this.ensureDealExists(dealId);
    this.assertDealReadAccess(deal, user);
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

  async approveOffer(
    dealId: string,
    offerId: string,
    user: CurrentUser,
  ): Promise<DealOffer> {
    const existingDeal = await this.ensureDealExists(dealId);
    this.assertDealReadAccess(existingDeal, user);

    const offer = await this.prisma.dealOffer.findFirst({
      where: { id: offerId, dealId },
      select: { id: true, isApproved: true },
    });

    if (!offer) {
      throw new NotFoundException('Deal offer not found');
    }

    const approved = await this.prisma.dealOffer.update({
      where: { id: offerId },
      data: { isApproved: true },
    });

    await this.prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'DEAL_OFFER_APPROVED',
        entityType: 'DealOffer',
        entityId: offerId,
        oldValue: { isApproved: offer.isApproved },
        newValue: { isApproved: true, dealId },
      },
    });

    return approved;
  }

  async softDelete(
    id: string,
    user: CurrentUser,
  ): Promise<Deal> {
    const existingDeal = await this.ensureDealExists(id);
    this.assertDealReadAccess(existingDeal, user);
    this.assertDealMutationAllowed(user, existingDeal, (perms) => perms.canDelete);

    return this.prisma.deal.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async syncNextActionDate(dealId: string): Promise<Deal> {
    await this.ensureDealExists(dealId);
    const nextActionAt = await this.getNextOpenTaskDueDate(this.prisma, dealId);

    return this.prisma.deal.update({
      where: { id: dealId },
      data: { nextActionAt },
    });
  }

  private buildDealWhere(
    filterDto: FilterDealDto,
    user: CurrentUser,
  ): Prisma.DealWhereInput {
    const scopeFilter = this.dealPolicy.getScopeFilter(user);
    const ownerId =
      'ownerId' in scopeFilter ? scopeFilter.ownerId : filterDto.ownerId;

    return {
      deletedAt: null,
      stage: filterDto.stage,
      clientId: filterDto.clientId,
      projectObjectId: filterDto.projectObjectId,
      ownerId,
      OR: filterDto.search
        ? [
            { title: { contains: filterDto.search } },
            {
              client: {
                name: { contains: filterDto.search },
              },
            },
            {
              projectObject: {
                name: { contains: filterDto.search },
              },
            },
          ]
        : undefined,
    };
  }

  private async validateDealItemPricing(
    user: CurrentUser,
    tx: Prisma.TransactionClient,
    items: CreateDealItemDto[],
  ): Promise<void> {
    this.pricingPolicy.assertManagerCannotAssignDiscount(user, items);

    if (items.length === 0) {
      return;
    }

    const productIds = [...new Set(items.map((item) => item.productId))];
    const now = new Date();
    const prices = await tx.productPrice.findMany({
      where: {
        productId: { in: productIds },
        type: {
          in: [
            ProductPriceType.BASE,
            ProductPriceType.PURCHASE,
            ProductPriceType.RETAIL,
          ],
        },
        validFrom: { lte: now },
        OR: [{ validTo: null }, { validTo: { gte: now } }],
      },
      orderBy: { validFrom: 'desc' },
      select: { productId: true, type: true, amount: true },
    });

    const basePriceMap = new Map<string, number>();
    const retailPriceMap = new Map<string, number>();
    const purchasePriceMap = new Map<string, number>();

    for (const price of prices) {
      if (
        price.type === ProductPriceType.BASE &&
        !basePriceMap.has(price.productId)
      ) {
        basePriceMap.set(price.productId, Number(price.amount));
      }

      if (
        price.type === ProductPriceType.RETAIL &&
        !retailPriceMap.has(price.productId)
      ) {
        retailPriceMap.set(price.productId, Number(price.amount));
      }

      if (
        price.type === ProductPriceType.PURCHASE &&
        !purchasePriceMap.has(price.productId)
      ) {
        purchasePriceMap.set(price.productId, Number(price.amount));
      }
    }

    const validationItems: Array<{
      productId: string;
      price: number;
      basePrice: number;
      purchasePrice: number;
    }> = [];

    for (const item of items) {
      const basePrice =
        basePriceMap.get(item.productId) ??
        retailPriceMap.get(item.productId);
      const purchasePrice = purchasePriceMap.get(item.productId);

      if (purchasePrice === undefined) {
        throw new BadRequestException(
          `Purchase price is not configured for product ${item.productId}`,
        );
      }

      const effectivePrice =
        item.unitPrice - (item.discount ?? 0) / item.quantityM2;

      if (effectivePrice < purchasePrice) {
        throw new BadRequestException(
          `Цена позиции (${effectivePrice}) не может быть ниже закупочной цены (${purchasePrice})`,
        );
      }

      if (basePrice === undefined) {
        continue;
      }

      validationItems.push({
        productId: item.productId,
        price: effectivePrice,
        basePrice,
        purchasePrice,
      });
    }

    if (validationItems.length > 0) {
      this.pricingPolicy.validateItemPrices(user, validationItems);
    }
  }

  private async calculateDealItems(
    tx: Prisma.TransactionClient,
    items: CreateDealItemDto[],
    user: CurrentUser,
  ): Promise<CalculatedDealItem[]> {
    const now = new Date();
    const calculatedItems: CalculatedDealItem[] = [];
    const productIds = [...new Set(items.map((item) => item.productId))];
    const stripManagerDiscount =
      hasRole(user, RoleName.MANAGER) && !hasRole(user, RoleName.HEAD);

    // 2 запроса на всю пачку позиций вместо 2 × N
    const products = await tx.product.findMany({
      where: { id: { in: productIds }, deletedAt: null },
      select: { id: true, sheetArea: true },
    });
    const productMap = new Map(
      products.map((product) => [product.id, product]),
    );

    const purchasePrices = await tx.productPrice.findMany({
      where: {
        productId: { in: productIds },
        type: ProductPriceType.PURCHASE,
        validFrom: { lte: now },
        OR: [{ validTo: null }, { validTo: { gte: now } }],
      },
      orderBy: { validFrom: 'desc' },
      select: { productId: true, amount: true },
    });
    // Цены отсортированы по validFrom desc — первая встреченная актуальна
    const purchasePriceMap = new Map<string, Prisma.Decimal>();
    for (const price of purchasePrices) {
      if (!purchasePriceMap.has(price.productId)) {
        purchasePriceMap.set(price.productId, price.amount);
      }
    }

    for (const item of items) {
      const product = productMap.get(item.productId);

      if (!product) {
        throw new NotFoundException(`Product not found: ${item.productId}`);
      }

      const purchasePriceSnapshot =
        purchasePriceMap.get(item.productId) ?? null;

      const calculatedQuantityM2 = product.sheetArea * item.quantitySheets;
      const quantityM2 = new Prisma.Decimal(calculatedQuantityM2);
      const unitPrice = new Prisma.Decimal(item.unitPrice);
      const discount = new Prisma.Decimal(
        stripManagerDiscount ? 0 : (item.discount ?? 0),
      );
      const totalPrice = quantityM2.mul(unitPrice).minus(discount);
      const purchaseCost = purchasePriceSnapshot
        ? quantityM2.mul(purchasePriceSnapshot)
        : new Prisma.Decimal(0);

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

  private calculateTotals(items: CalculatedDealItem[]): {
    totalAmount: Prisma.Decimal;
    margin: Prisma.Decimal;
  } {
    const totalAmount = items.reduce(
      (sum, item) => sum.plus(item.totalPrice),
      new Prisma.Decimal(0),
    );
    const purchaseCost = items.reduce(
      (sum, item) => sum.plus(item.purchaseCost),
      new Prisma.Decimal(0),
    );

    return {
      totalAmount,
      margin: totalAmount.minus(purchaseCost),
    };
  }

  private assertTerminalOverrideAllowed(
    currentStage: DealStage,
    dto: ChangeStageDto,
    permissions: string[],
  ): void {
    if (!permissions.includes(OVERRIDE_TERMINAL_STAGE_PERMISSION)) {
      throw new ForbiddenException(
        `Cannot change stage from terminal ${currentStage}. Contact head manager.`,
      );
    }

    if (!dto.reason?.trim()) {
      throw new BadRequestException(
        'Reason is required to leave a terminal stage',
      );
    }
  }

  // Матрица from → to. Терминальный override пропускает матрицу
  // (право deals:override_terminal уже проверено выше).
  private getStageMatrixViolations(
    currentStage: DealStage,
    newStage: DealStage,
    isTerminalOverride: boolean,
  ): string[] {
    if (isTerminalOverride) {
      return [];
    }

    const allowed = DEAL_STAGE_TRANSITIONS[currentStage] ?? [];

    if (allowed.includes(newStage)) {
      return [];
    }

    return [
      `transition:${currentStage}->${newStage} (allowed: ${
        allowed.length > 0 ? allowed.join(', ') : 'none — terminal stage'
      })`,
    ];
  }

  private getStageTransitionViolations(
    deal: Pick<Deal, 'stage'> & {
      items: { id: string }[];
      offers: { id: string; isApproved: boolean }[];
    },
    dto: ChangeStageDto,
  ): string[] {
    const violations: string[] = [];

    if (
      (dto.newStage === DealStage.OFFER_PREPARATION ||
        dto.newStage === DealStage.NEGOTIATION ||
        dto.newStage === DealStage.WON) &&
      deal.items.length === 0
    ) {
      violations.push('items');
    }

    if (dto.newStage === DealStage.NEGOTIATION && deal.offers.length === 0) {
      violations.push('offers');
    }

    if (
      (dto.newStage === DealStage.AGREEMENT_PENDING ||
        dto.newStage === DealStage.PAYMENT_PREPARATION ||
        dto.newStage === DealStage.WON) &&
      !deal.offers.some((offer) => offer.isApproved)
    ) {
      violations.push('approvedOffer');
    }

    if (dto.newStage === DealStage.LOST && !dto.lossReason?.trim()) {
      violations.push('lossReason');
    }

    return violations;
  }

  private assertStageExceptionAllowed(
    dto: ChangeStageDto,
    user: CurrentUser,
    deal: Pick<Deal, 'ownerId' | 'stage'>,
    violations: string[],
  ): void {
    const reason = dto.reason?.trim();
    const canApproveException = this.dealPolicy.getPermissions(
      user,
      deal,
    ).canBypassStageValidation;

    if (dto.isException === true && !canApproveException) {
      throw new ForbiddenException(
        'You do not have permission to use deal stage exceptions',
      );
    }

    if (dto.isException === true && !reason) {
      throw new BadRequestException({
        message: 'Deal stage requirements are not met',
        violations,
        requiredPermissionForException: STAGE_EXCEPTION_PERMISSION,
      });
    }

    if (dto.isException === true && canApproveException && reason) {
      return;
    }

    throw new BadRequestException({
      message: 'Deal stage requirements are not met',
      violations,
      requiredPermissionForException: STAGE_EXCEPTION_PERMISSION,
    });
  }

  private attachDealPermissions<T extends Pick<Deal, 'ownerId' | 'stage'>>(
    user: CurrentUser,
    deal: T,
  ): T & { _permissions: ReturnType<DealPolicyService['getPermissions']> } {
    return {
      ...deal,
      _permissions: this.dealPolicy.getPermissions(user, deal),
    };
  }

  private assertDealReadAccess(
    deal: Pick<Deal, 'ownerId'>,
    user: CurrentUser,
  ): void {
    if (!this.dealPolicy.canReadDeal(user, deal)) {
      throw new ForbiddenException('Access to this deal is forbidden');
    }
  }

  private assertDealMutationAllowed(
    user: CurrentUser,
    deal: Pick<Deal, 'ownerId' | 'stage'>,
    selector: (
      permissions: ReturnType<DealPolicyService['getPermissions']>,
    ) => boolean,
  ): void {
    const permissions = this.dealPolicy.getPermissions(user, deal);

    if (!selector(permissions)) {
      throw new ForbiddenException(POLICY_FORBIDDEN_MESSAGE);
    }
  }

  private assertCommercialMutationAllowed(
    user: CurrentUser,
    deal: Pick<Deal, 'ownerId' | 'stage'>,
  ): void {
    const permissions = this.dealPolicy.getPermissions(user, deal);

    if (!permissions.canEdit) {
      throw new ForbiddenException(POLICY_FORBIDDEN_MESSAGE);
    }

    if (!permissions.canMutateCommercial) {
      throw new ForbiddenException(COMMERCIAL_FIELDS_LOCKED_MESSAGE);
    }
  }

  private resolveCreateOwnerId(
    requestedOwnerId: string | undefined,
    user: CurrentUser,
  ): string {
    if (!requestedOwnerId || requestedOwnerId === user.id) {
      return user.id;
    }

    if (hasRole(user, RoleName.HEAD)) {
      return requestedOwnerId;
    }

    throw new ForbiddenException(
      'Insufficient permissions to assign deal owner',
    );
  }

  private async ensureOpenTaskForActiveDeal(
    tx: Prisma.TransactionClient,
    input: {
      dealId: string;
      title: string;
      ownerId: string;
      currentUserId: string;
      preferredDueDate?: Date;
    },
  ): Promise<void> {
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

    const dueDate =
      input.preferredDueDate ?? new Date(Date.now() + FIRST_DEAL_ACTION_SLA_MS);

    await tx.task.create({
      data: {
        title: `Next action: ${input.title}`,
        type: TaskType.CALL,
        priority: TaskPriority.HIGH,
        dueDate,
        originalDueDate: dueDate,
        assigneeId: input.ownerId,
        createdById: input.currentUserId,
        relatedType: DEAL_RELATED_TYPE,
        relatedId: input.dealId,
      },
    });
  }

  private async updateDealNextActionAt(
    tx: Prisma.TransactionClient,
    dealId: string,
  ): Promise<void> {
    const nextActionAt = await this.getNextOpenTaskDueDate(tx, dealId);

    await tx.deal.update({
      where: { id: dealId },
      data: { nextActionAt },
    });
  }

  private async getNextOpenTaskDueDate(
    client: Prisma.TransactionClient | PrismaService,
    dealId: string,
  ): Promise<Date | null> {
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

  private buildOfferNumber(dealId: string, version: number): string {
    return `KP-${dealId.slice(0, 8)}-v${version}`;
  }

  private isActiveStage(stage: DealStage): boolean {
    return !CLOSED_DEAL_STAGES.includes(stage);
  }

  private async ensureDealExists(id: string): Promise<Deal> {
    const deal = await this.prisma.deal.findFirst({
      where: { id, deletedAt: null },
    });

    if (!deal) {
      throw new NotFoundException('Deal not found');
    }

    return deal;
  }
}
