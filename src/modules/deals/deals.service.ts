import {
  BadRequestException,
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
  TaskPriority,
  TaskStatus,
  TaskType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ChangeStageDto } from './dto/change-stage.dto';
import { CreateDealItemDto } from './dto/create-deal-item.dto';
import { CreateDealDto } from './dto/create-deal.dto';
import { CreateOfferDto } from './dto/create-offer.dto';
import { FilterDealDto } from './dto/filter-deal.dto';
import { SetDealItemsDto } from './dto/set-deal-items.dto';
import { UpdateDealDto } from './dto/update-deal.dto';

const READ_ALL_DEALS_PERMISSION = 'deals:read_all';
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
});

const dealListInclude = Prisma.validator<Prisma.DealInclude>()({
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

type DealDetails = Prisma.DealGetPayload<{
  include: typeof dealDetailsInclude;
}>;

type DealListItem = Prisma.DealGetPayload<{
  include: typeof dealListInclude;
}>;

type DealListResult = {
  items: DealListItem[];
  total: number;
  page: number;
  limit: number;
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
  constructor(private readonly prisma: PrismaService) {}

  async create(
    dto: CreateDealDto,
    currentUserId: string,
  ): Promise<DealDetails> {
    const ownerId = dto.ownerId ?? currentUserId;
    const initialTaskDueDate = new Date(Date.now() + FIRST_DEAL_ACTION_SLA_MS);

    return this.prisma.$transaction(async (tx) => {
      const calculatedItems = await this.calculateDealItems(
        tx,
        dto.items ?? [],
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
        currentUserId,
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
    currentUserId: string,
    permissions: string[],
  ): Promise<DealListResult> {
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

  async findOne(id: string): Promise<DealDetails> {
    const deal = await this.prisma.deal.findFirst({
      where: { id, deletedAt: null },
      include: dealDetailsInclude,
    });

    if (!deal) {
      throw new NotFoundException('Deal not found');
    }

    return deal;
  }

  async update(id: string, dto: UpdateDealDto): Promise<DealDetails> {
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

  async setItems(dealId: string, dto: SetDealItemsDto): Promise<DealDetails> {
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

  async changeStage(
    id: string,
    dto: ChangeStageDto,
    currentUserId: string,
    permissions: string[],
  ): Promise<DealDetails> {
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
        throw new NotFoundException('Deal not found');
      }

      return result;
    });
  }

  async addOffer(dealId: string, dto: CreateOfferDto): Promise<DealOffer> {
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

  async approveOffer(dealId: string, offerId: string): Promise<DealOffer> {
    await this.ensureDealExists(dealId);

    const offer = await this.prisma.dealOffer.findFirst({
      where: { id: offerId, dealId },
      select: { id: true },
    });

    if (!offer) {
      throw new NotFoundException('Deal offer not found');
    }

    return this.prisma.dealOffer.update({
      where: { id: offerId },
      data: { isApproved: true },
    });
  }

  async softDelete(id: string): Promise<Deal> {
    await this.ensureDealExists(id);

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
    currentUserId: string,
    permissions: string[],
  ): Prisma.DealWhereInput {
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

  private async calculateDealItems(
    tx: Prisma.TransactionClient,
    items: CreateDealItemDto[],
  ): Promise<CalculatedDealItem[]> {
    const now = new Date();
    const calculatedItems: CalculatedDealItem[] = [];

    for (const item of items) {
      const product = await tx.product.findFirst({
        where: { id: item.productId, deletedAt: null },
        select: { id: true, sheetArea: true },
      });

      if (!product) {
        throw new NotFoundException(`Product not found: ${item.productId}`);
      }

      const purchasePrice = await tx.productPrice.findFirst({
        where: {
          productId: item.productId,
          type: ProductPriceType.PURCHASE,
          validFrom: { lte: now },
          OR: [{ validTo: null }, { validTo: { gte: now } }],
        },
        orderBy: { validFrom: 'desc' },
        select: { amount: true },
      });

      const calculatedQuantityM2 = product.sheetArea * item.quantitySheets;
      const quantityM2 = new Prisma.Decimal(calculatedQuantityM2);
      const unitPrice = new Prisma.Decimal(item.unitPrice);
      const discount = new Prisma.Decimal(item.discount ?? 0);
      const totalPrice = quantityM2.mul(unitPrice).minus(discount);
      const purchasePriceSnapshot = purchasePrice?.amount ?? null;
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

  private getStageTransitionViolations(
    deal: Pick<Deal, 'stage'> & {
      items: { id: string }[];
      offers: { id: string; isApproved: boolean }[];
    },
    dto: ChangeStageDto,
  ): string[] {
    const violations: string[] = [];

    if (
      dto.newStage === DealStage.OFFER_PREPARATION &&
      deal.items.length === 0
    ) {
      violations.push('items');
    }

    if (
      dto.newStage === DealStage.AGREEMENT_PENDING &&
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
    permissions: string[],
    violations: string[],
  ): void {
    const reason = dto.reason?.trim();
    const canApproveException = permissions.includes(
      STAGE_EXCEPTION_PERMISSION,
    );

    if (dto.isException === true && canApproveException && reason) {
      return;
    }

    throw new BadRequestException({
      message: 'Deal stage requirements are not met',
      violations,
      requiredPermissionForException: STAGE_EXCEPTION_PERMISSION,
    });
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
