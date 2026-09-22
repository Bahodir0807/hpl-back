import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  ActivityType,
  FacadeCalculationStatus,
  FacadeCommercialStatus,
  Prisma,
  RoleName,
} from '@prisma/client';
import { BusinessException } from '../../../../common/exceptions/business.exception';
import type { CurrentUser } from '../../../../common/interfaces/current-user.interface';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  hasOwnerOrReadAllLeadAccess,
} from '../engineering-access';
import { decimalToString, toDecimal } from './facade-decimal';
import {
  FACADE_PRICE_STATUS,
  FACADE_PRICING_NOTIFICATION_TYPE,
  FACADE_PRICING_PERMISSIONS,
  HPL_REFERENCE_MATERIAL_CODE,
  type FacadePriceStatus,
} from './facade-pricing.constants';
import type {
  ApproveFacadeCommercialDto,
  PatchFacadeCommercialDto,
  RepriceFacadeCommercialDto,
  SubmitFacadeCommercialDto,
} from './dto/facade-commercial.dto';

type TechnicalCalculation = Prisma.FacadeSubsystemCalculationGetPayload<{
  include: {
    items: true;
    config: true;
    normSet: true;
  };
}>;

type CommercialWithItems = Prisma.FacadeCommercialCalculationGetPayload<{
  include: { items: true };
}>;

type OfferRow = Prisma.FacadeMaterialSupplierOfferGetPayload<{
  include: { supplier: true; material: true };
}>;

type CommercialLine = {
  id: string;
  technicalItemId?: string | null;
  materialId: string | null;
  materialCode: string;
  materialName: string;
  materialSnapshot: Prisma.JsonValue | Record<string, unknown>;
  category: string;
  unit: string;
  finalQty: Prisma.Decimal;
  excludedFromSubsystemCommercialCost: boolean;
  selectedOfferId: string | null;
  offerSnapshot: Record<string, unknown> | null;
  purchasePrice: Prisma.Decimal | null;
  purchaseCurrency: string | null;
  linePurchaseTotal: Prisma.Decimal | null;
  priceStatus: FacadePriceStatus;
  fxFromCurrency: string | null;
  fxToCurrency: string | null;
  fxRate: Prisma.Decimal | null;
  fxRateId: string | null;
  fxEffectiveFrom: Date | null;
  convertedAmount: Prisma.Decimal | null;
  convertedCurrency: string | null;
  sortOrder: number;
};

type FxLookup = {
  fromCurrency: string;
  toCurrency: string;
  rate: Prisma.Decimal;
  rateId: string | null;
  effectiveFrom: Date | null;
  identity: boolean;
  missing: boolean;
};

@Injectable()
export class FacadeCommercialService {
  private readonly logger = new Logger(FacadeCommercialService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getCurrent(leadId: string, user: CurrentUser) {
    const { lead, technical } = await this.loadLeadContext(leadId, user);
    const access = this.resolveAccess(user, lead.ownerId);
    if (!access.canView) {
      throw new BusinessException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Нет доступа к коммерческому расчёту подсистемы',
      );
    }

    const commercial = await this.prisma.facadeCommercialCalculation.findFirst({
      where: { leadId, isCurrent: true },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });

    const offers = access.canReadPurchase
      ? await this.prisma.facadeMaterialSupplierOffer.findMany({
          include: { supplier: true, material: true },
          orderBy: [{ createdAt: 'desc' }],
        })
      : [];

    return this.toWorkspaceView({
      lead,
      technical,
      commercial,
      offers,
      access,
    });
  }

  async createFromTechnical(leadId: string, user: CurrentUser) {
    this.assertPrepare(user);
    const { lead, technical } = await this.loadLeadContext(leadId, user);
    this.assertTechnicalReady(technical);

    const current = await this.prisma.facadeCommercialCalculation.findFirst({
      where: { leadId, isCurrent: true },
      include: { items: true },
    });
    if (current && current.status !== FacadeCommercialStatus.APPROVED) {
      return this.toCalculationView(current, technical, this.resolveAccess(user, lead.ownerId));
    }

    const created = await this.prisma.$transaction(async (tx) => {
      if (current) {
        await tx.facadeCommercialCalculation.update({
          where: { id: current.id },
          data: { isCurrent: false },
        });
      }
      return this.persistDraftFromTechnical(tx, {
        leadId,
        technical,
        previous: current,
        actorId: user.id,
        action: current ? 'COMMERCIAL_REVISION_CREATED' : 'COMMERCIAL_CREATED',
      });
    });

    return this.toCalculationView(
      created,
      technical,
      this.resolveAccess(user, lead.ownerId),
    );
  }

  async patch(
    leadId: string,
    dto: PatchFacadeCommercialDto,
    user: CurrentUser,
  ) {
    this.assertPrepare(user);
    const { lead, technical } = await this.loadLeadContext(leadId, user);
    const commercial = await this.requireCurrent(leadId);
    this.assertMutable(commercial);
    this.assertCommercialRevision(commercial, dto.expectedRevision);

    const offers = await this.prisma.facadeMaterialSupplierOffer.findMany({
      include: { supplier: true, material: true },
    });
    const offerById = new Map(offers.map((offer) => [offer.id, offer]));
    const selectionByItem = new Map(
      (dto.selections ?? []).map((item) => [item.itemId, item.offerId ?? null]),
    );

    const nextItems = commercial.items.map((item) => {
      const nextOfferId = selectionByItem.has(item.id)
        ? selectionByItem.get(item.id) ?? null
        : item.selectedOfferId;
      return this.computeItem(item, nextOfferId, offerById, dto.proposedCurrency ?? commercial.proposedCurrency);
    });

    const proposedAmount =
      dto.proposedCustomerAmount === undefined
        ? commercial.proposedCustomerAmount
        : dto.proposedCustomerAmount === null || dto.proposedCustomerAmount === ''
          ? null
          : this.parsePositiveAmount(
              dto.proposedCustomerAmount,
              false,
            );
    const proposedCurrency =
      dto.proposedCurrency === undefined
        ? commercial.proposedCurrency
        : dto.proposedCurrency
          ? this.normalizeCurrency(dto.proposedCurrency)
          : null;

    const priced = await this.applyFx(nextItems, proposedCurrency);
    const procurement = this.summarizeProcurement(priced);

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.facadeCommercialCalculationItem.deleteMany({
        where: { commercialCalculationId: commercial.id },
      });
      const saved = await tx.facadeCommercialCalculation.update({
        where: { id: commercial.id },
        data: {
          status: FacadeCommercialStatus.DRAFT,
          procurementIncomplete: procurement.incomplete,
          procurementByCurrency: procurement.byCurrency as Prisma.InputJsonValue,
          fxSnapshots: procurement.fxSnapshots as Prisma.InputJsonValue,
          proposedCustomerAmount: proposedAmount,
          proposedCurrency,
          commercialNote:
            dto.commercialNote === undefined
              ? commercial.commercialNote
              : dto.commercialNote,
          revision: { increment: 1 },
          items: {
            create: priced.map((item) => this.toItemCreate(item)),
          },
        },
        include: { items: { orderBy: { sortOrder: 'asc' } } },
      });
      await this.writeHistory(tx, {
        leadId,
        actorId: user.id,
        action: 'FACADE_COMMERCIAL_UPDATED',
        content: 'Обновлён коммерческий расчёт подсистемы',
        metadata: {
          commercialId: saved.id,
          revision: saved.revision,
          selectedOffers: priced
            .filter((item) => item.selectedOfferId)
            .map((item) => item.materialCode),
          hidePurchase: true,
        },
      });
      return saved;
    });

    return this.toCalculationView(
      updated,
      technical,
      this.resolveAccess(user, lead.ownerId),
    );
  }

  async submit(
    leadId: string,
    dto: SubmitFacadeCommercialDto,
    user: CurrentUser,
  ) {
    this.assertPrepare(user);
    const { lead, technical } = await this.loadLeadContext(leadId, user);
    const commercial = await this.requireCurrent(leadId);
    this.assertMutable(commercial);
    this.assertCommercialRevision(commercial, dto.expectedRevision);
    this.assertReadyForApproval(commercial);

    const updated = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.facadeCommercialCalculation.update({
        where: { id: commercial.id },
        data: {
          status: FacadeCommercialStatus.READY_FOR_APPROVAL,
          revision: { increment: 1 },
        },
        include: { items: { orderBy: { sortOrder: 'asc' } } },
      });
      await this.writeHistory(tx, {
        leadId,
        actorId: user.id,
        action: 'FACADE_COMMERCIAL_SUBMITTED',
        content: 'Коммерческий расчёт подсистемы отправлен на утверждение',
        metadata: {
          commercialId: saved.id,
          revision: saved.revision,
          hidePurchase: true,
        },
      });
      return saved;
    });

    return this.toCalculationView(
      updated,
      technical,
      this.resolveAccess(user, lead.ownerId),
    );
  }

  async approve(
    leadId: string,
    dto: ApproveFacadeCommercialDto,
    user: CurrentUser,
  ) {
    this.assertApprove(user);
    const { lead, technical } = await this.loadLeadContext(leadId, user);
    const commercial = await this.requireCurrent(leadId);
    this.assertCommercialRevision(commercial, dto.expectedRevision);
    if (commercial.status === FacadeCommercialStatus.APPROVED) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        'FACADE_COMMERCIAL_ALREADY_APPROVED',
        'Коммерческий расчёт уже утверждён',
        {
          approvedById: commercial.approvedById,
          approvedAt: commercial.approvedAt,
        },
      );
    }
    if (commercial.status !== FacadeCommercialStatus.READY_FOR_APPROVAL) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        'FACADE_COMMERCIAL_NOT_READY',
        'Коммерческий расчёт ещё не готов к утверждению',
      );
    }
    this.assertReadyForApproval(commercial);
    this.assertTechnicalSnapshotExists(commercial, technical);

    const roleSnapshot = this.approverRoleSnapshot(user);
    const updated = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.facadeCommercialCalculation.update({
        where: { id: commercial.id },
        data: {
          status: FacadeCommercialStatus.APPROVED,
          approvedCustomerAmount: commercial.proposedCustomerAmount,
          approvedCurrency: commercial.proposedCurrency,
          approvedById: user.id,
          approvedAt: new Date(),
          approverRoleSnapshot: roleSnapshot,
          revision: { increment: 1 },
        },
        include: { items: { orderBy: { sortOrder: 'asc' } } },
      });
      await this.writeHistory(tx, {
        leadId,
        actorId: user.id,
        action:
          roleSnapshot === RoleName.DIRECTOR
            ? 'FACADE_COMMERCIAL_APPROVED_BY_DIRECTOR'
            : 'FACADE_COMMERCIAL_APPROVED_BY_HEAD',
        content: 'Утверждена клиентская стоимость подсистемы',
        metadata: {
          commercialId: saved.id,
          revision: saved.revision,
          approvedCurrency: saved.approvedCurrency,
          approverRoleSnapshot: roleSnapshot,
          hidePurchase: true,
        },
      });
      return saved;
    });

    await this.notifySafe({
      userId: lead.ownerId,
      title: 'Утверждена стоимость подсистемы',
      message: 'Клиентская стоимость фасадной подсистемы утверждена.',
      type: FACADE_PRICING_NOTIFICATION_TYPE.APPROVED,
      leadId,
    });

    return this.toCalculationView(
      updated,
      technical,
      this.resolveAccess(user, lead.ownerId),
    );
  }

  async reprice(
    leadId: string,
    dto: RepriceFacadeCommercialDto,
    user: CurrentUser,
  ) {
    this.assertPrepare(user);
    const { lead, technical } = await this.loadLeadContext(leadId, user);
    this.assertTechnicalReady(technical);
    const current = await this.requireCurrent(leadId);
    if (dto.expectedRevision !== undefined) {
      this.assertCommercialRevision(current, dto.expectedRevision);
    }

    const created = await this.prisma.$transaction(async (tx) => {
      await tx.facadeCommercialCalculation.update({
        where: { id: current.id },
        data: { isCurrent: false },
      });
      return this.persistDraftFromTechnical(tx, {
        leadId,
        technical,
        previous: current,
        actorId: user.id,
        action: 'COMMERCIAL_REVISION_CREATED',
      });
    });

    return this.toCalculationView(
      created,
      technical,
      this.resolveAccess(user, lead.ownerId),
    );
  }

  async onTechnicalRevisionChanged(
    leadId: string,
    technicalRevision: number,
    technicalStatus: FacadeCalculationStatus,
    actorId?: string,
  ): Promise<void> {
    try {
      const commercial = await this.prisma.facadeCommercialCalculation.findFirst({
        where: { leadId, isCurrent: true },
      });
      const lead = await this.prisma.lead.findFirst({
        where: { id: leadId, deletedAt: null },
        select: { id: true, ownerId: true, title: true },
      });
      if (!lead) {
        return;
      }

      if (
        technicalStatus === FacadeCalculationStatus.CALCULATED &&
        !commercial
      ) {
        await this.notifyPricingUsers({
          title: 'Технический расчёт подсистемы готов',
          message: `Лид «${lead.title}»: технический расчёт готов к коммерческой подготовке.`,
          type: FACADE_PRICING_NOTIFICATION_TYPE.TECHNICAL_READY,
          leadId,
        });
        return;
      }

      if (
        commercial?.status === FacadeCommercialStatus.APPROVED &&
        commercial.facadeCalculationRevision !== technicalRevision
      ) {
        await this.writeHistory(this.prisma, {
          leadId,
          actorId: actorId ?? lead.ownerId,
          action: 'FACADE_TECHNICAL_NEWER_THAN_COMMERCIAL',
          content:
            'Технический расчёт изменён после коммерческого расчёта',
          metadata: {
            commercialId: commercial.id,
            commercialRevision: commercial.revision,
            technicalRevision,
            hidePurchase: true,
          },
        });
        await this.notifyPricingUsers({
          title: 'Технический расчёт изменился после утверждения',
          message: `Лид «${lead.title}»: технический расчёт изменён после утверждённой коммерческой версии.`,
          type: FACADE_PRICING_NOTIFICATION_TYPE.STALE_TECHNICAL,
          leadId,
        });
      }
    } catch (error) {
      this.logger.error(
        'Facade commercial technical-revision hook failed',
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  private async persistDraftFromTechnical(
    tx: Prisma.TransactionClient,
    input: {
      leadId: string;
      technical: TechnicalCalculation;
      previous: CommercialWithItems | null;
      actorId: string;
      action: string;
    },
  ) {
    const last = await tx.facadeCommercialCalculation.findFirst({
      where: { leadId: input.leadId },
      orderBy: { revision: 'desc' },
      select: { revision: true },
    });
    const previousByCode = new Map(
      (input.previous?.items ?? []).map((item) => [item.materialCode, item]),
    );
    const offers = await tx.facadeMaterialSupplierOffer.findMany({
      include: { supplier: true, material: true },
    });
    const offerById = new Map(offers.map((offer) => [offer.id, offer]));
    const draftItems = input.technical.items.map((item) => {
      const previous = previousByCode.get(item.materialCode);
      const selectedOfferId =
        previous?.selectedOfferId && offerById.get(previous.selectedOfferId)?.isActive
          ? previous.selectedOfferId
          : null;
      return this.computeItem(
        {
          id: item.id,
          technicalItemId: item.id,
          materialId: item.materialId,
          materialCode: item.materialCode,
          materialName: item.materialName,
          materialSnapshot: {
            code: item.materialCode,
            name: item.materialName,
            category: item.category,
            unit: item.unit,
            spec: item.specSnapshot,
          },
          category: item.category,
          unit: item.unit,
          finalQty: item.finalQty,
          excludedFromSubsystemCommercialCost: this.isHplReference(item),
          selectedOfferId,
          sortOrder: item.sortOrder,
        },
        selectedOfferId,
        offerById,
        input.previous?.proposedCurrency ?? null,
      );
    });
    const priced = await this.applyFx(
      draftItems,
      input.previous?.proposedCurrency ?? null,
    );
    const procurement = this.summarizeProcurement(priced);
    const created = await tx.facadeCommercialCalculation.create({
      data: {
        leadId: input.leadId,
        facadeCalculationId: input.technical.id,
        facadeCalculationRevision: input.technical.revision,
        revision: (last?.revision ?? 0) + 1,
        isCurrent: true,
        status: FacadeCommercialStatus.DRAFT,
        technicalSnapshot: this.technicalSnapshot(input.technical),
        procurementIncomplete: procurement.incomplete,
        procurementByCurrency: procurement.byCurrency as Prisma.InputJsonValue,
        fxSnapshots: procurement.fxSnapshots as Prisma.InputJsonValue,
        proposedCustomerAmount: null,
        proposedCurrency: input.previous?.proposedCurrency ?? null,
        commercialNote: null,
        quoteCreated: false,
        dealCreated: false,
        items: {
          create: priced.map((item) => this.toItemCreate(item)),
        },
      },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
    await this.writeHistory(tx, {
      leadId: input.leadId,
      actorId: input.actorId,
      action: input.action,
      content:
        input.action === 'COMMERCIAL_REVISION_CREATED'
          ? 'Создана новая коммерческая ревизия подсистемы'
          : 'Создан коммерческий расчёт подсистемы',
      metadata: {
        commercialId: created.id,
        revision: created.revision,
        technicalRevision: input.technical.revision,
        hidePurchase: true,
      },
    });
    return created;
  }

  private computeItem(
    item: {
      id: string;
      technicalItemId?: string | null;
      materialId: string | null;
      materialCode: string;
      materialName: string;
      materialSnapshot: Prisma.JsonValue | Record<string, unknown>;
      category: string;
      unit: string;
      finalQty: Prisma.Decimal;
      excludedFromSubsystemCommercialCost: boolean;
      selectedOfferId: string | null;
      sortOrder: number;
    },
    selectedOfferId: string | null,
    offerById: Map<string, OfferRow>,
    _proposedCurrency: string | null,
  ): CommercialLine {
    const excluded =
      item.excludedFromSubsystemCommercialCost || this.isHplReference(item);
    if (excluded) {
      return {
        ...item,
        selectedOfferId: null,
        offerSnapshot: null,
        purchasePrice: null,
        purchaseCurrency: null,
        linePurchaseTotal: null,
        priceStatus: FACADE_PRICE_STATUS.EXCLUDED as FacadePriceStatus,
        fxFromCurrency: null,
        fxToCurrency: null,
        fxRate: null,
        fxRateId: null,
        fxEffectiveFrom: null,
        convertedAmount: null,
        convertedCurrency: null,
      };
    }

    const offer = selectedOfferId ? offerById.get(selectedOfferId) : null;
    if (!selectedOfferId || !offer || !offer.isActive) {
      return {
        ...item,
        selectedOfferId: null,
        offerSnapshot: null,
        purchasePrice: null,
        purchaseCurrency: null,
        linePurchaseTotal: null,
        priceStatus: FACADE_PRICE_STATUS.NOT_CONFIGURED as FacadePriceStatus,
        fxFromCurrency: null,
        fxToCurrency: null,
        fxRate: null,
        fxRateId: null,
        fxEffectiveFrom: null,
        convertedAmount: null,
        convertedCurrency: null,
      };
    }

    const purchasePrice = toDecimal(offer.purchasePrice);
    const linePurchaseTotal = toDecimal(item.finalQty).mul(purchasePrice);
    return {
      ...item,
      selectedOfferId: offer.id,
      offerSnapshot: {
        offerId: offer.id,
        supplierId: offer.supplierId,
        supplierName: offer.supplier.name,
        supplierCode: offer.supplier.code,
        materialId: offer.materialId,
        materialCode: offer.material.code,
        unit: offer.unit,
        purchasePrice: purchasePrice.toFixed(),
        currency: offer.currency,
        validFrom: offer.validFrom.toISOString(),
        validTo: offer.validTo?.toISOString() ?? null,
        availability: offer.availability,
        leadTimeDays: offer.leadTimeDays,
        supplierSku: offer.supplierSku,
        note: offer.note,
        isActive: offer.isActive,
      },
      purchasePrice,
      purchaseCurrency: offer.currency,
      linePurchaseTotal,
      priceStatus: purchasePrice.eq(0)
        ? FACADE_PRICE_STATUS.ZERO
        : FACADE_PRICE_STATUS.CONFIGURED,
      fxFromCurrency: null,
      fxToCurrency: null,
      fxRate: null,
      fxRateId: null,
      fxEffectiveFrom: null,
      convertedAmount: null,
      convertedCurrency: null,
    };
  }

  private async applyFx(
    items: CommercialLine[],
    proposedCurrency: string | null,
  ): Promise<CommercialLine[]> {
    if (!proposedCurrency) {
      return items;
    }
    const cache = new Map<string, FxLookup>();
    const result: CommercialLine[] = [];
    for (const item of items) {
      if (
        item.excludedFromSubsystemCommercialCost ||
        !item.purchaseCurrency ||
        !item.linePurchaseTotal
      ) {
        result.push(item);
        continue;
      }
      const key = `${item.purchaseCurrency}:${proposedCurrency}`;
      let fx = cache.get(key);
      if (!fx) {
        fx = await this.lookupRate(item.purchaseCurrency, proposedCurrency);
        cache.set(key, fx);
      }
      if (fx.missing) {
        result.push({
          ...item,
          fxFromCurrency: fx.fromCurrency,
          fxToCurrency: fx.toCurrency,
          fxRate: null,
          fxRateId: null,
          fxEffectiveFrom: null,
          convertedAmount: null,
          convertedCurrency: null,
        });
        continue;
      }
      result.push({
        ...item,
        fxFromCurrency: fx.fromCurrency,
        fxToCurrency: fx.toCurrency,
        fxRate: fx.rate,
        fxRateId: fx.rateId,
        fxEffectiveFrom: fx.effectiveFrom,
        convertedAmount: item.linePurchaseTotal.mul(fx.rate),
        convertedCurrency: proposedCurrency,
      });
    }
    return result;
  }

  private async lookupRate(fromCurrency: string, toCurrency: string): Promise<FxLookup> {
    if (fromCurrency === toCurrency) {
      return {
        fromCurrency,
        toCurrency,
        rate: toDecimal(1),
        rateId: null,
        effectiveFrom: null,
        identity: true,
        missing: false,
      };
    }
    const at = new Date();
    const row = await this.prisma.currencyRate.findFirst({
      where: {
        fromCurrency,
        toCurrency,
        effectiveFrom: { lte: at },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (!row || toDecimal(row.rate).lte(0)) {
      return {
        fromCurrency,
        toCurrency,
        rate: toDecimal(0),
        rateId: null,
        effectiveFrom: null,
        identity: false,
        missing: true,
      };
    }
    return {
      fromCurrency,
      toCurrency,
      rate: toDecimal(row.rate),
      rateId: row.id,
      effectiveFrom: row.effectiveFrom,
      identity: false,
      missing: false,
    };
  }

  private summarizeProcurement(items: CommercialLine[]) {
    const byCurrencyMap = new Map<string, Prisma.Decimal>();
    const fxSnapshots: Array<Record<string, unknown>> = [];
    let missingPrice = 0;
    let missingFx = 0;
    for (const item of items) {
      if (item.excludedFromSubsystemCommercialCost) {
        continue;
      }
      if (
        item.priceStatus === FACADE_PRICE_STATUS.NOT_CONFIGURED ||
        item.linePurchaseTotal === null
      ) {
        missingPrice += 1;
        continue;
      }
      const currency = item.purchaseCurrency ?? 'UNKNOWN';
      byCurrencyMap.set(
        currency,
        (byCurrencyMap.get(currency) ?? toDecimal(0)).plus(item.linePurchaseTotal),
      );
      if (item.fxFromCurrency && item.fxToCurrency && item.fxFromCurrency !== item.fxToCurrency) {
        if (!item.fxRate) {
          missingFx += 1;
        } else {
          fxSnapshots.push({
            fromCurrency: item.fxFromCurrency,
            toCurrency: item.fxToCurrency,
            rate: item.fxRate.toFixed(),
            rateId: item.fxRateId,
            effectiveFrom: item.fxEffectiveFrom?.toISOString() ?? null,
            materialCode: item.materialCode,
          });
        }
      }
    }
    return {
      incomplete: missingPrice > 0 || missingFx > 0,
      missingPrice,
      missingFx,
      byCurrency: [...byCurrencyMap.entries()].map(([currency, amount]) => ({
        currency,
        amount: amount.toFixed(),
      })),
      fxSnapshots,
    };
  }

  private toItemCreate(
    item: CommercialLine,
  ): Prisma.FacadeCommercialCalculationItemCreateWithoutCommercialCalculationInput {
    return {
      technicalItemId: item.technicalItemId ?? item.id,
      materialId: item.materialId,
      materialCode: item.materialCode,
      materialName: item.materialName,
      materialSnapshot: item.materialSnapshot as Prisma.InputJsonValue,
      category: item.category,
      unit: item.unit,
      finalQty: item.finalQty,
      excludedFromSubsystemCommercialCost: item.excludedFromSubsystemCommercialCost,
      selectedOfferId: item.selectedOfferId,
      offerSnapshot: (item.offerSnapshot ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      purchasePrice: item.purchasePrice,
      purchaseCurrency: item.purchaseCurrency,
      linePurchaseTotal: item.linePurchaseTotal,
      priceStatus: item.priceStatus,
      fxFromCurrency: item.fxFromCurrency,
      fxToCurrency: item.fxToCurrency,
      fxRate: item.fxRate,
      fxRateId: item.fxRateId,
      fxEffectiveFrom: item.fxEffectiveFrom,
      convertedAmount: item.convertedAmount,
      convertedCurrency: item.convertedCurrency,
      sortOrder: item.sortOrder,
    };
  }

  private assertReadyForApproval(commercial: CommercialWithItems): void {
    const included = commercial.items.filter(
      (item) => !item.excludedFromSubsystemCommercialCost,
    );
    const missingPrice = included.filter(
      (item) =>
        item.priceStatus === FACADE_PRICE_STATUS.NOT_CONFIGURED ||
        item.linePurchaseTotal === null,
    );
    if (missingPrice.length > 0) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        'FACADE_PROCUREMENT_INCOMPLETE',
        'Нельзя утверждать стоимость: не задана закупочная цена обязательной позиции',
        { missingPriceCount: missingPrice.length },
      );
    }
    const missingFx = included.filter(
      (item) =>
        item.purchaseCurrency &&
        commercial.proposedCurrency &&
        item.purchaseCurrency !== commercial.proposedCurrency &&
        !item.fxRate,
    );
    if (missingFx.length > 0) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        'FACADE_FX_INCOMPLETE',
        'Нельзя утверждать стоимость: отсутствует курс валют',
        { missingFxCount: missingFx.length },
      );
    }
    if (
      !commercial.proposedCustomerAmount ||
      toDecimal(commercial.proposedCustomerAmount).lte(0)
    ) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        'FACADE_CUSTOMER_AMOUNT_REQUIRED',
        'Укажите клиентскую стоимость подсистемы больше 0',
      );
    }
    if (!commercial.proposedCurrency) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        'FACADE_CUSTOMER_CURRENCY_REQUIRED',
        'Укажите валюту клиентской стоимости подсистемы',
      );
    }
  }

  private assertTechnicalSnapshotExists(
    commercial: CommercialWithItems,
    technical: TechnicalCalculation | null,
  ): void {
    if (!technical) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        'FACADE_TECHNICAL_SNAPSHOT_MISSING',
        'Нет технического снимка для коммерческого расчёта',
      );
    }
    if (commercial.facadeCalculationId !== technical.id) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        'FACADE_TECHNICAL_SNAPSHOT_MISSING',
        'Нет технического снимка для коммерческого расчёта',
      );
    }
  }

  private isHplReference(item: { category: string; materialCode: string }): boolean {
    return (
      item.category === 'HPL' || item.materialCode === HPL_REFERENCE_MATERIAL_CODE
    );
  }

  private technicalSnapshot(technical: TechnicalCalculation) {
    return {
      facadeCalculationId: technical.id,
      facadeCalculationRevision: technical.revision,
      leadId: technical.leadId,
      claddingAreaM2: toDecimal(technical.claddingAreaM2 ?? 0).toFixed(),
      configCode: technical.config.code,
      normSetCode: technical.normSet?.code ?? null,
      items: technical.items.map((item) => ({
        id: item.id,
        materialId: item.materialId,
        materialCode: item.materialCode,
        materialName: item.materialName,
        category: item.category,
        unit: item.unit,
        finalQty: toDecimal(item.finalQty).toFixed(),
        excludedFromSubsystemCommercialCost: this.isHplReference(item),
      })),
    };
  }

  private async loadLeadContext(leadId: string, user: CurrentUser) {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, deletedAt: null },
      select: {
        id: true,
        ownerId: true,
        title: true,
        qualification: { select: { ventFacadeKitRequired: true } },
      },
    });
    if (!lead) {
      throw new BusinessException(
        HttpStatus.NOT_FOUND,
        'LEAD_NOT_FOUND',
        'Лид не найден',
      );
    }
    const ownerAccess = hasOwnerOrReadAllLeadAccess(
      lead,
      user.id,
      user.permissions,
    );
    const pricingAccess =
      user.permissions.includes(FACADE_PRICING_PERMISSIONS.PREPARE) ||
      user.permissions.includes(FACADE_PRICING_PERMISSIONS.APPROVE) ||
      user.permissions.includes(FACADE_PRICING_PERMISSIONS.READ_PURCHASE);
    if (!ownerAccess && !pricingAccess) {
      throw new BusinessException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Нет доступа к коммерческому расчёту подсистемы',
      );
    }
    const technical = await this.prisma.facadeSubsystemCalculation.findUnique({
      where: { leadId },
      include: {
        items: { orderBy: { sortOrder: 'asc' } },
        config: true,
        normSet: true,
      },
    });
    return { lead, technical };
  }

  private async requireCurrent(leadId: string) {
    const commercial = await this.prisma.facadeCommercialCalculation.findFirst({
      where: { leadId, isCurrent: true },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!commercial) {
      throw new BusinessException(
        HttpStatus.NOT_FOUND,
        'FACADE_COMMERCIAL_NOT_FOUND',
        'Коммерческий расчёт подсистемы ещё не создан',
      );
    }
    return commercial;
  }

  private assertMutable(commercial: { status: FacadeCommercialStatus }): void {
    if (commercial.status === FacadeCommercialStatus.APPROVED) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        'FACADE_COMMERCIAL_IMMUTABLE',
        'Утверждённый коммерческий расчёт нельзя изменить. Создайте новую ревизию.',
      );
    }
  }

  private assertCommercialRevision(
    commercial: { revision: number },
    expected: number,
  ): void {
    if (commercial.revision !== expected) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        'FACADE_COMMERCIAL_REVISION_CONFLICT',
        'Коммерческий расчёт уже изменён. Обновите данные и повторите действие.',
        { currentRevision: commercial.revision },
      );
    }
  }

  private assertTechnicalReady(
    technical: TechnicalCalculation | null,
  ): asserts technical is TechnicalCalculation {
    if (!technical || technical.status !== FacadeCalculationStatus.CALCULATED) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        'FACADE_TECHNICAL_NOT_READY',
        'Сначала выполните технический расчёт подсистемы',
      );
    }
  }

  private assertPrepare(user: CurrentUser): void {
    if (!user.permissions.includes(FACADE_PRICING_PERMISSIONS.PREPARE)) {
      throw new BusinessException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Нет права готовить коммерческую стоимость подсистемы',
      );
    }
  }

  private assertApprove(user: CurrentUser): void {
    if (!user.permissions.includes(FACADE_PRICING_PERMISSIONS.APPROVE)) {
      throw new BusinessException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Нет права утверждать стоимость подсистемы',
      );
    }
  }

  private resolveAccess(user: CurrentUser, ownerId: string) {
    const canReadPurchase = user.permissions.includes(
      FACADE_PRICING_PERMISSIONS.READ_PURCHASE,
    );
    const canPrepare = user.permissions.includes(
      FACADE_PRICING_PERMISSIONS.PREPARE,
    );
    const canApprove = user.permissions.includes(
      FACADE_PRICING_PERMISSIONS.APPROVE,
    );
    const canViewCustomer =
      canPrepare ||
      canApprove ||
      hasOwnerOrReadAllLeadAccess({ ownerId }, user.id, user.permissions);
    return {
      canView: canViewCustomer || canReadPurchase,
      canReadPurchase,
      canPrepare,
      canApprove,
      canViewCustomer,
    };
  }

  private approverRoleSnapshot(user: CurrentUser): string {
    if (user.roles.includes(RoleName.DIRECTOR)) {
      return RoleName.DIRECTOR;
    }
    if (user.roles.includes(RoleName.HEAD)) {
      return RoleName.HEAD;
    }
    return user.roles[0] ?? 'UNKNOWN';
  }

  private parsePositiveAmount(raw: string, allowZero: boolean): Prisma.Decimal {
    try {
      const value = toDecimal(raw.trim());
      if (!value.isFinite() || value.lt(0) || (!allowZero && value.lte(0))) {
        throw new Error('invalid');
      }
      return value;
    } catch {
      throw new BusinessException(
        HttpStatus.BAD_REQUEST,
        'FACADE_CUSTOMER_AMOUNT_INVALID',
        'Клиентская стоимость должна быть больше 0',
      );
    }
  }

  private normalizeCurrency(raw: string): string {
    const currency = raw.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new BusinessException(
        HttpStatus.BAD_REQUEST,
        'FACADE_OFFER_CURRENCY_INVALID',
        'Валюта должна быть трёхбуквенным кодом ISO',
      );
    }
    return currency;
  }

  private toWorkspaceView(input: {
    lead: { id: string; ownerId: string };
    technical: TechnicalCalculation | null;
    commercial: CommercialWithItems | null;
    offers: OfferRow[];
    access: ReturnType<FacadeCommercialService['resolveAccess']>;
  }) {
    const staleTechnicalBasis = Boolean(
      input.commercial &&
        input.technical &&
        input.commercial.facadeCalculationRevision !== input.technical.revision,
    );
    return {
      applicable: input.lead ? true : false,
      canPrepare: input.access.canPrepare,
      canApprove: input.access.canApprove,
      canReadPurchase: input.access.canReadPurchase,
      staleTechnicalBasis,
      technicalRevision: input.technical?.revision ?? null,
      currentTechnicalRevision: input.technical?.revision ?? null,
      snapshotTechnicalRevision:
        input.commercial?.facadeCalculationRevision ?? null,
      quoteCreated: input.commercial?.quoteCreated ?? false,
      dealCreated: input.commercial?.dealCreated ?? false,
      offers: input.access.canReadPurchase
        ? input.offers.map((offer) => ({
            id: offer.id,
            materialId: offer.materialId,
            materialCode: offer.material.code,
            supplierId: offer.supplierId,
            supplierName: offer.supplier.name,
            purchasePrice: decimalToString(offer.purchasePrice),
            currency: offer.currency,
            unit: offer.unit,
            isActive: offer.isActive,
            validFrom: offer.validFrom.toISOString(),
            validTo: offer.validTo?.toISOString() ?? null,
            availability: offer.availability,
            leadTimeDays: offer.leadTimeDays,
          }))
        : [],
      calculation: input.commercial
        ? this.toCalculationView(
            input.commercial,
            input.technical,
            input.access,
          )
        : null,
    };
  }

  private toCalculationView(
    commercial: CommercialWithItems,
    technical: TechnicalCalculation | null,
    access: ReturnType<FacadeCommercialService['resolveAccess']>,
  ) {
    const staleTechnicalBasis = Boolean(
      technical &&
        commercial.facadeCalculationRevision !== technical.revision,
    );
    const showPurchase = access.canReadPurchase;
    const showCustomer =
      access.canPrepare ||
      access.canApprove ||
      commercial.status === FacadeCommercialStatus.APPROVED;
    const snapshot = commercial.technicalSnapshot as {
      claddingAreaM2?: string;
      configCode?: string;
      normSetCode?: string | null;
    };
    return {
      id: commercial.id,
      leadId: commercial.leadId,
      facadeCalculationId: commercial.facadeCalculationId,
      facadeCalculationRevision: commercial.facadeCalculationRevision,
      revision: commercial.revision,
      status: commercial.status,
      staleTechnicalBasis,
      currentTechnicalRevision: technical?.revision ?? null,
      claddingAreaM2: snapshot.claddingAreaM2 ?? decimalToString(technical?.claddingAreaM2),
      configCode: snapshot.configCode ?? technical?.config.code ?? null,
      normSetCode: snapshot.normSetCode ?? technical?.normSet?.code ?? null,
      procurementIncomplete: showPurchase
        ? commercial.procurementIncomplete
        : null,
      procurementByCurrency: showPurchase
        ? commercial.procurementByCurrency
        : [],
      fxSnapshots: showPurchase ? commercial.fxSnapshots : [],
      proposedCustomerAmount:
        access.canPrepare || access.canApprove
          ? decimalToString(commercial.proposedCustomerAmount)
          : null,
      proposedCurrency:
        access.canPrepare || access.canApprove
          ? commercial.proposedCurrency
          : null,
      approvedCustomerAmount: showCustomer
        ? decimalToString(commercial.approvedCustomerAmount)
        : null,
      approvedCurrency: showCustomer ? commercial.approvedCurrency : null,
      approvedById: showCustomer ? commercial.approvedById : null,
      approvedAt: showCustomer
        ? (commercial.approvedAt?.toISOString() ?? null)
        : null,
      approverRoleSnapshot: showCustomer
        ? commercial.approverRoleSnapshot
        : null,
      commercialNote:
        access.canPrepare || access.canApprove
          ? commercial.commercialNote
          : null,
      quoteCreated: commercial.quoteCreated,
      dealCreated: commercial.dealCreated,
      items: commercial.items.map((item) => ({
        id: item.id,
        materialCode: item.materialCode,
        materialName: item.materialName,
        category: item.category,
        unit: item.unit,
        finalQty: toDecimal(item.finalQty).toFixed(),
        excludedFromSubsystemCommercialCost:
          item.excludedFromSubsystemCommercialCost,
        selectedOfferId: showPurchase ? item.selectedOfferId : null,
        offerSnapshot: showPurchase ? item.offerSnapshot : null,
        purchasePrice: showPurchase
          ? decimalToString(item.purchasePrice)
          : null,
        purchaseCurrency: showPurchase ? item.purchaseCurrency : null,
        linePurchaseTotal: showPurchase
          ? decimalToString(item.linePurchaseTotal)
          : null,
        priceStatus: showPurchase
          ? item.priceStatus
          : item.excludedFromSubsystemCommercialCost
            ? FACADE_PRICE_STATUS.EXCLUDED
            : null,
        fxRate: showPurchase ? decimalToString(item.fxRate) : null,
        fxFromCurrency: showPurchase ? item.fxFromCurrency : null,
        fxToCurrency: showPurchase ? item.fxToCurrency : null,
        sortOrder: item.sortOrder,
      })),
      createdAt: commercial.createdAt.toISOString(),
      updatedAt: commercial.updatedAt.toISOString(),
    };
  }

  private async writeHistory(
    tx: Prisma.TransactionClient | PrismaService,
    input: {
      leadId: string;
      actorId: string;
      action: string;
      content: string;
      metadata: Record<string, unknown>;
    },
  ): Promise<void> {
    await tx.activity.create({
      data: {
        type: ActivityType.STATUS_CHANGED,
        relatedType: 'Lead',
        relatedId: input.leadId,
        authorId: input.actorId,
        content: input.content,
        metadata: {
          action: input.action,
          ...input.metadata,
        },
      },
    });
    await tx.auditLog.create({
      data: {
        userId: input.actorId,
        action: input.action,
        entityType: 'FacadeCommercialCalculation',
        entityId: input.leadId,
        newValue: input.metadata as Prisma.InputJsonValue,
      },
    });
  }

  private async notifyPricingUsers(input: {
    title: string;
    message: string;
    type: string;
    leadId: string;
  }): Promise<void> {
    const users = await this.prisma.user.findMany({
      where: {
        isActive: true,
        OR: [
          {
            roles: {
              some: {
                role: {
                  permissions: {
                    some: {
                      permission: { slug: FACADE_PRICING_PERMISSIONS.PREPARE },
                    },
                  },
                },
              },
            },
          },
          {
            permissions: {
              some: {
                permission: { slug: FACADE_PRICING_PERMISSIONS.PREPARE },
              },
            },
          },
        ],
      },
      select: { id: true },
    });
    for (const user of users) {
      await this.notifySafe({
        userId: user.id,
        title: input.title,
        message: input.message,
        type: input.type,
        leadId: input.leadId,
      });
    }
  }

  private async notifySafe(input: {
    userId: string;
    title: string;
    message: string;
    type: string;
    leadId: string;
  }): Promise<void> {
    try {
      await this.prisma.notification.create({
        data: {
          userId: input.userId,
          title: input.title,
          message: input.message,
          type: input.type,
          relatedType: 'Lead',
          relatedId: input.leadId,
        },
      });
    } catch (error) {
      this.logger.error(
        `Facade pricing notification ${input.type} failed after commit`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}
