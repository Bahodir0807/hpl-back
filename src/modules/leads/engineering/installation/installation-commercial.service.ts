import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  ActivityType,
  InstallationCalculationStatus,
  InstallationCommercialStatus,
  Prisma,
  RoleName,
} from '@prisma/client';
import { BusinessException } from '../../../../common/exceptions/business.exception';
import type { CurrentUser } from '../../../../common/interfaces/current-user.interface';
import { PrismaService } from '../../../prisma/prisma.service';
import { hasOwnerOrReadAllLeadAccess } from '../engineering-access';
import { decimalToString, toDecimal } from '../facade/facade-decimal';
import {
  INSTALLATION_PRICE_STATUS,
  INSTALLATION_PRICING_NOTIFICATION_TYPE,
  INSTALLATION_PRICING_PERMISSIONS,
  type InstallationPriceStatus,
} from './installation-pricing.constants';
import type {
  ApproveInstallationCommercialDto,
  PatchInstallationCommercialDto,
  RepriceInstallationCommercialDto,
  SubmitInstallationCommercialDto,
} from './dto/installation-commercial.dto';

type TechnicalCalculation = Prisma.InstallationCalculationGetPayload<{
  include: { items: true };
}>;

type CommercialWithItems = Prisma.InstallationCommercialCalculationGetPayload<{
  include: { items: true };
}>;

type RateRow = Prisma.InstallationContractorRateGetPayload<{
  include: { contractor: true; workType: true };
}>;

type CommercialLine = {
  id: string;
  technicalItemId?: string | null;
  workTypeId: string | null;
  workTypeCode: string;
  workTypeName: string;
  workTypeSnapshot: Prisma.JsonValue | Record<string, unknown>;
  unit: string;
  quantity: Prisma.Decimal;
  quantitySource: string;
  selectedRateId: string | null;
  rateSnapshot: Record<string, unknown> | null;
  contractorId: string | null;
  contractorName: string | null;
  pricePerUnit: Prisma.Decimal | null;
  currency: string | null;
  lineCostTotal: Prisma.Decimal | null;
  priceStatus: InstallationPriceStatus;
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
export class InstallationCommercialService {
  private readonly logger = new Logger(InstallationCommercialService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getCurrent(leadId: string, user: CurrentUser) {
    const { lead, technical } = await this.loadLeadContext(leadId, user);
    const access = this.resolveAccess(user, lead.ownerId);
    if (!access.canView) {
      throw new BusinessException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Нет доступа к коммерческому расчёту монтажа',
      );
    }

    const commercial =
      await this.prisma.installationCommercialCalculation.findFirst({
        where: { leadId, isCurrent: true },
        include: { items: { orderBy: { sortOrder: 'asc' } } },
      });

    const rates = access.canReadCost
      ? await this.prisma.installationContractorRate.findMany({
          include: { contractor: true, workType: true },
          orderBy: [{ createdAt: 'desc' }],
        })
      : [];

    return this.toWorkspaceView({
      lead,
      technical,
      commercial,
      rates,
      access,
    });
  }

  async createFromTechnical(leadId: string, user: CurrentUser) {
    this.assertPrepare(user);
    const { lead, technical } = await this.loadLeadContext(leadId, user);
    this.assertTechnicalReady(technical);

    const current =
      await this.prisma.installationCommercialCalculation.findFirst({
        where: { leadId, isCurrent: true },
        include: { items: true },
      });
    if (current && current.status !== InstallationCommercialStatus.APPROVED) {
      return this.toCalculationView(
        current,
        technical,
        this.resolveAccess(user, lead.ownerId),
      );
    }

    const created = await this.prisma.$transaction(async (tx) => {
      if (current) {
        await tx.installationCommercialCalculation.update({
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
    dto: PatchInstallationCommercialDto,
    user: CurrentUser,
  ) {
    this.assertPrepare(user);
    const { lead, technical } = await this.loadLeadContext(leadId, user);
    const commercial = await this.requireCurrent(leadId);
    this.assertMutable(commercial);
    this.assertCommercialRevision(commercial, dto.expectedRevision);

    const rates = await this.prisma.installationContractorRate.findMany({
      include: { contractor: true, workType: true },
    });
    const rateById = new Map(rates.map((rate) => [rate.id, rate]));
    const selectionByItem = new Map(
      (dto.selections ?? []).map((item) => [item.itemId, item.rateId ?? null]),
    );

    const nextItems = commercial.items.map((item) => {
      const nextRateId = selectionByItem.has(item.id)
        ? selectionByItem.get(item.id) ?? null
        : item.selectedRateId;
      return this.computeItem(item, nextRateId, rateById);
    });

    const proposedAmount =
      dto.proposedCustomerAmount === undefined
        ? commercial.proposedCustomerAmount
        : dto.proposedCustomerAmount === null || dto.proposedCustomerAmount === ''
          ? null
          : this.parsePositiveAmount(dto.proposedCustomerAmount);
    const proposedCurrency =
      dto.proposedCurrency === undefined
        ? commercial.proposedCurrency
        : dto.proposedCurrency
          ? this.normalizeCurrency(dto.proposedCurrency)
          : null;

    const priced = await this.applyFx(nextItems, proposedCurrency);
    const cost = this.summarizeCost(priced);

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.installationCommercialCalculationItem.deleteMany({
        where: { commercialCalculationId: commercial.id },
      });
      const saved = await tx.installationCommercialCalculation.update({
        where: { id: commercial.id },
        data: {
          status: InstallationCommercialStatus.DRAFT,
          costIncomplete: cost.incomplete,
          costByCurrency: cost.byCurrency as Prisma.InputJsonValue,
          fxSnapshots: cost.fxSnapshots as Prisma.InputJsonValue,
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
        action: 'INSTALLATION_COMMERCIAL_UPDATED',
        content: 'Обновлён коммерческий расчёт монтажа',
        metadata: {
          commercialId: saved.id,
          revision: saved.revision,
          hideCost: true,
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
    dto: SubmitInstallationCommercialDto,
    user: CurrentUser,
  ) {
    this.assertPrepare(user);
    const { lead, technical } = await this.loadLeadContext(leadId, user);
    const commercial = await this.requireCurrent(leadId);
    this.assertMutable(commercial);
    this.assertCommercialRevision(commercial, dto.expectedRevision);
    this.assertReadyForApproval(commercial);

    const updated = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.installationCommercialCalculation.update({
        where: { id: commercial.id },
        data: {
          status: InstallationCommercialStatus.READY_FOR_APPROVAL,
          revision: { increment: 1 },
        },
        include: { items: { orderBy: { sortOrder: 'asc' } } },
      });
      await this.writeHistory(tx, {
        leadId,
        actorId: user.id,
        action: 'INSTALLATION_COMMERCIAL_SUBMITTED',
        content: 'Коммерческий расчёт монтажа отправлен на утверждение',
        metadata: {
          commercialId: saved.id,
          revision: saved.revision,
          hideCost: true,
        },
      });
      return saved;
    });

    await this.notifyPricingUsers({
      title: 'Стоимость монтажа ожидает утверждения',
      message: `Лид «${lead.title}»: клиентская стоимость монтажа готова к утверждению.`,
      type: INSTALLATION_PRICING_NOTIFICATION_TYPE.READY_FOR_APPROVAL,
      leadId,
    });

    return this.toCalculationView(
      updated,
      technical,
      this.resolveAccess(user, lead.ownerId),
    );
  }

  async approve(
    leadId: string,
    dto: ApproveInstallationCommercialDto,
    user: CurrentUser,
  ) {
    this.assertApprove(user);
    const { lead, technical } = await this.loadLeadContext(leadId, user);
    const commercial = await this.requireCurrent(leadId);
    this.assertCommercialRevision(commercial, dto.expectedRevision);
    if (commercial.status === InstallationCommercialStatus.APPROVED) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        'INSTALLATION_COMMERCIAL_ALREADY_APPROVED',
        'Коммерческий расчёт монтажа уже утверждён',
        {
          approvedById: commercial.approvedById,
          approvedAt: commercial.approvedAt,
        },
      );
    }
    if (commercial.status !== InstallationCommercialStatus.READY_FOR_APPROVAL) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        'INSTALLATION_COMMERCIAL_NOT_READY',
        'Коммерческий расчёт монтажа ещё не готов к утверждению',
      );
    }
    this.assertReadyForApproval(commercial);
    this.assertTechnicalSnapshotExists(commercial, technical);

    const roleSnapshot = this.approverRoleSnapshot(user);
    const updated = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.installationCommercialCalculation.update({
        where: { id: commercial.id },
        data: {
          status: InstallationCommercialStatus.APPROVED,
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
            ? 'INSTALLATION_COMMERCIAL_APPROVED_BY_DIRECTOR'
            : 'INSTALLATION_COMMERCIAL_APPROVED_BY_HEAD',
        content: 'Утверждена клиентская стоимость монтажа',
        metadata: {
          commercialId: saved.id,
          revision: saved.revision,
          approvedCurrency: saved.approvedCurrency,
          approverRoleSnapshot: roleSnapshot,
          hideCost: true,
        },
      });
      return saved;
    });

    await this.notifySafe({
      userId: lead.ownerId,
      title: 'Утверждена стоимость монтажа',
      message: 'Клиентская стоимость монтажных работ утверждена.',
      type: INSTALLATION_PRICING_NOTIFICATION_TYPE.APPROVED,
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
    dto: RepriceInstallationCommercialDto,
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
      await tx.installationCommercialCalculation.update({
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
    technicalStatus: InstallationCalculationStatus,
    actorId?: string,
  ): Promise<void> {
    try {
      const commercial =
        await this.prisma.installationCommercialCalculation.findFirst({
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
        technicalStatus === InstallationCalculationStatus.READY &&
        !commercial
      ) {
        await this.notifyPricingUsers({
          title: 'Технический расчёт монтажа готов',
          message: `Лид «${lead.title}»: технический расчёт монтажа готов к коммерческой подготовке.`,
          type: INSTALLATION_PRICING_NOTIFICATION_TYPE.TECHNICAL_READY,
          leadId,
        });
        return;
      }

      if (
        commercial?.status === InstallationCommercialStatus.APPROVED &&
        commercial.installationCalculationRevision !== technicalRevision
      ) {
        await this.writeHistory(this.prisma, {
          leadId,
          actorId: actorId ?? lead.ownerId,
          action: 'INSTALLATION_TECHNICAL_NEWER_THAN_COMMERCIAL',
          content: 'Технический расчёт монтажа изменён после утверждения',
          metadata: {
            commercialId: commercial.id,
            commercialRevision: commercial.revision,
            technicalRevision,
            hideCost: true,
          },
        });
        await this.notifyPricingUsers({
          title: 'Технический расчёт монтажа изменился после утверждения',
          message: `Лид «${lead.title}»: объёмы монтажа изменены после утверждённой коммерческой версии.`,
          type: INSTALLATION_PRICING_NOTIFICATION_TYPE.STALE_TECHNICAL,
          leadId,
        });
      }
    } catch (error) {
      this.logger.error(
        'Installation commercial technical-revision hook failed',
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
    const last = await tx.installationCommercialCalculation.findFirst({
      where: { leadId: input.leadId },
      orderBy: { revision: 'desc' },
      select: { revision: true },
    });
    const previousByCode = new Map(
      (input.previous?.items ?? []).map((item) => [item.workTypeCode, item]),
    );
    const rates = await tx.installationContractorRate.findMany({
      include: { contractor: true, workType: true },
    });
    const rateById = new Map(rates.map((rate) => [rate.id, rate]));
    const draftItems = input.technical.items.map((item) => {
      const previous = previousByCode.get(item.workTypeCode);
      const selectedRateId =
        previous?.selectedRateId &&
        this.isSelectableRate(rateById.get(previous.selectedRateId), item.unit)
          ? previous.selectedRateId
          : null;
      return this.computeItem(
        {
          id: item.id,
          technicalItemId: item.id,
          workTypeId: item.workTypeId,
          workTypeCode: item.workTypeCode,
          workTypeName: item.workTypeName,
          workTypeSnapshot: item.workTypeSnapshot,
          unit: item.unit,
          quantity: item.quantity,
          quantitySource: item.quantitySource,
          selectedRateId,
          sortOrder: item.sortOrder,
        },
        selectedRateId,
        rateById,
      );
    });
    const priced = await this.applyFx(
      draftItems,
      input.previous?.proposedCurrency ?? null,
    );
    const cost = this.summarizeCost(priced);

    const created = await tx.installationCommercialCalculation.create({
      data: {
        leadId: input.leadId,
        installationCalculationId: input.technical.id,
        installationCalculationRevision: input.technical.revision,
        revision: (last?.revision ?? 0) + 1,
        isCurrent: true,
        status: InstallationCommercialStatus.DRAFT,
        technicalSnapshot: this.technicalSnapshot(
          input.technical,
        ) as Prisma.InputJsonValue,
        costIncomplete: cost.incomplete,
        costByCurrency: cost.byCurrency as Prisma.InputJsonValue,
        fxSnapshots: cost.fxSnapshots as Prisma.InputJsonValue,
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
          ? 'Создана новая коммерческая ревизия монтажа'
          : 'Создан коммерческий расчёт монтажа',
      metadata: {
        commercialId: created.id,
        revision: created.revision,
        technicalRevision: input.technical.revision,
        hideCost: true,
      },
    });
    return created;
  }

  private computeItem(
    item: {
      id: string;
      technicalItemId?: string | null;
      workTypeId: string | null;
      workTypeCode: string;
      workTypeName: string;
      workTypeSnapshot: Prisma.JsonValue | Record<string, unknown>;
      unit: string;
      quantity: Prisma.Decimal;
      quantitySource: string;
      selectedRateId: string | null;
      sortOrder: number;
    },
    selectedRateId: string | null,
    rateById: Map<string, RateRow>,
  ): CommercialLine {
    const rate = selectedRateId ? rateById.get(selectedRateId) : null;
    if (!selectedRateId || !rate || !this.isSelectableRate(rate, item.unit)) {
      if (rate && rate.unit !== item.unit) {
        return {
          ...item,
          selectedRateId: rate.id,
          rateSnapshot: this.rateSnapshot(rate),
          contractorId: rate.contractorId,
          contractorName: rate.contractor.name,
          pricePerUnit: toDecimal(rate.pricePerUnit),
          currency: rate.currency,
          lineCostTotal: null,
          priceStatus: INSTALLATION_PRICE_STATUS.INCOMPATIBLE_UNIT,
          fxFromCurrency: null,
          fxToCurrency: null,
          fxRate: null,
          fxRateId: null,
          fxEffectiveFrom: null,
          convertedAmount: null,
          convertedCurrency: null,
        };
      }
      return {
        ...item,
        selectedRateId: null,
        rateSnapshot: null,
        contractorId: null,
        contractorName: null,
        pricePerUnit: null,
        currency: null,
        lineCostTotal: null,
        priceStatus: INSTALLATION_PRICE_STATUS.NOT_CONFIGURED,
        fxFromCurrency: null,
        fxToCurrency: null,
        fxRate: null,
        fxRateId: null,
        fxEffectiveFrom: null,
        convertedAmount: null,
        convertedCurrency: null,
      };
    }

    const pricePerUnit = toDecimal(rate.pricePerUnit);
    const lineCostTotal = toDecimal(item.quantity).mul(pricePerUnit);
    return {
      ...item,
      selectedRateId: rate.id,
      rateSnapshot: this.rateSnapshot(rate),
      contractorId: rate.contractorId,
      contractorName: rate.contractor.name,
      pricePerUnit,
      currency: rate.currency,
      lineCostTotal,
      priceStatus: pricePerUnit.eq(0)
        ? INSTALLATION_PRICE_STATUS.ZERO
        : INSTALLATION_PRICE_STATUS.CONFIGURED,
      fxFromCurrency: null,
      fxToCurrency: null,
      fxRate: null,
      fxRateId: null,
      fxEffectiveFrom: null,
      convertedAmount: null,
      convertedCurrency: null,
    };
  }

  private isSelectableRate(
    rate: RateRow | undefined,
    itemUnit: string,
  ): rate is RateRow {
    if (!rate || !rate.isActive || !rate.contractor.isActive) {
      return false;
    }
    const now = new Date();
    if (rate.validFrom > now) {
      return false;
    }
    if (rate.validTo && rate.validTo <= now) {
      return false;
    }
    return rate.unit === itemUnit;
  }

  private rateSnapshot(rate: RateRow): Record<string, unknown> {
    return {
      rateId: rate.id,
      contractorId: rate.contractorId,
      contractorName: rate.contractor.name,
      contractorType: rate.contractor.type,
      workTypeId: rate.workTypeId,
      workTypeCode: rate.workType.code,
      unit: rate.unit,
      pricePerUnit: toDecimal(rate.pricePerUnit).toFixed(),
      currency: rate.currency,
      validFrom: rate.validFrom.toISOString(),
      validTo: rate.validTo?.toISOString() ?? null,
      isActive: rate.isActive,
      note: rate.note,
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
      if (!item.currency || !item.lineCostTotal) {
        result.push(item);
        continue;
      }
      const key = `${item.currency}:${proposedCurrency}`;
      let fx = cache.get(key);
      if (!fx) {
        fx = await this.lookupRate(item.currency, proposedCurrency);
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
        convertedAmount: item.lineCostTotal.mul(fx.rate),
        convertedCurrency: proposedCurrency,
      });
    }
    return result;
  }

  private async lookupRate(
    fromCurrency: string,
    toCurrency: string,
  ): Promise<FxLookup> {
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

  private summarizeCost(items: CommercialLine[]) {
    const byCurrencyMap = new Map<string, Prisma.Decimal>();
    const fxSnapshots: Array<Record<string, unknown>> = [];
    let missingRate = 0;
    let missingFx = 0;
    let incompatible = 0;
    for (const item of items) {
      if (
        item.priceStatus === INSTALLATION_PRICE_STATUS.NOT_CONFIGURED ||
        item.lineCostTotal === null
      ) {
        if (item.priceStatus === INSTALLATION_PRICE_STATUS.INCOMPATIBLE_UNIT) {
          incompatible += 1;
        } else {
          missingRate += 1;
        }
        continue;
      }
      const currency = item.currency ?? 'UNKNOWN';
      byCurrencyMap.set(
        currency,
        (byCurrencyMap.get(currency) ?? toDecimal(0)).plus(item.lineCostTotal),
      );
      if (
        item.fxFromCurrency &&
        item.fxToCurrency &&
        item.fxFromCurrency !== item.fxToCurrency
      ) {
        if (!item.fxRate) {
          missingFx += 1;
        } else {
          fxSnapshots.push({
            fromCurrency: item.fxFromCurrency,
            toCurrency: item.fxToCurrency,
            rate: item.fxRate.toFixed(),
            rateId: item.fxRateId,
            effectiveFrom: item.fxEffectiveFrom?.toISOString() ?? null,
            workTypeCode: item.workTypeCode,
          });
        }
      }
    }
    return {
      incomplete: missingRate > 0 || missingFx > 0 || incompatible > 0,
      missingRate,
      missingFx,
      incompatible,
      byCurrency: [...byCurrencyMap.entries()].map(([currency, amount]) => ({
        currency,
        amount: amount.toFixed(),
      })),
      fxSnapshots,
    };
  }

  private toItemCreate(item: CommercialLine) {
    return {
      technicalItemId: item.technicalItemId ?? null,
      workTypeId: item.workTypeId,
      workTypeCode: item.workTypeCode,
      workTypeName: item.workTypeName,
      workTypeSnapshot: item.workTypeSnapshot as Prisma.InputJsonValue,
      unit: item.unit,
      quantity: item.quantity,
      quantitySource: item.quantitySource,
      selectedRateId: item.selectedRateId,
      rateSnapshot: item.rateSnapshot as Prisma.InputJsonValue | undefined,
      contractorId: item.contractorId,
      contractorName: item.contractorName,
      pricePerUnit: item.pricePerUnit,
      currency: item.currency,
      lineCostTotal: item.lineCostTotal,
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
    const missingRate = commercial.items.filter(
      (item) =>
        item.priceStatus === INSTALLATION_PRICE_STATUS.NOT_CONFIGURED ||
        item.priceStatus === INSTALLATION_PRICE_STATUS.INCOMPATIBLE_UNIT,
    );
    if (missingRate.length > 0) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        'INSTALLATION_COST_INCOMPLETE',
        'Нельзя утверждать стоимость: нет тарифа или единицы несовместимы',
        { missingRateCount: missingRate.length },
      );
    }
    const missingFx = commercial.items.filter(
      (item) =>
        item.currency &&
        commercial.proposedCurrency &&
        item.currency !== commercial.proposedCurrency &&
        !item.fxRate,
    );
    if (missingFx.length > 0) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        'INSTALLATION_FX_INCOMPLETE',
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
        'INSTALLATION_CUSTOMER_AMOUNT_REQUIRED',
        'Укажите клиентскую стоимость монтажа больше 0',
      );
    }
    if (!commercial.proposedCurrency) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        'INSTALLATION_CUSTOMER_CURRENCY_REQUIRED',
        'Укажите валюту клиентской стоимости монтажа',
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
        'INSTALLATION_TECHNICAL_SNAPSHOT_MISSING',
        'Нет технического снимка для коммерческого расчёта монтажа',
      );
    }
    if (commercial.installationCalculationId !== technical.id) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        'INSTALLATION_TECHNICAL_SNAPSHOT_MISSING',
        'Нет технического снимка для коммерческого расчёта монтажа',
      );
    }
  }

  private technicalSnapshot(technical: TechnicalCalculation) {
    return {
      installationCalculationId: technical.id,
      installationCalculationRevision: technical.revision,
      leadId: technical.leadId,
      items: technical.items.map((item) => ({
        id: item.id,
        workTypeId: item.workTypeId,
        workTypeCode: item.workTypeCode,
        workTypeName: item.workTypeName,
        unit: item.unit,
        quantity: toDecimal(item.quantity).toFixed(),
        quantitySource: item.quantitySource,
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
        qualification: { select: { installationRequired: true } },
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
      user.permissions.includes(INSTALLATION_PRICING_PERMISSIONS.PREPARE) ||
      user.permissions.includes(INSTALLATION_PRICING_PERMISSIONS.APPROVE) ||
      user.permissions.includes(INSTALLATION_PRICING_PERMISSIONS.READ_COST);
    if (!ownerAccess && !pricingAccess) {
      throw new BusinessException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Нет доступа к коммерческому расчёту монтажа',
      );
    }
    const technical = await this.prisma.installationCalculation.findUnique({
      where: { leadId },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
    return { lead, technical };
  }

  private async requireCurrent(leadId: string) {
    const commercial =
      await this.prisma.installationCommercialCalculation.findFirst({
        where: { leadId, isCurrent: true },
        include: { items: { orderBy: { sortOrder: 'asc' } } },
      });
    if (!commercial) {
      throw new BusinessException(
        HttpStatus.NOT_FOUND,
        'INSTALLATION_COMMERCIAL_NOT_FOUND',
        'Коммерческий расчёт монтажа ещё не создан',
      );
    }
    return commercial;
  }

  private assertMutable(commercial: {
    status: InstallationCommercialStatus;
  }): void {
    if (commercial.status === InstallationCommercialStatus.APPROVED) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        'INSTALLATION_COMMERCIAL_IMMUTABLE',
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
        'INSTALLATION_COMMERCIAL_REVISION_CONFLICT',
        'Коммерческий расчёт уже изменён. Обновите данные и повторите действие.',
        { currentRevision: commercial.revision },
      );
    }
  }

  private assertTechnicalReady(
    technical: TechnicalCalculation | null,
  ): asserts technical is TechnicalCalculation {
    if (!technical || technical.status !== InstallationCalculationStatus.READY) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        'INSTALLATION_TECHNICAL_NOT_READY',
        'Сначала завершите техническую подготовку монтажа',
      );
    }
  }

  private assertPrepare(user: CurrentUser): void {
    if (!user.permissions.includes(INSTALLATION_PRICING_PERMISSIONS.PREPARE)) {
      throw new BusinessException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Нет права готовить коммерческую стоимость монтажа',
      );
    }
  }

  private assertApprove(user: CurrentUser): void {
    if (!user.permissions.includes(INSTALLATION_PRICING_PERMISSIONS.APPROVE)) {
      throw new BusinessException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Нет права утверждать стоимость монтажа',
      );
    }
  }

  private resolveAccess(user: CurrentUser, ownerId: string) {
    const canReadCost = user.permissions.includes(
      INSTALLATION_PRICING_PERMISSIONS.READ_COST,
    );
    const canPrepare = user.permissions.includes(
      INSTALLATION_PRICING_PERMISSIONS.PREPARE,
    );
    const canApprove = user.permissions.includes(
      INSTALLATION_PRICING_PERMISSIONS.APPROVE,
    );
    const canViewCustomer =
      canPrepare ||
      canApprove ||
      hasOwnerOrReadAllLeadAccess({ ownerId }, user.id, user.permissions);
    return {
      canView: canViewCustomer || canReadCost,
      canReadCost,
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

  private parsePositiveAmount(raw: string): Prisma.Decimal {
    try {
      const value = toDecimal(raw.trim());
      if (!value.isFinite() || value.lte(0)) {
        throw new Error('invalid');
      }
      return value;
    } catch {
      throw new BusinessException(
        HttpStatus.BAD_REQUEST,
        'INSTALLATION_CUSTOMER_AMOUNT_INVALID',
        'Клиентская стоимость должна быть больше 0',
      );
    }
  }

  private normalizeCurrency(raw: string): string {
    const currency = raw.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new BusinessException(
        HttpStatus.BAD_REQUEST,
        'INSTALLATION_RATE_CURRENCY_INVALID',
        'Валюта должна быть трёхбуквенным кодом ISO',
      );
    }
    return currency;
  }

  private toWorkspaceView(input: {
    lead: { id: string; ownerId: string; qualification: { installationRequired: boolean | null } | null };
    technical: TechnicalCalculation | null;
    commercial: CommercialWithItems | null;
    rates: RateRow[];
    access: ReturnType<InstallationCommercialService['resolveAccess']>;
  }) {
    const staleTechnicalBasis = Boolean(
      input.commercial &&
        input.technical &&
        input.commercial.installationCalculationRevision !==
          input.technical.revision,
    );
    return {
      applicable: input.lead.qualification?.installationRequired === true,
      canPrepare: input.access.canPrepare,
      canApprove: input.access.canApprove,
      canReadCost: input.access.canReadCost,
      staleTechnicalBasis,
      technicalRevision: input.technical?.revision ?? null,
      currentTechnicalRevision: input.technical?.revision ?? null,
      snapshotTechnicalRevision:
        input.commercial?.installationCalculationRevision ?? null,
      quoteCreated: input.commercial?.quoteCreated ?? false,
      dealCreated: input.commercial?.dealCreated ?? false,
      rates: input.access.canReadCost
        ? input.rates.map((rate) => ({
            id: rate.id,
            contractorId: rate.contractorId,
            contractorName: rate.contractor.name,
            contractorType: rate.contractor.type,
            workTypeId: rate.workTypeId,
            workTypeCode: rate.workType.code,
            unit: rate.unit,
            pricePerUnit: decimalToString(rate.pricePerUnit),
            currency: rate.currency,
            isActive: rate.isActive && rate.contractor.isActive,
            validFrom: rate.validFrom.toISOString(),
            validTo: rate.validTo?.toISOString() ?? null,
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
    access: ReturnType<InstallationCommercialService['resolveAccess']>,
  ) {
    const staleTechnicalBasis = Boolean(
      technical &&
        commercial.installationCalculationRevision !== technical.revision,
    );
    const showCost = access.canReadCost;
    const showCustomer =
      access.canPrepare ||
      access.canApprove ||
      commercial.status === InstallationCommercialStatus.APPROVED;
    return {
      id: commercial.id,
      leadId: commercial.leadId,
      installationCalculationId: commercial.installationCalculationId,
      installationCalculationRevision:
        commercial.installationCalculationRevision,
      revision: commercial.revision,
      status: commercial.status,
      staleTechnicalBasis,
      currentTechnicalRevision: technical?.revision ?? null,
      costIncomplete: showCost ? commercial.costIncomplete : null,
      costByCurrency: showCost ? commercial.costByCurrency : [],
      fxSnapshots: showCost ? commercial.fxSnapshots : [],
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
        workTypeCode: item.workTypeCode,
        workTypeName: item.workTypeName,
        unit: item.unit,
        quantity: toDecimal(item.quantity).toFixed(),
        quantitySource: item.quantitySource,
        selectedRateId: showCost ? item.selectedRateId : null,
        rateSnapshot: showCost ? item.rateSnapshot : null,
        contractorId: showCost ? item.contractorId : null,
        contractorName: showCost ? item.contractorName : null,
        pricePerUnit: showCost ? decimalToString(item.pricePerUnit) : null,
        currency: showCost ? item.currency : null,
        lineCostTotal: showCost ? decimalToString(item.lineCostTotal) : null,
        priceStatus: showCost ? item.priceStatus : null,
        fxRate: showCost ? decimalToString(item.fxRate) : null,
        fxFromCurrency: showCost ? item.fxFromCurrency : null,
        fxToCurrency: showCost ? item.fxToCurrency : null,
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
        entityType: 'InstallationCommercialCalculation',
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
                      permission: {
                        slug: INSTALLATION_PRICING_PERMISSIONS.PREPARE,
                      },
                    },
                  },
                },
              },
            },
          },
          {
            permissions: {
              some: {
                permission: {
                  slug: INSTALLATION_PRICING_PERMISSIONS.PREPARE,
                },
              },
            },
          },
        ],
      },
      select: { id: true },
    });
    const unique = new Map(users.map((user) => [user.id, user]));
    for (const user of unique.values()) {
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
        `Installation pricing notification ${input.type} failed after commit`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}
