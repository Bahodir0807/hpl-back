import {
  BadRequestException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  ActivityType,
  FulfillmentSource,
  LeadStatus,
  OrderItemSource,
  OrderStatus,
  Prisma,
  TaskPriority,
  TaskType,
  CommercialQualificationStatus,
  DealStage,
} from '@prisma/client';
import {
  CALCULATION_PERMISSIONS,
  CALCULATION_REQUEST_STATUS,
  CALCULATION_STATUS,
  QUOTE_COMMERCIAL_CURRENCIES,
} from '../calculations/calculation.constants';
import { BusinessException } from '../common/exceptions/business.exception';
import type { CurrentUser } from '../common/interfaces/current-user.interface';
import { DealFactory } from '../modules/deals/services/deal-factory.service';
import { CALCULATOR_PRODUCT_SKU } from './calculator-product.constants';
import { NotificationService } from '../modules/notifications/notification.service';
import { PrismaService } from '../modules/prisma/prisma.service';
import { InventoryService } from '../modules/inventory/inventory.service';
import { randomBytes } from 'node:crypto';
import {
  applicationForPanelTypeCode,
  HPL_CUSTOM_PANEL_TYPE_CODE,
} from '../panels/hpl-catalog';
import { validateHplThickness } from '../panels/hpl-thickness';
import { PanelPriceCalculator } from '../panels/services/panel-price-calculator.service';
import { CurrencyRateService } from '../panels/services/currency-rate.service';
import { ConvertCalculationToQuoteDto } from './dto/convert-calculation-to-quote.dto';
import { FilterQuotesDto } from './dto/filter-quotes.dto';
import { QuoteClientFacingTermsDto } from './dto/quote-client-facing-terms.dto';
import { UpdateQuoteCommercialTermsDto } from './dto/update-quote-commercial-terms.dto';
import { UpdateQuoteStatusDto } from './dto/update-quote-status.dto';
import {
  FinalizeQuoteDto,
  PreviewQuotePricingDto,
  UpdateQuoteApprovedPricingDto,
} from './dto/update-quote-approved-pricing.dto';
import {
  quoteCustomerDocumentIssues,
  QUOTE_COMMERCIAL_TERMS_INCOMPLETE,
} from './quote-document.model';
import {
  QuoteStockAvailability,
  QuoteStockService,
} from './quote-stock.service';
import { QuoteDocumentService } from './quote-document.service';
import {
  DEFAULT_QUOTE_VALIDITY_DAYS,
  QUOTE_PERMISSIONS,
  QUOTE_PRICE_NOT_APPROVED,
  QUOTE_STATUS,
  QUOTE_STATUS_TRANSITIONS,
  canWriteQuoteClientFacingTerms,
  canMutateQuoteCommercialNote,
} from './quote.constants';

const quoteInclude = Prisma.validator<Prisma.PanelQuoteInclude>()({
  items: {
    orderBy: [{ calculationGroupSortOrder: 'asc' }, { sortOrder: 'asc' }],
  },
  pdfFile: {
    select: { id: true, storageKey: true, mimeType: true, originalName: true },
  },
  previousVersion: { select: { id: true, versionNumber: true } },
  nextVersion: { select: { id: true, versionNumber: true } },
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
    request: {
      include: {
        quotes: { select: { id: true } },
        calculations: {
          where: { deletedAt: null },
          orderBy: { sortOrder: 'asc' },
          include: {
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
          },
        },
      },
    },
    lead: {
      include: {
        client: {
          select: { id: true, name: true, email: true },
        },
      },
    },
  });

type QuoteSnapshotItem = {
  panelTypeId: string;
  panelSizeId: string;
  qualityClassId: string;
  panelType: { code: string; displayNameRu: string };
  panelSize: {
    displayName: string;
    areaM2: Prisma.Decimal;
    widthMm: number;
    heightMm: number;
  };
  supplier: { id: string; code: string; name: string } | null;
  qualityClass: { code: string; nameRu: string };
  color: {
    colorCode: string;
    colorName: string;
    supplierId: string;
  } | null;
  colorCode?: string | null;
  colorName?: string | null;
  thicknessMm: Prisma.Decimal;
  requiredAreaM2: Prisma.Decimal;
  sheetsCount: number;
  supplierPricePerM2: Prisma.Decimal | null;
  clientPricePerM2: Prisma.Decimal | null;
  pricePerSheet: Prisma.Decimal | null;
  totalPrice: Prisma.Decimal | null;
  wastePercent: Prisma.Decimal;
  coating?: string | null;
  texture?: string | null;
  note?: string | null;
  customTypeDescription?: string | null;
  customWidthMm?: number | null;
  customHeightMm?: number | null;
};

type QuoteSnapshotGroup = {
  id: string;
  title: string | null;
  notes: string | null;
  sortOrder: number;
  totalAmount: Prisma.Decimal | null;
  cnyUsdRate: Prisma.Decimal | null;
  items: QuoteSnapshotItem[];
};

@Injectable()
export class QuotesService {
  private readonly logger = new Logger(QuotesService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
    private readonly dealFactory: DealFactory,
    private readonly quoteStockService: QuoteStockService,
    private readonly inventoryService: InventoryService,
    private readonly quoteDocumentService: QuoteDocumentService,
    private readonly panelPriceCalculator: PanelPriceCalculator,
    private readonly currencyRateService: CurrencyRateService,
  ) {}

  async createFromCalculation(
    calculationId: string,
    dto: ConvertCalculationToQuoteDto,
    user: CurrentUser,
  ): Promise<PanelQuoteWithItems> {
    this.assertQuoteApprovalAllowed(user);
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
    if (calculation.commercialConfirmedAt || !calculation.requestId) {
      this.assertCalculationMatchesCurrentStage2(
        calculation,
        currentCommercial,
      );
    }

    if (calculation.panelQuote) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        'QUOTE_ALREADY_EXISTS',
        'Для этого расчёта КП уже создано',
      );
    }

    if (calculation.request?.quotes.length) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        'QUOTE_ALREADY_EXISTS',
        'Для этого запроса КП уже создано',
      );
    }

    this.assertCalculationAccess(calculation.createdById, user);
    this.assertQuoteClientFacingTermsAccess(dto, user);
    this.assertQuoteCommercialNoteAccess(dto, user);
    this.assertDayRange(
      dto.productionDaysFrom,
      dto.productionDaysTo,
      'INVALID_PRODUCTION_PERIOD',
      'Срок производства: укажите целые дни > 0, от ≤ до',
    );
    this.assertDayRange(
      dto.deliveryDaysFrom,
      dto.deliveryDaysTo,
      'INVALID_DELIVERY_PERIOD',
      'Срок доставки: укажите целые дни > 0, от ≤ до',
    );

    let groups: QuoteSnapshotGroup[] = (
      calculation.request?.calculations?.length
        ? calculation.request.calculations
        : [calculation]
    ) as QuoteSnapshotGroup[];
    let quoteCnyUsdRate: Prisma.Decimal | null = null;
    let referencePricingComplete = true;

    if (calculation.requestId) {
      const hasMissingItemSupplier = groups.some((group) =>
        group.items.some((item) => !item.supplier?.id),
      );
      if (hasMissingItemSupplier) {
        throw new BusinessException(
          HttpStatus.BAD_REQUEST,
          'QUOTE_SUPPLIER_REQUIRED',
          'Перед созданием КП у каждой позиции должен быть выбран поставщик',
        );
      }
      const priced = await this.priceCalculationRequestGroups(groups);
      groups = priced.groups;
      quoteCnyUsdRate = null;
      referencePricingComplete = priced.referencePricingComplete;
    }

    const totalFromGroups = groups.reduce(
      (sum, group) => sum.plus(group.totalAmount ?? 0),
      new Prisma.Decimal(0),
    );

    if (
      !calculation.requestId &&
      totalFromGroups.lte(0) &&
      !calculation.totalAmount
    ) {
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
    const snapshotTotal =
      calculation.requestId && !referencePricingComplete
        ? new Prisma.Decimal(0)
        : totalFromGroups.gt(0)
          ? totalFromGroups
          : calculation.totalAmount!;
    const totalAmount = deliveryCost
      ? snapshotTotal.plus(deliveryCost).toDecimalPlaces(2)
      : snapshotTotal.toDecimalPlaces(2);

    const quoteItems = this.snapshotQuoteItems(
      groups,
      calculation.displayCurrency,
    );

    return this.prisma.$transaction(async (tx) => {
      const quote = await tx.panelQuote.create({
        data: {
          calculationId: calculation.id,
          requestId: calculation.requestId,
          leadId: calculation.leadId,
          clientId: calculation.lead?.client?.id ?? calculation.clientId,
          managerId: calculation.createdById,
          dealId:
            calculation.request?.dealId ??
            calculation.dealId ??
            calculation.lead.dealId,
          status: QUOTE_STATUS.DRAFT,
          totalAmount,
          displayCurrency: calculation.displayCurrency,
          cnyUsdRate: quoteCnyUsdRate,
          sellingCoefficient: calculation.sellingCoefficient,
          deliveryCost,
          clientComment: dto.clientComment,
          commercialNote: dto.commercialNote?.trim() || null,
          internalCommercialNote:
            dto.internalCommercialNote?.trim() ||
            calculation.request?.notes?.trim() ||
            null,
          productionTerms: dto.productionTerms?.trim() || null,
          deliveryTerms: dto.deliveryTerms?.trim() || null,
          productionDaysFrom: dto.productionTerms?.trim()
            ? null
            : (dto.productionDaysFrom ?? null),
          productionDaysTo: dto.productionTerms?.trim()
            ? null
            : (dto.productionDaysTo ?? null),
          deliveryDaysFrom: dto.deliveryTerms?.trim()
            ? null
            : (dto.deliveryDaysFrom ?? null),
          deliveryDaysTo: dto.deliveryTerms?.trim()
            ? null
            : (dto.deliveryDaysTo ?? null),
          documentDate: new Date(),
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
            requestId: calculation.requestId,
          },
        },
      });

      if (calculation.requestId) {
        await tx.calculationRequest.updateMany({
          where: {
            id: calculation.requestId,
            deletedAt: null,
            status: {
              in: [
                CALCULATION_REQUEST_STATUS.SUBMITTED,
                CALCULATION_REQUEST_STATUS.PROCESSING,
              ],
            },
          },
          data: { status: CALCULATION_REQUEST_STATUS.PROCESSING },
        });
      }

      return quote;
    });
  }

  async createFromRequest(
    requestId: string,
    dto: ConvertCalculationToQuoteDto,
    user: CurrentUser,
  ): Promise<PanelQuoteWithItems> {
    this.assertQuoteApprovalAllowed(user);
    const request = await this.prisma.calculationRequest.findFirst({
      where: { id: requestId, deletedAt: null },
      include: {
        calculations: {
          where: { deletedAt: null },
          orderBy: { sortOrder: 'asc' },
          include: {
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
          },
        },
        quotes: { select: { id: true } },
        lead: {
          include: {
            client: { select: { id: true, name: true, email: true } },
          },
        },
      },
    });

    if (!request) {
      throw new BusinessException(
        HttpStatus.NOT_FOUND,
        'CALCULATION_REQUEST_NOT_FOUND',
        'Запрос расчёта не найден',
      );
    }

    if (request.status === CALCULATION_REQUEST_STATUS.DRAFT) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        'CALCULATION_REQUEST_NOT_SUBMITTED',
        'КП создаётся после отправки запроса руководителю',
      );
    }

    if (request.quotes.length > 0) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        'QUOTE_ALREADY_EXISTS',
        'Для этого запроса КП уже создано',
      );
    }

    const primary = request.calculations[0];
    if (!primary) {
      throw new BusinessException(
        HttpStatus.BAD_REQUEST,
        'CALCULATION_REQUEST_EMPTY',
        'Запрос должен содержать хотя бы один расчёт',
      );
    }

    try {
      return await this.createFromCalculation(primary.id, dto, user);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new BusinessException(
          HttpStatus.CONFLICT,
          'QUOTE_ALREADY_EXISTS',
          'A Quote for this calculation request already exists',
        );
      }
      throw error;
    }
  }

  async findOne(
    id: string,
    user: CurrentUser,
  ): Promise<
    PanelQuoteWithItems & {
      documentAvailability: 'AVAILABLE' | 'LEGACY_MISSING' | 'NOT_FINALIZED';
    }
  > {
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
    return {
      ...quote,
      documentAvailability:
        quote.pdfFileId && quote.finalizedAt
          ? 'AVAILABLE'
          : quote.status === QUOTE_STATUS.CONVERTED
            ? 'LEGACY_MISSING'
            : 'NOT_FINALIZED',
    };
  }

  assertCanDownloadCustomerDocument(
    quote: Pick<PanelQuoteWithItems, 'pdfFileId' | 'finalizedAt'>,
    user: CurrentUser,
  ): void {
    if (quote.pdfFileId && quote.finalizedAt) {
      return;
    }
    if (user.permissions.includes(QUOTE_PERMISSIONS.APPROVE)) {
      return;
    }
    throw new BusinessException(
      HttpStatus.FORBIDDEN,
      'QUOTE_PDF_NOT_FINALIZED',
      'Финальный PDF КП формирует руководитель. Дождитесь готового документа',
    );
  }

  async getStockAvailability(
    id: string,
    user: CurrentUser,
  ): Promise<
    | ({ stockOnly: true } & QuoteStockAvailability)
    | { stockOnly: false; status: 'NOT_REQUIRED'; lines: [] }
  > {
    const quote = await this.findOne(id, user);
    const lead = await this.prisma.lead.findUnique({
      where: { id: quote.leadId },
      select: { qualification: { select: { stockOnly: true } } },
    });

    if (lead?.qualification?.stockOnly !== true) {
      return { stockOnly: false, status: 'NOT_REQUIRED', lines: [] };
    }

    return {
      stockOnly: true,
      ...(await this.quoteStockService.check(quote.items)),
    };
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
      ...(filter.clientId ? { clientId: filter.clientId } : {}),
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

    if (quote.status === dto.status) {
      return quote;
    }

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

    if (
      (dto.status === QUOTE_STATUS.SENT ||
        dto.status === QUOTE_STATUS.APPROVED) &&
      (!quote.finalizedAt || !quote.pdfFileId)
    ) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        'QUOTE_NOT_FINALIZED',
        'КП можно отправить или согласовать только после финализации и сохранения PDF',
      );
    }

    const transition = await this.prisma.$transaction(async (tx) => {
      if (dto.status === QUOTE_STATUS.APPROVED) {
        await tx.lead.update({
          where: { id: quote.leadId },
          data: { updatedAt: new Date() },
        });
      }

      const claimed = await tx.panelQuote.updateMany({
        where: { id, status: quote.status },
        data: {
          status: dto.status,
          rejectionReason:
            dto.status === QUOTE_STATUS.REJECTED
              ? dto.rejectionReason?.trim()
              : quote.rejectionReason,
        },
      });

      if (claimed.count === 0) {
        const latest = await tx.panelQuote.findUnique({
          where: { id },
          include: quoteInclude,
        });
        if (latest?.status === dto.status) {
          return { quote: latest, changed: false };
        }
        throw new BusinessException(
          HttpStatus.CONFLICT,
          'QUOTE_STATUS_CHANGED_CONCURRENTLY',
          'Quote status changed concurrently',
        );
      }

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

      return {
        quote: await tx.panelQuote.findUniqueOrThrow({
          where: { id },
          include: quoteInclude,
        }),
        changed: true,
      };
    });

    if (transition.changed) {
      await this.safePostCommit('quote status notification', () =>
        this.notifyOnStatusChange(transition.quote, dto.status),
      );
    }

    return transition.quote;
  }

  async updateCommercialTerms(
    id: string,
    dto: UpdateQuoteCommercialTermsDto,
    user: CurrentUser,
  ): Promise<PanelQuoteWithItems> {
    const quote = await this.getQuoteOrThrow(id);
    this.assertQuoteWriteAccess(quote.managerId, user);
    this.assertQuoteClientFacingTermsAccess(dto, user);
    this.assertQuoteCommercialNoteAccess(dto, user);
    this.assertDayRange(
      dto.productionDaysFrom,
      dto.productionDaysTo,
      'INVALID_PRODUCTION_PERIOD',
      'Срок производства: укажите целые дни > 0, от ≤ до',
    );
    this.assertDayRange(
      dto.deliveryDaysFrom,
      dto.deliveryDaysTo,
      'INVALID_DELIVERY_PERIOD',
      'Срок доставки: укажите целые дни > 0, от ≤ до',
    );

    if (quote.finalizedAt) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        'QUOTE_TERMS_LOCKED',
        'Коммерческие условия КП нельзя менять после финализации',
      );
    }

    if (quote.status !== QUOTE_STATUS.DRAFT) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        'QUOTE_TERMS_LOCKED',
        'Коммерческие условия КП нельзя менять после отправки клиенту',
      );
    }

    const data: Prisma.PanelQuoteUpdateInput = {};
    if (dto.productionDaysFrom !== undefined) {
      data.productionDaysFrom = dto.productionDaysFrom;
    }
    if (dto.productionDaysTo !== undefined) {
      data.productionDaysTo = dto.productionDaysTo;
    }
    if (dto.deliveryDaysFrom !== undefined) {
      data.deliveryDaysFrom = dto.deliveryDaysFrom;
    }
    if (dto.deliveryDaysTo !== undefined) {
      data.deliveryDaysTo = dto.deliveryDaysTo;
    }
    if (dto.validUntil !== undefined) {
      data.validUntil = dto.validUntil;
    }
    if (dto.commercialNote !== undefined) {
      data.commercialNote = dto.commercialNote.trim() || null;
    }
    if (dto.internalCommercialNote !== undefined) {
      data.internalCommercialNote = dto.internalCommercialNote.trim() || null;
    }
    if (dto.productionTerms !== undefined) {
      data.productionTerms = dto.productionTerms.trim() || null;
      data.productionDaysFrom = null;
      data.productionDaysTo = null;
    }
    if (dto.deliveryTerms !== undefined) {
      data.deliveryTerms = dto.deliveryTerms.trim() || null;
      data.deliveryDaysFrom = null;
      data.deliveryDaysTo = null;
    }

    if (Object.keys(data).length === 0) {
      return quote;
    }

    return this.prisma.panelQuote.update({
      where: { id },
      data,
      include: quoteInclude,
    });
  }

  async updateApprovedPricing(
    id: string,
    dto: UpdateQuoteApprovedPricingDto,
    user: CurrentUser,
  ): Promise<PanelQuoteWithItems> {
    this.assertQuoteApprovalAllowed(user);
    const quote = await this.getQuoteOrThrow(id);
    this.assertQuoteWriteAccess(quote.managerId, user);
    this.assertQuoteMutableForLeader(quote);

    return this.applyApprovedPrices(quote, dto.items, user.id);
  }

  async previewPricing(
    id: string,
    dto: PreviewQuotePricingDto,
    user: CurrentUser,
  ) {
    this.assertQuoteApprovalAllowed(user);
    const quote = await this.getQuoteOrThrow(id);
    this.assertQuoteWriteAccess(quote.managerId, user);
    this.assertQuoteMutableForLeader(quote);

    const calculated = await this.calculateQuotePurchasePrices(
      quote,
      dto.items,
      quote.cnyUsdRate ??
        (await this.currencyRateService.getActiveCnyUsdRate()),
    );
    return {
      cnyUsdRate: calculated.cnyUsdRate,
      sellingCoefficient: calculated.sellingCoefficient,
      currencyCode: 'USD' as const,
      items: calculated.items.map(({ target, price }) => ({
        id: target.id,
        calculationId: target.calculationId,
        purchasePricePerM2Cny: price.supplierPricePerM2,
        pricePerM2: price.clientPricePerM2,
        pricePerSheet: price.pricePerSheet,
        totalPrice: price.total,
      })),
    };
  }

  async finalize(
    id: string,
    dto: FinalizeQuoteDto,
    user: CurrentUser,
  ): Promise<PanelQuoteWithItems> {
    this.assertQuoteApprovalAllowed(user);
    const quote = await this.getQuoteOrThrow(id);
    this.assertQuoteWriteAccess(quote.managerId, user);
    this.assertQuoteMutableForLeader(quote);
    this.assertQuoteClientFacingTermsAccess(dto, user);
    this.assertQuoteCommercialNoteAccess(dto, user);
    this.assertDayRange(
      dto.productionDaysFrom,
      dto.productionDaysTo,
      'INVALID_PRODUCTION_PERIOD',
      'Срок производства: укажите целые дни > 0, от ≤ до',
    );
    this.assertDayRange(
      dto.deliveryDaysFrom,
      dto.deliveryDaysTo,
      'INVALID_DELIVERY_PERIOD',
      'Срок доставки: укажите целые дни > 0, от ≤ до',
    );

    if (dto.productionDaysFrom !== undefined) {
      await this.updateCommercialTerms(id, dto, user);
    } else if (
      dto.productionDaysTo !== undefined ||
      dto.deliveryDaysFrom !== undefined ||
      dto.deliveryDaysTo !== undefined ||
      dto.validUntil !== undefined ||
      dto.commercialNote !== undefined ||
      dto.internalCommercialNote !== undefined ||
      dto.productionTerms !== undefined ||
      dto.deliveryTerms !== undefined
    ) {
      await this.updateCommercialTerms(id, dto, user);
    }

    const ready = await this.getQuoteOrThrow(id);
    const issues = quoteCustomerDocumentIssues(ready);
    if (issues.length > 0) {
      throw new BusinessException(
        HttpStatus.BAD_REQUEST,
        QUOTE_COMMERCIAL_TERMS_INCOMPLETE,
        issues.join('. '),
      );
    }

    this.assertExplicitApprovedPricing(ready.items);

    const attempt: {
      persisted: { fileId: string; created: boolean } | null;
    } = { persisted: null };
    let claimed: PanelQuoteWithItems | null;
    try {
      claimed = await this.prisma.$transaction(
        async (tx) => {
          // Serialize finalization across all backend instances. A plain CAS on
          // PanelQuote is too late because the PDF/File side effect happens first.
          await tx.$queryRaw<Array<{ locked: boolean }>>`
          SELECT pg_advisory_xact_lock(hashtext(${`quote-finalize:${id}`})) IS NULL AS "locked"
        `;

          const locked = await tx.panelQuote.findUnique({
            where: { id },
            include: quoteInclude,
          });
          if (!locked) {
            throw new BusinessException(
              HttpStatus.NOT_FOUND,
              'QUOTE_NOT_FOUND',
              'Коммерческое предложение не найдено',
            );
          }
          if (locked.finalizedAt) {
            return locked;
          }

          this.assertQuoteMutableForLeader(locked);
          const lockedIssues = quoteCustomerDocumentIssues(locked);
          if (lockedIssues.length > 0) {
            throw new BusinessException(
              HttpStatus.BAD_REQUEST,
              QUOTE_COMMERCIAL_TERMS_INCOMPLETE,
              lockedIssues.join('. '),
            );
          }
          this.assertExplicitApprovedPricing(locked.items);

          const persisted = await this.quoteDocumentService.persistFinalPdf(
            id,
            user.id,
          );
          attempt.persisted = persisted;
          const result = await tx.panelQuote.updateMany({
            where: {
              id,
              status: QUOTE_STATUS.DRAFT,
              finalizedAt: null,
            },
            data: {
              pdfFileId: persisted.fileId,
              finalizedAt: new Date(),
              approverId: user.id,
              displayCurrency: locked.displayCurrency,
            },
          });

          if (result.count !== 1) {
            return null;
          }

          if (locked.requestId) {
            await tx.calculationRequest.updateMany({
              where: { id: locked.requestId, deletedAt: null },
              data: {
                status: CALCULATION_REQUEST_STATUS.QUOTED,
                quotedAt: new Date(),
              },
            });
          }

          return tx.panelQuote.findUniqueOrThrow({
            where: { id },
            include: quoteInclude,
          });
        },
        { timeout: 30_000 },
      );
    } catch (error) {
      if (attempt.persisted?.created) {
        await this.quoteDocumentService.cleanupUncommittedFinalPdf(
          attempt.persisted.fileId,
        );
      }
      throw error;
    }

    if (!claimed) {
      if (attempt.persisted?.created) {
        await this.quoteDocumentService.cleanupUncommittedFinalPdf(
          attempt.persisted.fileId,
        );
      }
      const latest = await this.getQuoteOrThrow(id);
      if (latest.finalizedAt) {
        return latest;
      }
      throw new BusinessException(
        HttpStatus.CONFLICT,
        'QUOTE_STATUS_CHANGED_CONCURRENTLY',
        'КП уже финализировано или изменено параллельно',
      );
    }

    await this.safePostCommit('quote finalized notification', () =>
      this.prisma.notification.create({
        data: {
          userId: claimed.managerId,
          title: 'Quote finalized',
          message: `Quote #${claimed.id.slice(0, 8)} v${claimed.versionNumber} finalized`,
          type: 'quote_finalized',
          relatedType: 'Lead',
          relatedId: claimed.leadId,
        },
      }),
    );
    return claimed;
  }

  async createNextVersion(
    id: string,
    user: CurrentUser,
  ): Promise<PanelQuoteWithItems> {
    this.assertQuoteApprovalAllowed(user);
    const source = await this.getQuoteOrThrow(id);
    this.assertQuoteWriteAccess(source.managerId, user);
    if (!source.finalizedAt || !source.pdfFileId) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        'QUOTE_VERSION_SOURCE_NOT_FINALIZED',
        'A new Quote version can be created only from a finalized Quote',
      );
    }

    let nextVersionItems: Prisma.PanelQuoteItemCreateWithoutQuoteInput[] =
      source.items.map((item) => ({
        calculationId: item.calculationId,
        calculationGroupTitle: item.calculationGroupTitle,
        calculationGroupSortOrder: item.calculationGroupSortOrder,
        panelTypeCode: item.panelTypeCode,
        panelTypeName: item.panelTypeName,
        panelSizeName: item.panelSizeName,
        areaM2: item.areaM2,
        thicknessMm: item.thicknessMm,
        supplierCode: item.supplierCode,
        supplierName: item.supplierName,
        qualityClassCode: item.qualityClassCode,
        qualityClassName: item.qualityClassName,
        colorCode: item.colorCode,
        colorName: item.colorName,
        coating: item.coating,
        texture: item.texture,
        note: item.note,
        customTypeDescription: item.customTypeDescription,
        customWidthMm: item.customWidthMm,
        customHeightMm: item.customHeightMm,
        requiredAreaM2: item.requiredAreaM2,
        sheetsCount: item.sheetsCount,
        supplierPricePerM2: item.supplierPricePerM2,
        pricePerM2: null,
        currencyCode: null,
        priceApprovedAt: null,
        priceApprovedById: null,
        pricePerSheet: null,
        totalPrice: null,
        wastePercent: item.wastePercent,
        sortOrder: item.sortOrder,
      }));

    if (source.requestId) {
      const request = await this.prisma.calculationRequest.findUnique({
        where: { id: source.requestId },
        include: {
          calculations: {
            where: { deletedAt: null },
            orderBy: { sortOrder: 'asc' },
            include: {
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
            },
          },
        },
      });
      const supplierCode = source.items[0]?.supplierCode;
      const supplier = supplierCode
        ? await this.prisma.supplier.findUnique({
            where: { code: supplierCode },
          })
        : null;
      if (!request?.calculations.length || !supplier) {
        throw new BusinessException(
          HttpStatus.CONFLICT,
          'QUOTE_VERSION_REQUEST_INCOMPLETE',
          'The corrected calculation request or Quote supplier is missing',
        );
      }
      const corrected = await this.priceCalculationRequestGroups(
        request.calculations as QuoteSnapshotGroup[],
        supplier.id,
      );
      nextVersionItems = this.snapshotQuoteItems(
        corrected.groups,
        source.displayCurrency,
      );
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw<Array<{ locked: boolean }>>`
          SELECT pg_advisory_xact_lock(hashtext(${`quote-version:${id}`})) IS NULL AS "locked"
        `;
        const existing = await tx.panelQuote.findUnique({
          where: { previousVersionId: id },
          include: quoteInclude,
        });
        if (existing) return existing;

        const next = await tx.panelQuote.create({
          data: {
            calculationId: null,
            requestId: source.requestId,
            leadId: source.leadId,
            clientId: source.clientId,
            managerId: source.managerId,
            dealId: source.dealId,
            previousVersionId: source.id,
            versionNumber: source.versionNumber + 1,
            status: QUOTE_STATUS.DRAFT,
            totalAmount: source.deliveryCost ?? new Prisma.Decimal(0),
            displayCurrency: source.displayCurrency,
            cnyUsdRate: null,
            sellingCoefficient: source.sellingCoefficient,
            deliveryCost: source.deliveryCost,
            clientComment: source.clientComment,
            commercialNote: source.commercialNote,
            internalCommercialNote: source.internalCommercialNote,
            productionTerms: source.productionTerms,
            deliveryTerms: source.deliveryTerms,
            productionDaysFrom: source.productionDaysFrom,
            productionDaysTo: source.productionDaysTo,
            deliveryDaysFrom: source.deliveryDaysFrom,
            deliveryDaysTo: source.deliveryDaysTo,
            documentDate: new Date(),
            validUntil: source.validUntil,
            items: {
              create: nextVersionItems,
            },
          },
          include: quoteInclude,
        });

        await tx.activity.create({
          data: {
            type: ActivityType.NOTE,
            relatedType: 'Lead',
            relatedId: source.leadId,
            authorId: user.id,
            metadata: {
              action: 'quote_version_created',
              previousVersionId: source.id,
              quoteId: next.id,
              versionNumber: next.versionNumber,
            },
          },
        });
        return next;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existing = await this.prisma.panelQuote.findUnique({
          where: { previousVersionId: id },
          include: quoteInclude,
        });
        if (existing) return existing;
      }
      throw error;
    }
  }

  async recordClientAcceptance(
    id: string,
    user: CurrentUser,
  ): Promise<PanelQuoteWithItems> {
    const quote = await this.getQuoteOrThrow(id);
    this.assertQuoteClientAcceptAccess(quote.managerId, user);

    const internallyApproved =
      quote.status === QUOTE_STATUS.APPROVED ||
      quote.status === QUOTE_STATUS.CONVERTED;

    if (!internallyApproved) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        'QUOTE_NOT_APPROVED',
        'Клиентское согласие можно зафиксировать только по внутренне согласованному КП',
      );
    }

    if (quote.clientAcceptedAt) {
      return quote;
    }

    const acceptedAt = new Date();

    const claimed = await this.prisma.$transaction(async (tx) => {
      const lead = await tx.lead.findUnique({
        where: { id: quote.leadId },
        select: { dealId: true },
      });
      const dealId = quote.dealId ?? lead?.dealId;
      if (!dealId) {
        throw new BusinessException(
          HttpStatus.CONFLICT,
          'QUALIFIED_DEAL_REQUIRED',
          'The qualified Lead must have an existing Deal before Quote acceptance',
        );
      }

      const result = await tx.panelQuote.updateMany({
        where: {
          id: quote.id,
          clientAcceptedAt: null,
          status: {
            in: [QUOTE_STATUS.APPROVED, QUOTE_STATUS.CONVERTED],
          },
        },
        data: {
          clientAcceptedAt: acceptedAt,
          clientAcceptedById: user.id,
          dealId,
        },
      });

      if (result.count !== 1) {
        return null;
      }

      const deal = await tx.deal.findFirst({
        where: { id: dealId, deletedAt: null },
        select: { id: true, stage: true },
      });
      if (!deal) {
        throw new BusinessException(
          HttpStatus.CONFLICT,
          'QUALIFIED_DEAL_REQUIRED',
          'The qualified Lead Deal is missing',
        );
      }
      const acceptanceStage = DealStage.AGREEMENT_PENDING;
      const stageOrder: DealStage[] = [
        DealStage.QUALIFICATION,
        DealStage.HPL_SELECTION,
        DealStage.OFFER_PREPARATION,
        DealStage.NEGOTIATION,
        DealStage.AGREEMENT_PENDING,
        DealStage.PAYMENT_PREPARATION,
        DealStage.SHIPPED,
        DealStage.WON,
        DealStage.LOST,
      ];
      if (
        stageOrder.indexOf(deal.stage) < stageOrder.indexOf(acceptanceStage)
      ) {
        await tx.deal.update({
          where: { id: deal.id },
          data: { stage: acceptanceStage },
        });
        await tx.dealStageHistory.create({
          data: {
            dealId: deal.id,
            oldStage: deal.stage,
            newStage: acceptanceStage,
            changedById: user.id,
          },
        });
      }
      await tx.lead.updateMany({
        where: { id: quote.leadId, dealId },
        data: { status: LeadStatus.CONVERTED },
      });

      await tx.activity.create({
        data: {
          type: ActivityType.NOTE,
          relatedType: 'Lead',
          relatedId: quote.leadId,
          authorId: user.id,
          metadata: {
            action: 'quote_client_accepted',
            quoteId: quote.id,
            dealId,
          },
        },
      });

      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: 'QUOTE_CLIENT_ACCEPTED',
          entityType: 'PanelQuote',
          entityId: quote.id,
          oldValue: { clientAcceptedAt: null, clientAcceptedById: null },
          newValue: {
            clientAcceptedAt: acceptedAt.toISOString(),
            clientAcceptedById: user.id,
          },
        },
      });

      return tx.panelQuote.findUniqueOrThrow({
        where: { id: quote.id },
        include: quoteInclude,
      });
    });

    if (claimed) {
      await this.safePostCommit('quote client acceptance notification', () =>
        this.prisma.notification.create({
          data: {
            userId: claimed.managerId,
            title: 'Quote accepted by client',
            message: `Quote #${claimed.id.slice(0, 8)} was accepted`,
            type: 'quote_client_accepted',
            relatedType: 'Lead',
            relatedId: claimed.leadId,
          },
        }),
      );
      return claimed;
    }

    const latest = await this.getQuoteOrThrow(id);
    if (latest.clientAcceptedAt) {
      return latest;
    }

    throw new BusinessException(
      HttpStatus.CONFLICT,
      'QUOTE_NOT_APPROVED',
      'Клиентское согласие можно зафиксировать только по внутренне согласованному КП',
    );
  }

  async convertToDeal(
    id: string,
    user: CurrentUser,
  ): Promise<{ quote: PanelQuoteWithItems; dealId: string }> {
    this.assertQuoteApprovalAllowed(user);
    const quote = await this.getQuoteOrThrow(id);
    this.assertQuoteWriteAccess(quote.managerId, user);

    if (quote.status !== QUOTE_STATUS.APPROVED) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        'QUOTE_NOT_APPROVED',
        'Сделку можно создать только из одобренного КП',
      );
    }

    if (!quote.finalizedAt || !quote.pdfFileId) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        'QUOTE_NOT_FINALIZED',
        'Сделку можно создать только из финализированного КП с сохранённым PDF',
      );
    }

    this.assertExplicitApprovedPricing(quote.items);

    const lead = await this.prisma.lead.findFirst({
      where: { id: quote.leadId, deletedAt: null },
      include: {
        qualification: {
          select: { stockOnly: true, installationRequired: true },
        },
      },
    });

    if (!lead?.clientId) {
      throw new BusinessException(
        HttpStatus.BAD_REQUEST,
        'LEAD_CLIENT_REQUIRED',
        'Для конвертации у лида должен быть указан клиент',
      );
    }

    if (
      lead.status !== LeadStatus.QUALIFIED &&
      lead.status !== LeadStatus.CONVERTED
    ) {
      throw new BusinessException(
        HttpStatus.BAD_REQUEST,
        'LEAD_NOT_QUALIFIED',
        'Сделку можно создать только из лида со статусом QUALIFIED',
      );
    }

    const stockOnly = lead.qualification?.stockOnly === true;
    let resolvedProductIds: Record<string, string> | undefined;

    if (stockOnly) {
      if (!quote.clientAcceptedAt) {
        throw new BusinessException(
          HttpStatus.CONFLICT,
          'QUOTE_CLIENT_ACCEPTANCE_REQUIRED',
          'Stock fulfillment can be selected only after client acceptance',
        );
      }

      const availability = await this.quoteStockService.check(quote.items);
      if (availability.status === 'SKU_UNRESOLVED') {
        throw new BusinessException(
          HttpStatus.CONFLICT,
          'STOCK_ONLY_SKU_UNRESOLVED',
          'The Quote snapshot does not resolve to one inventory SKU per line',
          { lines: availability.lines },
        );
      }
      if (availability.status === 'INSUFFICIENT') {
        throw new BusinessException(
          HttpStatus.CONFLICT,
          'STOCK_ONLY_INSUFFICIENT',
          'Usable stock is insufficient for this stock-only request',
          this.stockShortageDetails(availability),
        );
      }
      resolvedProductIds = Object.fromEntries(
        availability.lines.map((line) => [line.quoteItemId, line.productId!]),
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

    if (
      quote.items.some(
        (item) =>
          item.pricePerM2 === null ||
          item.totalPrice === null ||
          item.supplierPricePerM2 === null,
      )
    ) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        'QUOTE_REFERENCE_PRICE_UNAVAILABLE',
        'Для создания сделки требуется зафиксировать закупочную цену',
      );
    }

    const dealQuote = {
      ...quote,
      items: quote.items.map((item) => ({
        ...item,
        pricePerM2: item.pricePerM2!,
        totalPrice: item.totalPrice!,
        supplierPricePerM2: item.supplierPricePerM2!,
      })),
    };

    const initialTaskDueDate = new Date(Date.now() + 2 * 60 * 60 * 1000);

    const result = await this.prisma.$transaction(async (tx) => {
      const deal = await this.dealFactory.createFromQuote(tx, {
        quote: dealQuote,
        clientId: lead.clientId!,
        projectObjectId: lead.projectObjectId,
        serviceProductId: serviceProduct.id,
        resolvedProductIds,
        fulfillmentSource: stockOnly
          ? FulfillmentSource.WAREHOUSE_STOCK
          : FulfillmentSource.SUPPLIER_ORDER,
        installationRequiredSnapshot:
          lead.qualification?.installationRequired === true,
        userId: user.id,
        supplierId: supplier.id,
        existingDealId: lead.dealId ?? undefined,
      });

      if (stockOnly) {
        const order = await tx.order.create({
          data: {
            orderNumber: `ORD-${Date.now()}-${randomBytes(3).toString('hex').toUpperCase()}`,
            dealId: deal.id,
            status: OrderStatus.WAITING_PAYMENT,
            totalAmount: quote.totalAmount,
            remainingAmount: quote.totalAmount,
            items: {
              create: dealQuote.items.map((item) => ({
                productId: resolvedProductIds![item.id],
                quantity: Number(item.areaM2) * item.sheetsCount,
                unitPrice: item.pricePerM2,
                totalPrice: item.totalPrice,
                source: OrderItemSource.SKU,
              })),
            },
          },
          include: { items: true },
        });

        try {
          await this.inventoryService.reserveStock(
            order.id,
            order.items.map((item) => ({
              productId: item.productId,
              quantity: item.quantity,
            })),
            tx,
            user.id,
          );
        } catch (error) {
          if (!(error instanceof BadRequestException)) throw error;
          const current = await this.quoteStockService.check(quote.items);
          throw new BusinessException(
            HttpStatus.CONFLICT,
            'STOCK_ONLY_INSUFFICIENT',
            'Usable stock changed before the reservation could be committed',
            this.stockShortageDetails(current),
          );
        }
        await Promise.all(
          order.items.map((item) =>
            tx.orderItem.update({
              where: { id: item.id },
              data: { reservedQuantity: item.quantity },
            }),
          ),
        );
        await tx.auditLog.create({
          data: {
            userId: user.id,
            action: 'DEAL_STOCK_FULFILLMENT_SELECTED',
            entityType: 'Deal',
            entityId: deal.id,
            newValue: {
              fulfillmentSource: FulfillmentSource.WAREHOUSE_STOCK,
              orderId: order.id,
            },
          },
        });
      }

      const claimedLead = await tx.lead.updateMany({
        where: {
          id: quote.leadId,
          deletedAt: null,
          OR: [{ dealId: deal.id }, { dealId: null }],
          status: { in: [LeadStatus.QUALIFIED, LeadStatus.CONVERTED] },
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
          OR: [{ dealId: deal.id }, { dealId: null }],
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

      if (quote.calculationId) {
        await tx.calculationSession.update({
          where: { id: quote.calculationId },
          data: { dealId: deal.id },
        });
      }
      if (quote.requestId) {
        await tx.calculationSession.updateMany({
          where: { requestId: quote.requestId, deletedAt: null },
          data: { dealId: deal.id },
        });
      }

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

  private stockShortageDetails(
    availability: QuoteStockAvailability,
  ): Record<string, unknown> {
    const byProduct = new Map<
      string,
      { required: number; available: number }
    >();
    for (const line of availability.lines) {
      if (!line.productId) continue;
      const current = byProduct.get(line.productId) ?? {
        required: 0,
        available: line.availableQuantity,
      };
      current.required += line.requiredQuantity;
      current.available = line.availableQuantity;
      byProduct.set(line.productId, current);
    }

    const totals = Array.from(byProduct.values()).reduce(
      (sum, item) => ({
        requiredQuantity: sum.requiredQuantity + item.required,
        availableQuantity: sum.availableQuantity + item.available,
        shortage: sum.shortage + Math.max(0, item.required - item.available),
      }),
      { requiredQuantity: 0, availableQuantity: 0, shortage: 0 },
    );

    return { ...totals, lines: availability.lines };
  }

  private async priceCalculationRequestGroups(
    groups: QuoteSnapshotGroup[],
    fallbackSupplierId?: string,
  ): Promise<{
    groups: QuoteSnapshotGroup[];
    cnyUsdRate: Prisma.Decimal | null;
    referencePricingComplete: boolean;
  }> {
    const supplierCache = new Map<
      string,
      NonNullable<QuoteSnapshotItem['supplier']>
    >();
    if (fallbackSupplierId) {
      const fallbackSupplier = await this.prisma.supplier.findUnique({
        where: { id: fallbackSupplierId },
      });
      if (!fallbackSupplier) {
        throw new BusinessException(
          HttpStatus.BAD_REQUEST,
          'SUPPLIER_NOT_FOUND',
          'Выбранный поставщик не найден',
        );
      }
      supplierCache.set(fallbackSupplier.id, fallbackSupplier);
    }

    const pricedGroups: QuoteSnapshotGroup[] = [];

    for (const group of groups) {
      const pricedItems: QuoteSnapshotItem[] = [];
      for (const item of group.items) {
        const effectiveSupplierId = item.supplier?.id ?? fallbackSupplierId;
        if (!effectiveSupplierId) {
          throw new BusinessException(
            HttpStatus.BAD_REQUEST,
            'QUOTE_SUPPLIER_REQUIRED',
            'Перед созданием КП у каждой позиции должен быть выбран поставщик',
          );
        }

        let supplier = item.supplier;
        if (
          !item.panelTypeId ||
          !item.panelType ||
          !item.panelSizeId ||
          item.thicknessMm == null ||
          !item.qualityClassId ||
          item.requiredAreaM2 == null
        ) {
          throw new BusinessException(
            HttpStatus.BAD_REQUEST,
            'CALCULATION_PREFILL_INCOMPLETE',
            'Перед созданием КП руководитель должен дополнить технические данные позиций',
          );
        }

        if (!supplier || supplier.id !== effectiveSupplierId) {
          supplier = supplierCache.get(effectiveSupplierId) ?? null;
          if (!supplier) {
            const loadedSupplier = await this.prisma.supplier.findUnique({
              where: { id: effectiveSupplierId },
            });
            if (!loadedSupplier) {
              throw new BusinessException(
                HttpStatus.BAD_REQUEST,
                'SUPPLIER_NOT_FOUND',
                'Выбранный поставщик не найден',
              );
            }
            supplierCache.set(loadedSupplier.id, loadedSupplier);
            supplier = loadedSupplier;
          }
        }
        const application = applicationForPanelTypeCode(item.panelType.code);
        const isCustomType = item.panelType.code === HPL_CUSTOM_PANEL_TYPE_CODE;

        if (!application && !isCustomType) {
          throw new BusinessException(
            HttpStatus.UNPROCESSABLE_ENTITY,
            'PANEL_TYPE_PRICING_UNSUPPORTED',
            'Для выбранного типа HPL коммерческий расчёт не настроен',
          );
        }

        if (isCustomType && !item.customTypeDescription?.trim()) {
          throw new BusinessException(
            HttpStatus.BAD_REQUEST,
            'CUSTOM_TYPE_DESCRIPTION_REQUIRED',
            'Для типа «Другой» укажите описание запроса',
          );
        }

        const thickness = validateHplThickness(application, item.thicknessMm);
        if (!thickness.ok) {
          throw new BusinessException(
            HttpStatus.BAD_REQUEST,
            thickness.errorCode,
            thickness.message,
          );
        }

        if (application) {
          const qualityMapping =
            await this.prisma.supplierQualityMapping.findFirst({
              where: {
                supplierId: supplier.id,
                panelTypeId: item.panelTypeId,
                qualityClassId: item.qualityClassId,
              },
            });
          if (!qualityMapping) {
            throw new BusinessException(
              HttpStatus.BAD_REQUEST,
              'INVALID_QUALITY_MAPPING',
              'Выбранный класс качества недоступен для этого поставщика',
            );
          }
        }

        if (item.color && item.color.supplierId !== supplier.id) {
          throw new BusinessException(
            HttpStatus.BAD_REQUEST,
            'COLOR_SUPPLIER_MISMATCH',
            'Выбранный декор недоступен у выбранного поставщика',
          );
        }

        if (item.colorCode && !item.color) {
          const matchingColor = await this.prisma.panelColor.findFirst({
            where: {
              supplierId: supplier.id,
              colorCode: item.colorCode,
            },
            select: { id: true },
          });
          if (!matchingColor) {
            throw new BusinessException(
              HttpStatus.BAD_REQUEST,
              'COLOR_SUPPLIER_MISMATCH',
              'Сохранённый декор не найден у выбранного поставщика',
            );
          }
        }

        pricedItems.push({
          ...item,
          supplier,
          thicknessMm: thickness.thicknessMm,
          supplierPricePerM2: null,
          clientPricePerM2: null,
          pricePerSheet: null,
          totalPrice: null,
        });
      }

      const groupReferencePricingComplete = pricedItems.every(
        (item) => item.totalPrice !== null,
      );

      pricedGroups.push({
        ...group,
        totalAmount: groupReferencePricingComplete
          ? pricedItems.reduce(
              (sum, item) => sum.plus(item.totalPrice ?? 0),
              new Prisma.Decimal(0),
            )
          : new Prisma.Decimal(0),
        cnyUsdRate: null,
        items: pricedItems,
      });
    }

    return {
      groups: pricedGroups,
      cnyUsdRate: null,
      referencePricingComplete: false,
    };
  }

  private snapshotQuoteItems(
    groups: QuoteSnapshotGroup[],
    currencyCode: string,
  ) {
    const rows: Prisma.PanelQuoteItemCreateWithoutQuoteInput[] = [];
    let sortOrder = 0;
    for (const [groupIndex, group] of groups.entries()) {
      const groupTitle =
        group.title?.trim() ||
        group.notes?.trim() ||
        `Расчёт ${groupIndex + 1}`;
      for (const item of group.items) {
        if (!item.supplier) {
          throw new BusinessException(
            HttpStatus.BAD_REQUEST,
            'QUOTE_SUPPLIER_REQUIRED',
            'Перед созданием КП у каждой позиции должен быть выбран поставщик',
          );
        }
        rows.push({
          calculationId: group.id,
          calculationGroupTitle: groupTitle,
          calculationGroupSortOrder: group.sortOrder ?? groupIndex,
          panelTypeCode: item.panelType.code,
          panelTypeName: item.panelType.displayNameRu,
          panelSizeName: item.panelSize.displayName,
          areaM2: item.panelSize.areaM2,
          thicknessMm: item.thicknessMm,
          supplierCode: item.supplier.code,
          supplierName: item.supplier.name,
          qualityClassCode: item.qualityClass.code,
          qualityClassName: item.qualityClass.nameRu,
          colorCode: item.color?.colorCode ?? item.colorCode ?? null,
          colorName: item.color?.colorName ?? item.colorName ?? null,
          coating: item.coating ?? null,
          texture: item.texture ?? null,
          note: item.note ?? null,
          customTypeDescription: item.customTypeDescription ?? null,
          customWidthMm: item.customWidthMm ?? null,
          customHeightMm: item.customHeightMm ?? null,
          requiredAreaM2: item.requiredAreaM2,
          sheetsCount: item.sheetsCount,
          supplierPricePerM2: item.supplierPricePerM2,
          pricePerM2: item.clientPricePerM2,
          currencyCode: item.clientPricePerM2 ? currencyCode : null,
          priceApprovedAt: null,
          priceApprovedById: null,
          pricePerSheet: item.pricePerSheet,
          totalPrice: item.totalPrice,
          wastePercent: item.wastePercent,
          sortOrder,
        });
        sortOrder += 1;
      }
    }
    return rows;
  }

  private isReferencePriceUnavailable(error: unknown): boolean {
    if (!(error instanceof BusinessException)) {
      return false;
    }
    const response = error.getResponse();
    return (
      typeof response === 'object' &&
      response !== null &&
      'errorCode' in response &&
      response.errorCode === 'PRICING_NOT_CONFIGURED'
    );
  }

  private async applyApprovedPrices(
    quote: PanelQuoteWithItems,
    items: UpdateQuoteApprovedPricingDto['items'],
    approvedById: string,
  ): Promise<PanelQuoteWithItems> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ locked: boolean }>>`
        SELECT pg_advisory_xact_lock(hashtext(${`quote-pricing:${quote.id}`})) IS NULL AS "locked"
      `;
      const locked = await tx.panelQuote.findUniqueOrThrow({
        where: { id: quote.id },
        include: quoteInclude,
      });
      this.assertQuoteMutableForLeader(locked);
      const frozenRate =
        locked.cnyUsdRate ??
        (await this.currencyRateService.getActiveCnyUsdRate());
      const calculated = await this.calculateQuotePurchasePrices(
        locked,
        items,
        frozenRate,
      );
      const approvedAt = new Date();
      for (const { target, price } of calculated.items) {
        await tx.panelQuoteItem.update({
          where: { id: target.id },
          data: {
            supplierPricePerM2: price.supplierPricePerM2,
            pricePerM2: price.clientPricePerM2,
            currencyCode: 'USD',
            totalPrice: price.total,
            pricePerSheet: price.pricePerSheet,
            priceApprovedAt: approvedAt,
            priceApprovedById: approvedById,
          },
        });
      }

      await tx.panelQuote.update({
        where: { id: locked.id },
        data: {
          cnyUsdRate: calculated.cnyUsdRate,
          sellingCoefficient: calculated.sellingCoefficient,
        },
      });

      const updated = await tx.panelQuote.findUniqueOrThrow({
        where: { id: locked.id },
        include: quoteInclude,
      });
      const currencies = new Set(
        updated.items
          .filter((item) => item.priceApprovedAt && item.currencyCode !== null)
          .map((item) => item.currencyCode),
      );
      const allApproved = updated.items.every(
        (item) =>
          item.priceApprovedAt &&
          item.pricePerM2 !== null &&
          item.totalPrice !== null &&
          item.currencyCode !== null,
      );
      if (!allApproved || currencies.size !== 1) {
        return updated;
      }

      const totalAmount = updated.items.reduce(
        (sum, item) => sum.plus(item.totalPrice ?? 0),
        new Prisma.Decimal(0),
      );

      return tx.panelQuote.update({
        where: { id: locked.id },
        data: {
          totalAmount: totalAmount.toDecimalPlaces(2),
          displayCurrency: [...currencies][0]!,
        },
        include: quoteInclude,
      });
    });
  }

  private async calculateQuotePurchasePrices(
    quote: PanelQuoteWithItems,
    items: PreviewQuotePricingDto['items'],
    cnyUsdRate: Prisma.Decimal,
  ) {
    const seen = new Set<string>();
    const calculated: Array<{
      target: PanelQuoteWithItems['items'][number];
      price: Awaited<ReturnType<PanelPriceCalculator['calculate']>>;
    }> = [];

    for (const item of items) {
      const target = quote.items.find(
        (row) =>
          row.id === item.id ||
          (item.calculationId != null &&
            row.calculationId === item.calculationId &&
            item.id == null),
      );
      if (!target || seen.has(target.id)) {
        throw new BusinessException(
          HttpStatus.BAD_REQUEST,
          'QUOTE_ITEM_NOT_FOUND',
          'Позиция КП не найдена или указана повторно',
        );
      }
      seen.add(target.id);

      const [supplier, qualityClass] = await Promise.all([
        this.prisma.supplier.findUnique({
          where: { code: target.supplierCode },
          select: { id: true },
        }),
        this.prisma.qualityClass.findUnique({
          where: { code: target.qualityClassCode },
          select: { id: true },
        }),
      ]);
      if (!supplier || !qualityClass) {
        throw new BusinessException(
          HttpStatus.BAD_REQUEST,
          'QUOTE_PRICING_REFERENCE_INVALID',
          'Не удалось сопоставить поставщика или линейку позиции КП',
        );
      }

      const price = await this.panelPriceCalculator.calculate({
        supplierId: supplier.id,
        qualityClassId: qualityClass.id,
        thicknessMm: target.thicknessMm,
        areaM2: target.areaM2,
        sheets: target.sheetsCount,
        cnyUsdRate,
        purchasePricePerM2Cny: item.purchasePricePerM2Cny,
      });
      calculated.push({ target, price });
    }

    return {
      cnyUsdRate,
      sellingCoefficient:
        calculated[0]?.price.sellingCoefficient ?? new Prisma.Decimal(2),
      items: calculated,
    };
  }

  private assertExplicitApprovedPricing(
    items: Array<{
      priceApprovedAt: Date | null;
      pricePerM2: Prisma.Decimal | null;
      currencyCode: string | null;
    }>,
  ): void {
    if (items.length === 0) {
      throw new BusinessException(
        HttpStatus.BAD_REQUEST,
        QUOTE_PRICE_NOT_APPROVED,
        'Нельзя финализировать КП без позиций с утверждённой ценой',
      );
    }

    for (const item of items) {
      if (!item.priceApprovedAt || !item.pricePerM2) {
        throw new BusinessException(
          HttpStatus.BAD_REQUEST,
          QUOTE_PRICE_NOT_APPROVED,
          'Финализация возможна только после явного утверждения цены и валюты руководителем по каждой позиции',
        );
      }
      if (!QUOTE_COMMERCIAL_CURRENCIES.includes(item.currencyCode as never)) {
        throw new BusinessException(
          HttpStatus.BAD_REQUEST,
          'QUOTE_CURRENCY_REQUIRED',
          'У каждой коммерческой цены должна быть валюта USD или UZS',
        );
      }
    }
  }

  private assertQuoteMutableForLeader(quote: {
    status: string;
    finalizedAt: Date | null;
  }): void {
    if (quote.finalizedAt) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        'QUOTE_TERMS_LOCKED',
        'Финализированное КП нельзя менять',
      );
    }
    if (quote.status !== QUOTE_STATUS.DRAFT) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        'QUOTE_TERMS_LOCKED',
        'Коммерческие условия КП нельзя менять после отправки клиенту',
      );
    }
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

  private assertQuoteClientFacingTermsAccess(
    dto: QuoteClientFacingTermsDto,
    user: CurrentUser,
  ): void {
    if (!this.hasQuoteClientFacingTermsInput(dto)) {
      return;
    }

    if (canWriteQuoteClientFacingTerms(user.permissions)) {
      return;
    }

    throw new BusinessException(
      HttpStatus.FORBIDDEN,
      'QUOTE_CLIENT_TERMS_FORBIDDEN',
      'Срок производства, доставки и действия КП задаёт руководитель',
    );
  }

  private assertQuoteCommercialNoteAccess(
    dto: QuoteClientFacingTermsDto,
    user: CurrentUser,
  ): void {
    if (dto.commercialNote === undefined || dto.commercialNote === null) {
      return;
    }

    if (canMutateQuoteCommercialNote(user.permissions)) {
      return;
    }

    throw new BusinessException(
      HttpStatus.FORBIDDEN,
      'QUOTE_COMMERCIAL_NOTE_FORBIDDEN',
      'Примечание КП может редактировать руководитель',
    );
  }

  /**
   * Snapshot the Manager customer note onto Quote at creation.
   * Later Lead source-note edits must not rewrite this Quote field.
   */
  private snapshotManagerCommercialNote(
    dtoNote: string | undefined,
    sourceNote: string | null | undefined,
  ): string | null {
    if (dtoNote !== undefined) {
      return dtoNote.trim() || null;
    }

    return sourceNote?.trim() || null;
  }

  private hasQuoteClientFacingTermsInput(
    dto: QuoteClientFacingTermsDto,
  ): boolean {
    return (
      dto.productionDaysFrom !== undefined ||
      dto.productionDaysTo !== undefined ||
      dto.deliveryDaysFrom !== undefined ||
      dto.deliveryDaysTo !== undefined ||
      dto.productionTerms !== undefined ||
      dto.deliveryTerms !== undefined ||
      dto.validUntil !== undefined
    );
  }

  private assertDayRange(
    from: number | undefined,
    to: number | undefined,
    errorCode: string,
    message: string,
  ): void {
    if (from === undefined && to === undefined) {
      return;
    }

    if (
      from === undefined ||
      to === undefined ||
      from <= 0 ||
      to <= 0 ||
      from > to
    ) {
      throw new BusinessException(HttpStatus.BAD_REQUEST, errorCode, message, {
        from,
        to,
      });
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

  private assertQuoteReadAccess(managerId: string, user: CurrentUser): void {
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

  private assertQuoteWriteAccess(managerId: string, user: CurrentUser): void {
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

  // Ownership / quotes:read_all is not a customer-contact permission.
  private assertQuoteClientAcceptAccess(
    managerId: string,
    user: CurrentUser,
  ): void {
    if (
      managerId === user.id &&
      user.permissions.includes(QUOTE_PERMISSIONS.CLIENT_ACCEPT)
    ) {
      return;
    }

    throw new BusinessException(
      HttpStatus.FORBIDDEN,
      'QUOTE_CLIENT_ACCEPT_FORBIDDEN',
      'Клиентское согласие фиксирует менеджер, ведущий это КП',
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
          text: `Здравствуйте! Вам направлено коммерческое предложение на сумму ${quote.totalAmount.toString()} ${quote.displayCurrency}.`,
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

  private async safePostCommit(
    operation: string,
    callback: () => Promise<unknown>,
  ): Promise<void> {
    try {
      await callback();
    } catch (error) {
      this.logger.error(
        `Business commit succeeded; ${operation} failed: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}
