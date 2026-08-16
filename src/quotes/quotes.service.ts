import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ActivityType,
  LeadStatus,
  Prisma,
  TaskPriority,
  TaskType,
  CommercialQualificationStatus,
} from '@prisma/client';
import { CALCULATION_PERMISSIONS, CALCULATION_STATUS } from '../calculations/calculation.constants';
import { BusinessException } from '../common/exceptions/business.exception';
import type { CurrentUser } from '../common/interfaces/current-user.interface';
import { DealFactory } from '../modules/deals/services/deal-factory.service';
import { CALCULATOR_PRODUCT_SKU } from './calculator-product.constants';
import { NotificationService } from '../modules/notifications/notification.service';
import { PrismaService } from '../modules/prisma/prisma.service';
import { ConvertCalculationToQuoteDto } from './dto/convert-calculation-to-quote.dto';
import { FilterQuotesDto } from './dto/filter-quotes.dto';
import { UpdateQuoteStatusDto } from './dto/update-quote-status.dto';
import {
  DEFAULT_QUOTE_VALIDITY_DAYS,
  QUOTE_PERMISSIONS,
  QUOTE_STATUS,
  QUOTE_STATUS_TRANSITIONS,
} from './quote.constants';

const quoteInclude = Prisma.validator<Prisma.PanelQuoteInclude>()({
  items: { orderBy: { sortOrder: 'asc' } },
});

export type PanelQuoteWithItems = Prisma.PanelQuoteGetPayload<{
  include: typeof quoteInclude;
}>;

const calculationForQuoteInclude =
  Prisma.validator<Prisma.CalculationSessionInclude>()({
    items: {
      orderBy: { sortOrder: 'asc' },
      include: {
        panelType: true,
        panelSize: true,
        supplier: true,
        qualityClass: true,
        color: true,
      },
    },
    panelQuote: { select: { id: true } },
    lead: {
      include: {
        client: {
          select: { id: true, name: true, email: true },
        },
      },
    },
  });

@Injectable()
export class QuotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
    private readonly dealFactory: DealFactory,
  ) {}

  async createFromCalculation(
    calculationId: string,
    dto: ConvertCalculationToQuoteDto,
    user: CurrentUser,
  ): Promise<PanelQuoteWithItems> {
    const calculation = await this.prisma.calculationSession.findFirst({
      where: { id: calculationId, deletedAt: null },
      include: calculationForQuoteInclude,
    });

    if (!calculation) {
      throw new BusinessException(
        HttpStatus.NOT_FOUND,
        'CALCULATION_NOT_FOUND',
        'Расчёт не найден',
      );
    }

    if (calculation.status !== CALCULATION_STATUS.FINALIZED) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        'CALCULATION_NOT_FINALIZED',
        'КП можно создать только из зафиксированного расчёта',
      );
    }

    const currentCommercial =
      await this.prisma.leadCommercialQualification.findUnique({
        where: { leadId: calculation.leadId },
        select: {
          supplierId: true,
          qualityClassId: true,
          status: true,
          confirmedAt: true,
        },
      });
    this.assertCalculationMatchesCurrentStage2(calculation, currentCommercial);

    if (calculation.panelQuote) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        'QUOTE_ALREADY_EXISTS',
        'Для этого расчёта КП уже создано',
      );
    }

    this.assertCalculationAccess(calculation.createdById, user);

    if (!calculation.totalAmount) {
      throw new BusinessException(
        HttpStatus.BAD_REQUEST,
        'CALCULATION_EMPTY',
        'Расчёт не содержит суммы',
      );
    }

    const validUntil =
      dto.validUntil ??
      new Date(Date.now() + DEFAULT_QUOTE_VALIDITY_DAYS * 24 * 60 * 60 * 1000);

    const deliveryCost =
      dto.deliveryCost === undefined
        ? null
        : new Prisma.Decimal(dto.deliveryCost).toDecimalPlaces(2);
    const totalAmount = deliveryCost
      ? calculation.totalAmount!.plus(deliveryCost).toDecimalPlaces(2)
      : calculation.totalAmount!;

    const quoteItems = calculation.items.map((item, index) => ({
      panelTypeCode: item.panelType.code,
      panelTypeName: item.panelType.displayNameRu,
      panelSizeName: item.panelSize.displayName,
      areaM2: item.panelSize.areaM2,
      thicknessMm: item.thicknessMm,
      supplierCode: item.supplier.code,
      supplierName: item.supplier.name,
      qualityClassCode: item.qualityClass.code,
      qualityClassName: item.qualityClass.nameRu,
      colorCode: item.color?.colorCode ?? null,
      colorName: item.color?.colorName ?? null,
      requiredAreaM2: item.requiredAreaM2,
      sheetsCount: item.sheetsCount,
      supplierPricePerM2: item.supplierPricePerM2,
      pricePerM2: item.clientPricePerM2,
      pricePerSheet: item.pricePerSheet,
      totalPrice: item.totalPrice,
      wastePercent: item.wastePercent,
      sortOrder: index,
    }));

    return this.prisma.$transaction(async (tx) => {
      const quote = await tx.panelQuote.create({
        data: {
          calculationId: calculation.id,
          leadId: calculation.leadId,
          managerId: user.id,
          status: QUOTE_STATUS.DRAFT,
          totalAmount,
          displayCurrency: calculation.displayCurrency,
          cnyUsdRate: calculation.cnyUsdRate,
          sellingCoefficient: calculation.sellingCoefficient,
          deliveryCost,
          clientComment: dto.clientComment,
          validUntil,
          items: { create: quoteItems },
        },
        include: quoteInclude,
      });

      await tx.activity.create({
        data: {
          type: ActivityType.NOTE,
          relatedType: 'Lead',
          relatedId: calculation.leadId,
          authorId: user.id,
          metadata: {
            action: 'quote_created',
            quoteId: quote.id,
            calculationId: calculation.id,
          },
        },
      });

      return quote;
    });
  }

  async findOne(id: string, user: CurrentUser): Promise<PanelQuoteWithItems> {
    const quote = await this.prisma.panelQuote.findUnique({
      where: { id },
      include: quoteInclude,
    });

    if (!quote) {
      throw new BusinessException(
        HttpStatus.NOT_FOUND,
        'QUOTE_NOT_FOUND',
        'Коммерческое предложение не найдено',
      );
    }

    this.assertQuoteReadAccess(quote.managerId, user);
    return quote;
  }

  async findAll(
    filter: FilterQuotesDto,
    user: CurrentUser,
  ): Promise<{
    items: PanelQuoteWithItems[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = filter.page ?? 1;
    const limit = filter.limit ?? 20;
    const where: Prisma.PanelQuoteWhereInput = {
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.leadId ? { leadId: filter.leadId } : {}),
    };

    if (!user.permissions.includes(QUOTE_PERMISSIONS.READ_ALL)) {
      where.managerId = user.id;
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.panelQuote.findMany({
        where,
        include: quoteInclude,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.panelQuote.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  async updateStatus(
    id: string,
    dto: UpdateQuoteStatusDto,
    user: CurrentUser,
  ): Promise<PanelQuoteWithItems> {
    const quote = await this.getQuoteOrThrow(id);
    this.assertQuoteWriteAccess(quote.managerId, user);
    this.assertStatusTransition(quote.status, dto.status);

    if (dto.status === QUOTE_STATUS.APPROVED) {
      this.assertQuoteApprovalAllowed(user);
    }

    if (dto.status === QUOTE_STATUS.REJECTED && !dto.rejectionReason?.trim()) {
      throw new BusinessException(
        HttpStatus.BAD_REQUEST,
        'REJECTION_REASON_REQUIRED',
        'Укажите причину отказа',
      );
    }

    if (dto.status === QUOTE_STATUS.SENT && quote.validUntil <= new Date()) {
      throw new BusinessException(
        HttpStatus.BAD_REQUEST,
        'QUOTE_EXPIRED',
        'Срок действия КП истёк, обновите validUntil',
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.panelQuote.update({
        where: { id },
        data: {
          status: dto.status,
          rejectionReason:
            dto.status === QUOTE_STATUS.REJECTED
              ? dto.rejectionReason?.trim()
              : quote.rejectionReason,
        },
        include: quoteInclude,
      });

      const activityAction =
        dto.status === QUOTE_STATUS.SENT
          ? 'quote_sent'
          : dto.status === QUOTE_STATUS.APPROVED
            ? 'quote_approved'
            : dto.status === QUOTE_STATUS.REJECTED
              ? 'quote_rejected'
              : 'quote_status_changed';

      await tx.activity.create({
        data: {
          type: ActivityType.NOTE,
          relatedType: 'Lead',
          relatedId: quote.leadId,
          authorId: user.id,
          metadata: {
            action: activityAction,
            quoteId: quote.id,
            rejectionReason: dto.rejectionReason,
          },
        },
      });

      if (dto.status === QUOTE_STATUS.APPROVED) {
        await tx.auditLog.create({
          data: {
            userId: user.id,
            action: 'QUOTE_APPROVED',
            entityType: 'PanelQuote',
            entityId: quote.id,
            oldValue: { status: quote.status },
            newValue: { status: QUOTE_STATUS.APPROVED },
          },
        });
      }

      return result;
    });

    await this.notifyOnStatusChange(updated, dto.status);

    return updated;
  }

  async convertToDeal(
    id: string,
    user: CurrentUser,
  ): Promise<{ quote: PanelQuoteWithItems; dealId: string }> {
    const quote = await this.getQuoteOrThrow(id);
    this.assertQuoteWriteAccess(quote.managerId, user);

    if (quote.status !== QUOTE_STATUS.APPROVED) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        'QUOTE_NOT_APPROVED',
        'Сделку можно создать только из одобренного КП',
      );
    }

    if (quote.dealId) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        'QUOTE_ALREADY_CONVERTED',
        'КП уже конвертировано в сделку',
      );
    }

    const lead = await this.prisma.lead.findFirst({
      where: { id: quote.leadId, deletedAt: null },
    });

    if (!lead?.clientId) {
      throw new BusinessException(
        HttpStatus.BAD_REQUEST,
        'LEAD_CLIENT_REQUIRED',
        'Для конвертации у лида должен быть указан клиент',
      );
    }

    if (lead.dealId) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        'LEAD_ALREADY_CONVERTED',
        'У лида уже есть связанная сделка',
      );
    }

    if (lead.status !== LeadStatus.QUALIFIED) {
      throw new BusinessException(
        HttpStatus.BAD_REQUEST,
        'LEAD_NOT_QUALIFIED',
        'Сделку можно создать только из лида со статусом QUALIFIED',
      );
    }

    const serviceProduct = await this.prisma.product.findUnique({
      where: { sku: CALCULATOR_PRODUCT_SKU },
      select: { id: true },
    });

    if (!serviceProduct) {
      throw new BusinessException(
        HttpStatus.INTERNAL_SERVER_ERROR,
        'CALCULATOR_PRODUCT_MISSING',
        'Служебный продукт калькулятора не найден. Выполните seed.',
      );
    }

    const supplierCode = quote.items[0]?.supplierCode;
    if (!supplierCode) {
      throw new BusinessException(
        HttpStatus.BAD_REQUEST,
        'QUOTE_SUPPLIER_REQUIRED',
        'В КП не указан поставщик',
      );
    }

    const supplier = await this.prisma.supplier.findUnique({
      where: { code: supplierCode },
      select: { id: true },
    });

    if (!supplier) {
      throw new BusinessException(
        HttpStatus.NOT_FOUND,
        'SUPPLIER_NOT_FOUND',
        'Поставщик из КП не найден',
      );
    }

    const initialTaskDueDate = new Date(Date.now() + 2 * 60 * 60 * 1000);

    const result = await this.prisma.$transaction(async (tx) => {
      const deal = await this.dealFactory.createFromQuote(tx, {
        quote,
        clientId: lead.clientId!,
        projectObjectId: lead.projectObjectId,
        serviceProductId: serviceProduct.id,
        userId: user.id,
        supplierId: supplier.id,
      });

      const claimedLead = await tx.lead.updateMany({
        where: {
          id: quote.leadId,
          deletedAt: null,
          dealId: null,
          status: LeadStatus.QUALIFIED,
        },
        data: {
          dealId: deal.id,
          status: LeadStatus.CONVERTED,
        },
      });

      if (claimedLead.count !== 1) {
        throw new BusinessException(
          HttpStatus.CONFLICT,
          'LEAD_ALREADY_CONVERTED',
          'У лида уже есть связанная сделка',
        );
      }

      const claimedQuote = await tx.panelQuote.updateMany({
        where: {
          id: quote.id,
          dealId: null,
          status: QUOTE_STATUS.APPROVED,
        },
        data: {
          status: QUOTE_STATUS.CONVERTED,
          dealId: deal.id,
        },
      });

      if (claimedQuote.count !== 1) {
        throw new BusinessException(
          HttpStatus.CONFLICT,
          'QUOTE_ALREADY_CONVERTED',
          'КП уже конвертировано в сделку',
        );
      }

      const updatedQuote = await tx.panelQuote.findUniqueOrThrow({
        where: { id: quote.id },
        include: quoteInclude,
      });

      await tx.calculationSession.update({
        where: { id: quote.calculationId },
        data: { dealId: deal.id },
      });

      await tx.activity.create({
        data: {
          type: ActivityType.NOTE,
          relatedType: 'Lead',
          relatedId: quote.leadId,
          authorId: user.id,
          metadata: {
            action: 'quote_converted_to_deal',
            quoteId: quote.id,
            dealId: deal.id,
          },
        },
      });

      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: 'QUOTE_CONVERTED',
          entityType: 'PanelQuote',
          entityId: quote.id,
          oldValue: { status: quote.status, dealId: null },
          newValue: {
            status: QUOTE_STATUS.CONVERTED,
            dealId: deal.id,
          },
        },
      });

      await tx.task.create({
        data: {
          title: `Первый контакт по сделке: ${deal.title}`,
          type: TaskType.FIRST_CONTACT,
          priority: TaskPriority.HIGH,
          dueDate: initialTaskDueDate,
          originalDueDate: initialTaskDueDate,
          assigneeId: quote.managerId,
          createdById: user.id,
          relatedType: 'Deal',
          relatedId: deal.id,
        },
      });

      return { quote: updatedQuote, dealId: deal.id };
    });

    return result;
  }

  private async getQuoteOrThrow(id: string): Promise<PanelQuoteWithItems> {
    const quote = await this.prisma.panelQuote.findUnique({
      where: { id },
      include: quoteInclude,
    });

    if (!quote) {
      throw new BusinessException(
        HttpStatus.NOT_FOUND,
        'QUOTE_NOT_FOUND',
        'Коммерческое предложение не найдено',
      );
    }

    return quote;
  }

  private assertCalculationMatchesCurrentStage2(
    calculation: {
      commercialSupplierId: string | null;
      commercialQualityClassId: string | null;
      commercialConfirmedAt: Date | null;
    },
    current: {
      supplierId: string;
      qualityClassId: string;
      status: CommercialQualificationStatus;
      confirmedAt: Date;
    } | null,
  ): void {
    if (
      !calculation.commercialConfirmedAt ||
      !calculation.commercialSupplierId ||
      !calculation.commercialQualityClassId
    ) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        'CALCULATION_NOT_COMMERCIALLY_QUALIFIED',
        'КП можно создать только из расчёта после коммерческой квалификации руководителя',
      );
    }

    const snapshotTime = calculation.commercialConfirmedAt.getTime();
    const currentTime = current?.confirmedAt.getTime();
    const matchesCurrentDecision =
      current !== null &&
      current.status === CommercialQualificationStatus.CONFIRMED &&
      calculation.commercialSupplierId === current.supplierId &&
      calculation.commercialQualityClassId === current.qualityClassId &&
      Number.isFinite(snapshotTime) &&
      snapshotTime === currentTime;

    if (!matchesCurrentDecision) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        'COMMERCIAL_QUALIFICATION_CHANGED',
        'Расчёт основан на предыдущей коммерческой квалификации. Создайте новый расчёт',
      );
    }
  }

  private assertCalculationAccess(
    createdById: string,
    user: CurrentUser,
  ): void {
    if (
      user.permissions.includes(CALCULATION_PERMISSIONS.READ_ALL) ||
      createdById === user.id
    ) {
      return;
    }

    throw new BusinessException(
      HttpStatus.FORBIDDEN,
      'FORBIDDEN',
      'У вас нет доступа к этому расчёту',
    );
  }

  private assertQuoteReadAccess(
    managerId: string,
    user: CurrentUser,
  ): void {
    if (
      user.permissions.includes(QUOTE_PERMISSIONS.READ_ALL) ||
      managerId === user.id
    ) {
      return;
    }

    throw new BusinessException(
      HttpStatus.FORBIDDEN,
      'FORBIDDEN',
      'У вас нет доступа к этому КП',
    );
  }

  private assertQuoteWriteAccess(
    managerId: string,
    user: CurrentUser,
  ): void {
    if (
      user.permissions.includes(QUOTE_PERMISSIONS.READ_ALL) ||
      managerId === user.id
    ) {
      return;
    }

    throw new BusinessException(
      HttpStatus.FORBIDDEN,
      'FORBIDDEN',
      'У вас нет доступа к этому КП',
    );
  }

  // Ownership / quotes:read_all is not an approval permission.
  private assertQuoteApprovalAllowed(user: CurrentUser): void {
    if (user.permissions.includes(QUOTE_PERMISSIONS.APPROVE)) {
      return;
    }

    throw new BusinessException(
      HttpStatus.FORBIDDEN,
      'QUOTE_APPROVAL_FORBIDDEN',
      'Недостаточно прав для согласования КП',
    );
  }

  private assertStatusTransition(current: string, next: string): void {
    const allowed = QUOTE_STATUS_TRANSITIONS[current] ?? [];

    if (!allowed.includes(next as (typeof allowed)[number])) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        'INVALID_QUOTE_TRANSITION',
        `Переход статуса ${current} → ${next} запрещён`,
      );
    }
  }

  private async notifyOnStatusChange(
    quote: PanelQuoteWithItems,
    status: string,
  ): Promise<void> {
    if (status === QUOTE_STATUS.SENT) {
      const lead = await this.prisma.lead.findUnique({
        where: { id: quote.leadId },
        include: { client: { select: { email: true, name: true } } },
      });

      if (lead?.client?.email) {
        this.notificationService.sendEmail({
          to: lead.client.email,
          subject: 'Коммерческое предложение HPL',
          text: `Здравствуйте! Вам направлено коммерческое предложение на сумму ${quote.totalAmount} ${quote.displayCurrency}.`,
        });
      }

      await this.prisma.notification.create({
        data: {
          userId: quote.managerId,
          title: 'КП отправлено клиенту',
          message: `КП #${quote.id.slice(0, 8)} отправлено`,
          type: 'quote_sent',
          relatedType: 'Lead',
          relatedId: quote.leadId,
        },
      });
      return;
    }

    if (status === QUOTE_STATUS.APPROVED) {
      await this.prisma.notification.create({
        data: {
          userId: quote.managerId,
          title: 'Клиент одобрил КП',
          message: `КП #${quote.id.slice(0, 8)} одобрено клиентом`,
          type: 'quote_approved',
          relatedType: 'Lead',
          relatedId: quote.leadId,
        },
      });
    }
  }
}
