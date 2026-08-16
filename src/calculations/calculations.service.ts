import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ActivityType,
  CalculationSession,
  CommercialQualificationStatus,
  HplApplication,
  Lead,
  LeadQualification,
  LeadStatus,
  Prisma,
} from '@prisma/client';
import { BusinessException } from '../common/exceptions/business.exception';
import type { CurrentUser } from '../common/interfaces/current-user.interface';
import { panelTypeCodeForApplication } from '../panels/pricing/hpl-quality-matrix';
import { PanelPriceCalculator } from '../panels/services/panel-price-calculator.service';
import { PanelQuantityCalculator } from '../panels/services/panel-quantity-calculator.service';
import { CurrencyRateService } from '../panels/services/currency-rate.service';
import {
  HPL_SELLING_COEFFICIENT,
  HPL_SELLING_CURRENCY,
} from '../panels/pricing/hpl-pricing.constants';
import { PrismaService } from '../modules/prisma/prisma.service';
import { assertStage1QualificationComplete } from '../modules/leads/lead-qualification.rules';
import {
  CALCULATION_PERMISSIONS,
  CALCULATION_STATUS,
  LEADS_READ_ALL_PERMISSION,
} from './calculation.constants';
import {
  CalculationItemDto,
  PreviewCalculationDto,
  resolveThicknessMm,
} from './dto/calculation-item.dto';
import { CreateCalculationDto } from './dto/create-calculation.dto';
import { FilterCalculationsDto } from './dto/filter-calculations.dto';
import { UpdateCalculationDto } from './dto/update-calculation.dto';

const calculationInclude = Prisma.validator<Prisma.CalculationSessionInclude>()({
  items: {
    orderBy: { sortOrder: 'asc' },
    include: {
      panelType: { select: { code: true, displayNameRu: true } },
      panelSize: { select: { displayName: true, areaM2: true } },
      supplier: { select: { code: true, name: true } },
      qualityClass: { select: { code: true, nameRu: true } },
      color: { select: { colorCode: true, colorName: true } },
    },
  },
});

export type CalculationWithItems = Prisma.CalculationSessionGetPayload<{
  include: typeof calculationInclude;
}>;

type CalculatedLineItem = {
  panelTypeId: string;
  panelSizeId: string;
  thicknessMm: number;
  supplierId: string;
  qualityClassId: string;
  colorId: string | null;
  requiredAreaM2: Prisma.Decimal;
  sheetsCount: number;
  supplierPricePerM2: Prisma.Decimal;
  clientPricePerM2: Prisma.Decimal;
  pricePerM2: Prisma.Decimal;
  pricePerSheet: Prisma.Decimal;
  totalPrice: Prisma.Decimal;
  wastePercent: Prisma.Decimal;
  sortOrder: number;
  areaM2: Prisma.Decimal;
};

type LeadForHplCalculation = Lead & {
  qualification: LeadQualification | null;
  commercialQualification: {
    supplierId: string;
    qualityClassId: string;
    status: CommercialQualificationStatus;
    confirmedAt: Date;
  } | null;
};

type CommercialDecision = {
  supplierId: string;
  qualityClassId: string;
  confirmedAt: Date;
};

type ResolvedCalculationItem = {
  panelTypeId: string;
  panelSizeId: string;
  thicknessMm: number;
  supplierId: string;
  qualityClassId: string;
  colorId?: string;
  requiredAreaM2: string;
};

@Injectable()
export class CalculationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quantityCalc: PanelQuantityCalculator,
    private readonly priceCalc: PanelPriceCalculator,
    private readonly currencyRateService: CurrencyRateService,
  ) {}

  async create(
    dto: CreateCalculationDto,
    user: CurrentUser,
  ): Promise<CalculationWithItems> {
    const lead = await this.guardLeadForHplCalculation(dto.leadId, user);
    const commercial = this.requireCommercialDecision(lead);
    const items = this.deriveCalculationItems(
      dto.items,
      lead.qualification,
      commercial,
    );
    const cnyUsdRate = await this.currencyRateService.getActiveCnyUsdRate();
    const calculatedItems = await this.calculateItems(
      items,
      cnyUsdRate,
      lead.qualification?.application,
    );

    return this.prisma.$transaction(async (tx) => {
      const totalAmount = calculatedItems.reduce(
        (sum, item) => sum.plus(item.totalPrice),
        new Prisma.Decimal(0),
      );

      const session = await tx.calculationSession.create({
        data: {
          leadId: dto.leadId,
          clientId: lead.clientId,
          projectObjectId: lead.projectObjectId,
          dealId: lead.dealId,
          createdById: user.id,
          status: CALCULATION_STATUS.DRAFT,
          totalAmount: totalAmount.toDecimalPlaces(2),
          displayCurrency: HPL_SELLING_CURRENCY,
          cnyUsdRate,
          sellingCoefficient: HPL_SELLING_COEFFICIENT,
          notes: dto.notes,
          commercialSupplierId: commercial.supplierId,
          commercialQualityClassId: commercial.qualityClassId,
          commercialConfirmedAt: commercial.confirmedAt,
          items: {
            create: calculatedItems.map(({ areaM2: _areaM2, ...item }) => item),
          },
        },
        include: calculationInclude,
      });

      await tx.activity.create({
        data: {
          type: ActivityType.CALCULATION,
          relatedType: 'Lead',
          relatedId: dto.leadId,
          authorId: user.id,
          metadata: {
            calculationId: session.id,
            totalAmount: session.totalAmount?.toString(),
            action: 'calculation_created',
          },
        },
      });

      return session;
    });
  }

  async findAll(
    filter: FilterCalculationsDto,
    user: CurrentUser,
  ): Promise<{
    items: CalculationWithItems[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = filter.page ?? 1;
    const limit = filter.limit ?? 20;

    if (filter.leadId) {
      await this.guardLeadAccess(filter.leadId, user);
    }

    const where: Prisma.CalculationSessionWhereInput = {
      deletedAt: null,
      ...(filter.leadId ? { leadId: filter.leadId } : {}),
    };

    if (
      !filter.leadId &&
      !user.permissions.includes(CALCULATION_PERMISSIONS.READ_ALL)
    ) {
      where.createdById = user.id;
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.calculationSession.findMany({
        where,
        include: calculationInclude,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.calculationSession.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  async findOne(id: string, user: CurrentUser): Promise<CalculationWithItems> {
    const session = await this.findActiveSession(id);
    this.assertCalculationReadAccess(session, user);

    return this.prisma.calculationSession.findUniqueOrThrow({
      where: { id },
      include: calculationInclude,
    });
  }

  async update(
    id: string,
    dto: UpdateCalculationDto,
    user: CurrentUser,
  ): Promise<CalculationWithItems> {
    const session = await this.findActiveSession(id);
    this.assertCalculationWriteAccess(session, user);
    this.assertDraft(session);

    const lead = dto.items
      ? await this.guardLeadForHplCalculation(session.leadId, user)
      : null;
    const commercial = lead ? this.requireCommercialDecision(lead) : null;
    const derivedItems =
      dto.items && lead && commercial
        ? this.deriveCalculationItems(dto.items, lead.qualification, commercial)
        : undefined;

    const cnyUsdRate = derivedItems
      ? await this.currencyRateService.getActiveCnyUsdRate()
      : undefined;
    const calculatedItems = derivedItems
      ? await this.calculateItems(
          derivedItems,
          cnyUsdRate!,
          lead?.qualification?.application,
        )
      : undefined;

    return this.prisma.$transaction(async (tx) => {
      if (calculatedItems) {
        await tx.calculationLineItem.deleteMany({
          where: { calculationId: id },
        });
      }

      const totalAmount = calculatedItems
        ? calculatedItems.reduce(
            (sum, item) => sum.plus(item.totalPrice),
            new Prisma.Decimal(0),
          )
        : session.totalAmount;

      return tx.calculationSession.update({
        where: { id },
        data: {
          notes: dto.notes ?? session.notes,
          ...(calculatedItems
            ? {
                displayCurrency: HPL_SELLING_CURRENCY,
                cnyUsdRate,
                sellingCoefficient: HPL_SELLING_COEFFICIENT,
                commercialSupplierId: commercial!.supplierId,
                commercialQualityClassId: commercial!.qualityClassId,
                commercialConfirmedAt: commercial!.confirmedAt,
              }
            : {}),
          totalAmount:
            totalAmount === null || totalAmount === undefined
              ? null
              : new Prisma.Decimal(totalAmount.toString()).toDecimalPlaces(2),
          ...(calculatedItems
            ? {
                items: {
                  create: calculatedItems.map(
                    ({ areaM2: _areaM2, ...item }) => item,
                  ),
                },
              }
            : {}),
        },
        include: calculationInclude,
      });
    });
  }

  async finalize(id: string, user: CurrentUser): Promise<CalculationWithItems> {
    const session = await this.findActiveSession(id);
    this.assertCalculationWriteAccess(session, user);
    this.assertDraft(session);

    return this.prisma.calculationSession.update({
      where: { id },
      data: { status: CALCULATION_STATUS.FINALIZED },
      include: calculationInclude,
    });
  }

  async softDelete(id: string, user: CurrentUser): Promise<CalculationWithItems> {
    const session = await this.findActiveSession(id);
    this.assertCalculationDeleteAccess(session, user);

    return this.prisma.calculationSession.update({
      where: { id },
      data: { deletedAt: new Date() },
      include: calculationInclude,
    });
  }

  async preview(dto: PreviewCalculationDto, user: CurrentUser) {
    if (dto.leadId) {
      const lead = await this.guardLeadForHplCalculation(dto.leadId, user);
      const commercial = this.requireCommercialDecision(lead);
      const [item] = this.deriveCalculationItems(
        [dto],
        lead.qualification,
        commercial,
      );
      const cnyUsdRate = await this.currencyRateService.getActiveCnyUsdRate();
      const calculated = await this.calculateItem(
        item,
        0,
        cnyUsdRate,
        lead.qualification?.application,
      );

      return {
        sheetsCount: calculated.sheetsCount,
        areaM2: calculated.areaM2,
        wastePercent: calculated.wastePercent,
        supplierPricePerM2: calculated.supplierPricePerM2,
        clientPricePerM2: calculated.clientPricePerM2,
        pricePerSheet: calculated.pricePerSheet,
        total: calculated.totalPrice,
      };
    }

    const cnyUsdRate = await this.currencyRateService.getActiveCnyUsdRate();
    const item = await this.calculateItem(
      this.resolveCatalogPreviewItem(dto),
      0,
      cnyUsdRate,
    );

    return {
      sheetsCount: item.sheetsCount,
      areaM2: item.areaM2,
      wastePercent: item.wastePercent,
      supplierPricePerM2: item.supplierPricePerM2,
      clientPricePerM2: item.clientPricePerM2,
      pricePerSheet: item.pricePerSheet,
      total: item.totalPrice,
    };
  }

  private async calculateItems(
    items: ResolvedCalculationItem[],
    cnyUsdRate: Prisma.Decimal,
    application?: HplApplication | null,
  ): Promise<CalculatedLineItem[]> {
    return Promise.all(
      items.map((item, index) =>
        this.calculateItem(item, index, cnyUsdRate, application),
      ),
    );
  }

  private async calculateItem(
    item: ResolvedCalculationItem,
    sortOrder: number,
    cnyUsdRate: Prisma.Decimal,
    application?: HplApplication | null,
  ): Promise<CalculatedLineItem> {
    const requiredArea = new Prisma.Decimal(item.requiredAreaM2);

    if (requiredArea.lte(0)) {
      throw new BusinessException(
        HttpStatus.BAD_REQUEST,
        'INVALID_AREA',
        'Площадь должна быть больше 0',
      );
    }

    if (requiredArea.gt(999999.99)) {
      throw new BusinessException(
        HttpStatus.BAD_REQUEST,
        'INVALID_AREA',
        'Площадь не может превышать 999999.99 м²',
      );
    }

    const [panelType, size, mapping, color] = await Promise.all([
      this.prisma.panelType.findFirst({
        where: { id: item.panelTypeId, isActive: true },
      }),
      this.prisma.panelSize.findFirst({
        where: { id: item.panelSizeId, isActive: true },
      }),
      this.prisma.supplierQualityMapping.findFirst({
        where: {
          supplierId: item.supplierId,
          panelTypeId: item.panelTypeId,
          qualityClassId: item.qualityClassId,
        },
      }),
      item.colorId
        ? this.prisma.panelColor.findUnique({ where: { id: item.colorId } })
        : Promise.resolve(null),
    ]);

    if (!panelType) {
      throw new BusinessException(
        HttpStatus.BAD_REQUEST,
        'PANEL_TYPE_NOT_FOUND',
        'Выбранный тип панели не найден',
      );
    }

    if (
      application &&
      panelType.code !== panelTypeCodeForApplication(application)
    ) {
      throw new BusinessException(
        HttpStatus.BAD_REQUEST,
        'APPLICATION_PANEL_TYPE_MISMATCH',
        'Тип панели не соответствует запрошенному применению клиента',
      );
    }

    if (!size) {
      throw new BusinessException(
        HttpStatus.BAD_REQUEST,
        'PANEL_SIZE_NOT_FOUND',
        'Выбранный размер панели не найден',
      );
    }

    if (!mapping) {
      throw new BusinessException(
        HttpStatus.BAD_REQUEST,
        'INVALID_QUALITY_MAPPING',
        'Выбранный класс качества недоступен для этого поставщика',
      );
    }

    if (item.colorId && !color) {
      throw new BusinessException(
        HttpStatus.BAD_REQUEST,
        'COLOR_NOT_FOUND',
        'Выбранный цвет не найден',
      );
    }

    if (color && color.supplierId !== item.supplierId) {
      throw new BusinessException(
        HttpStatus.BAD_REQUEST,
        'COLOR_SUPPLIER_MISMATCH',
        'Выбранный цвет не принадлежит этому поставщику',
      );
    }

    const thicknessMm = item.thicknessMm;

    if (!Number.isInteger(thicknessMm) || thicknessMm <= 0) {
      throw new BusinessException(
        HttpStatus.BAD_REQUEST,
        'INVALID_THICKNESS',
        'Толщина должна быть целым числом больше 0',
      );
    }

    const quantity = this.quantityCalc.calculate(requiredArea, size);
    if (quantity.sheetsCount <= 0) {
      throw new BusinessException(
        HttpStatus.BAD_REQUEST,
        'INVALID_QUANTITY',
        'Количество листов должно быть больше 0',
      );
    }

    const price = await this.priceCalc.calculate({
      supplierId: item.supplierId,
      qualityClassId: item.qualityClassId,
      thicknessMm,
      widthMm: size.widthMm,
      heightMm: size.heightMm,
      sheets: quantity.sheetsCount,
      cnyUsdRate,
    });

    return {
      panelTypeId: item.panelTypeId,
      panelSizeId: item.panelSizeId,
      thicknessMm,
      supplierId: item.supplierId,
      qualityClassId: item.qualityClassId,
      colorId: item.colorId ?? null,
      requiredAreaM2: requiredArea.toDecimalPlaces(4),
      sheetsCount: quantity.sheetsCount,
      supplierPricePerM2: price.supplierPricePerM2,
      clientPricePerM2: price.clientPricePerM2,
      pricePerM2: price.clientPricePerM2,
      pricePerSheet: price.pricePerSheet,
      totalPrice: price.total,
      wastePercent: quantity.wastePercent,
      sortOrder,
      areaM2: price.areaM2,
    };
  }

  private deriveCalculationItems(
    items: CalculationItemDto[],
    qualification: LeadQualification | null,
    commercial: CommercialDecision,
  ): ResolvedCalculationItem[] {
    assertStage1QualificationComplete(qualification);

    return items.map((item) => {
      if (item.supplierId && item.supplierId !== commercial.supplierId) {
        throw new BusinessException(
          HttpStatus.BAD_REQUEST,
          'COMMERCIAL_OVERRIDE_FORBIDDEN',
          'Поставщик берётся из коммерческой квалификации руководителя',
        );
      }

      if (
        item.qualityClassId &&
        item.qualityClassId !== commercial.qualityClassId
      ) {
        throw new BusinessException(
          HttpStatus.BAD_REQUEST,
          'COMMERCIAL_OVERRIDE_FORBIDDEN',
          'Класс качества берётся из коммерческой квалификации руководителя',
        );
      }

      const panelTypeId = item.panelTypeId ?? qualification!.panelTypeId;
      const panelSizeId = item.panelSizeId ?? qualification!.panelSizeId;
      const thicknessMm =
        resolveThicknessMm(item) ?? qualification!.thicknessMm;
      const requiredAreaM2 =
        item.requiredAreaM2 ?? qualification!.requiredAreaM2?.toString();

      if (!panelTypeId || !panelSizeId || !thicknessMm || !requiredAreaM2) {
        throw new BusinessException(
          HttpStatus.BAD_REQUEST,
          'CALCULATION_PREFILL_INCOMPLETE',
          'Недостаточно данных Stage-1 для расчёта',
        );
      }

      return {
        panelTypeId,
        panelSizeId,
        thicknessMm,
        requiredAreaM2,
        supplierId: commercial.supplierId,
        qualityClassId: commercial.qualityClassId,
        colorId: item.colorId,
      };
    });
  }

  private resolveCatalogPreviewItem(
    dto: PreviewCalculationDto,
  ): ResolvedCalculationItem {
    const thicknessMm = resolveThicknessMm(dto);
    if (
      !dto.panelTypeId ||
      !dto.panelSizeId ||
      !dto.supplierId ||
      !dto.qualityClassId ||
      !dto.requiredAreaM2 ||
      thicknessMm == null
    ) {
      throw new BusinessException(
        HttpStatus.BAD_REQUEST,
        'CALCULATION_PREFILL_INCOMPLETE',
        'Для предпросмотра каталога нужны тип, размер, толщина, поставщик, качество и площадь',
      );
    }

    return {
      panelTypeId: dto.panelTypeId,
      panelSizeId: dto.panelSizeId,
      thicknessMm,
      supplierId: dto.supplierId,
      qualityClassId: dto.qualityClassId,
      requiredAreaM2: dto.requiredAreaM2,
      colorId: dto.colorId,
    };
  }

  private requireCommercialDecision(
    lead: LeadForHplCalculation,
  ): CommercialDecision {
    const commercial = lead.commercialQualification;
    if (
      !commercial ||
      commercial.status !== CommercialQualificationStatus.CONFIRMED
    ) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        'COMMERCIAL_QUALIFICATION_REQUIRED',
        'Расчёт доступен после коммерческой квалификации руководителя',
      );
    }

    return {
      supplierId: commercial.supplierId,
      qualityClassId: commercial.qualityClassId,
      confirmedAt: commercial.confirmedAt,
    };
  }

  private async guardLeadForHplCalculation(
    leadId: string,
    user: CurrentUser,
  ): Promise<LeadForHplCalculation> {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, deletedAt: null },
      include: {
        qualification: true,
        commercialQualification: true,
      },
    });

    if (!lead) {
      throw new BusinessException(
        HttpStatus.NOT_FOUND,
        'LEAD_NOT_FOUND',
        'Лид не найден',
      );
    }

    if (
      !user.permissions.includes(LEADS_READ_ALL_PERMISSION) &&
      lead.ownerId !== user.id
    ) {
      throw new BusinessException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'У вас нет доступа к этому лиду',
      );
    }

    if (
      lead.status === LeadStatus.CONVERTED ||
      lead.status === LeadStatus.UNQUALIFIED ||
      lead.dealId !== null
    ) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        'LEAD_NOT_CALCULABLE',
        'Расчёт недоступен для терминального лида',
      );
    }

    if (lead.status !== LeadStatus.QUALIFIED) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        'COMMERCIAL_QUALIFICATION_REQUIRED',
        'Расчёт доступен после квалификации Stage 1 и коммерческой квалификации руководителя',
      );
    }

    assertStage1QualificationComplete(lead.qualification);
    this.requireCommercialDecision(lead);

    return lead;
  }

  private async guardLeadAccess(
    leadId: string,
    user: CurrentUser,
  ): Promise<Lead> {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, deletedAt: null },
    });

    if (!lead) {
      throw new BusinessException(
        HttpStatus.NOT_FOUND,
        'LEAD_NOT_FOUND',
        'Лид не найден',
      );
    }

    if (
      user.permissions.includes(LEADS_READ_ALL_PERMISSION) ||
      lead.ownerId === user.id
    ) {
      return lead;
    }

    throw new BusinessException(
      HttpStatus.FORBIDDEN,
      'FORBIDDEN',
      'У вас нет доступа к этому лиду',
    );
  }

  private async findActiveSession(id: string): Promise<CalculationSession> {
    const session = await this.prisma.calculationSession.findFirst({
      where: { id, deletedAt: null },
    });

    if (!session) {
      throw new BusinessException(
        HttpStatus.NOT_FOUND,
        'CALCULATION_NOT_FOUND',
        'Расчёт не найден',
      );
    }

    return session;
  }

  private assertDraft(session: CalculationSession): void {
    if (session.status !== CALCULATION_STATUS.DRAFT) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        'CALCULATION_LOCKED',
        'Расчёт зафиксирован, создайте новый',
      );
    }
  }

  private assertCalculationReadAccess(
    session: CalculationSession,
    user: CurrentUser,
  ): void {
    if (
      user.permissions.includes(CALCULATION_PERMISSIONS.READ_ALL) ||
      session.createdById === user.id
    ) {
      return;
    }

    throw new BusinessException(
      HttpStatus.FORBIDDEN,
      'FORBIDDEN',
      'У вас нет доступа к этому расчёту',
    );
  }

  private assertCalculationWriteAccess(
    session: CalculationSession,
    user: CurrentUser,
  ): void {
    if (
      user.permissions.includes(CALCULATION_PERMISSIONS.READ_ALL) ||
      session.createdById === user.id
    ) {
      return;
    }

    throw new BusinessException(
      HttpStatus.FORBIDDEN,
      'FORBIDDEN',
      'У вас нет доступа к этому расчёту',
    );
  }

  private assertCalculationDeleteAccess(
    session: CalculationSession,
    user: CurrentUser,
  ): void {
    if (session.createdById === user.id) {
      return;
    }

    if (user.permissions.includes(CALCULATION_PERMISSIONS.READ_ALL)) {
      return;
    }

    throw new BusinessException(
      HttpStatus.FORBIDDEN,
      'FORBIDDEN',
      'У вас нет доступа к удалению этого расчёта',
    );
  }
}
