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
import {
  panelTypeCodeForApplication,
  supplierQualityMatrixApplies,
} from '../panels/pricing/hpl-quality-matrix';
import { PanelPriceCalculator } from '../panels/services/panel-price-calculator.service';
import { PanelQuantityCalculator } from '../panels/services/panel-quantity-calculator.service';
import { CurrencyRateService } from '../panels/services/currency-rate.service';
import {
  HPL_SELLING_COEFFICIENT,
  HPL_SELLING_CURRENCY,
} from '../panels/pricing/hpl-pricing.constants';
import {
  parseThicknessMm,
  validateHplThickness,
} from '../panels/hpl-thickness';
import {
  assertCustomDimensionsPair,
  assertStage1QualificationComplete,
} from '../modules/leads/lead-qualification.rules';
import { HPL_CUSTOM_PANEL_TYPE_CODE } from '../panels/hpl-catalog';
import { PrismaService } from '../modules/prisma/prisma.service';
import {
  CALCULATION_PERMISSIONS,
  CALCULATION_REQUEST_STATUS,
  CALCULATION_STATUS,
  LEADS_READ_ALL_PERMISSION,
  MANUAL_PURCHASE_PRICE_PERMISSION,
} from './calculation.constants';
import {
  CalculationItemDto,
  PreviewCalculationDto,
  resolveThicknessMm,
} from './dto/calculation-item.dto';
import { CreateCalculationDto } from './dto/create-calculation.dto';
import { FilterCalculationsDto } from './dto/filter-calculations.dto';
import { UpdateCalculationDto } from './dto/update-calculation.dto';

const calculationInclude = Prisma.validator<Prisma.CalculationSessionInclude>()(
  {
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
  },
);

export type CalculationWithItems = Prisma.CalculationSessionGetPayload<{
  include: typeof calculationInclude;
}>;

export type CalculatedLineItem = {
  panelTypeId: string | null;
  panelSizeId: string | null;
  thicknessMm: Prisma.Decimal | null;
  supplierId: string | null;
  qualityClassId: string | null;
  colorId: string | null;
  colorCode: string | null;
  colorName: string | null;
  coating: string | null;
  texture: string | null;
  decor: string | null;
  note: string | null;
  customTypeDescription: string | null;
  customWidthMm: number | null;
  customHeightMm: number | null;
  requiredAreaM2: Prisma.Decimal | null;
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

function optionalLineText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function toPersistedLineItem(item: CalculatedLineItem) {
  return {
    panelTypeId: item.panelTypeId,
    panelSizeId: item.panelSizeId,
    thicknessMm: item.thicknessMm,
    supplierId: item.supplierId,
    qualityClassId: item.qualityClassId,
    colorId: item.colorId,
    colorCode: item.colorCode,
    colorName: item.colorName,
    coating: item.coating,
    texture: item.texture,
    decor: item.decor,
    note: item.note,
    customTypeDescription: item.customTypeDescription,
    customWidthMm: item.customWidthMm,
    customHeightMm: item.customHeightMm,
    requiredAreaM2: item.requiredAreaM2,
    sheetsCount: item.sheetsCount,
    supplierPricePerM2: item.supplierPricePerM2,
    clientPricePerM2: item.clientPricePerM2,
    pricePerM2: item.pricePerM2,
    pricePerSheet: item.pricePerSheet,
    totalPrice: item.totalPrice,
    wastePercent: item.wastePercent,
    sortOrder: item.sortOrder,
  };
}

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
  panelTypeId: string | null;
  panelSizeId: string | null;
  thicknessMm: Prisma.Decimal | null;
  supplierId: string | null;
  qualityClassId: string | null;
  colorId?: string | null;
  colorCode?: string | null;
  colorName?: string | null;
  coating?: string | null;
  texture?: string | null;
  decor?: string | null;
  note?: string | null;
  customTypeDescription?: string | null;
  customWidthMm?: number | null;
  customHeightMm?: number | null;
  requiredAreaM2: string | null;
  purchasePricePerM2Cny?: Prisma.Decimal;
};

export const MANAGER_CALCULATION_ITEM_REQUIRED_MESSAGE =
  'Для позиции укажите тип HPL, линейку, размер, толщину и площадь.';

type LineGeometry = {
  panelTypeId: string;
  panelSizeId: string;
  thicknessMm: Prisma.Decimal;
  supplierId: string | null;
  qualityClassId: string;
  colorId: string | null;
  colorCode: string | null;
  colorName: string | null;
  coating: string | null;
  texture: string | null;
  note: string | null;
  customTypeDescription: string | null;
  customWidthMm: number | null;
  customHeightMm: number | null;
  requiredAreaM2: Prisma.Decimal;
  sheetsCount: number;
  wastePercent: Prisma.Decimal;
  widthMm: number;
  heightMm: number;
  coveredAreaM2: Prisma.Decimal;
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
    this.assertManualPurchasePriceAccess(dto.items, user);
    if (this.canSubmitManualPurchasePrice(user)) {
      this.requireManualPurchasePrices(dto.items);
    }
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
            create: calculatedItems.map(toPersistedLineItem),
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
    await this.assertRequestMutable(session.requestId);
    if (dto.items) {
      this.assertManualPurchasePriceAccess(dto.items, user);
      if (this.canSubmitManualPurchasePrice(user)) {
        this.requireManualPurchasePrices(dto.items);
      }
    }

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
                  create: calculatedItems.map(toPersistedLineItem),
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

  async softDelete(
    id: string,
    user: CurrentUser,
  ): Promise<CalculationWithItems> {
    const session = await this.findActiveSession(id);
    this.assertCalculationDeleteAccess(session, user);

    return this.prisma.calculationSession.update({
      where: { id },
      data: { deletedAt: new Date() },
      include: calculationInclude,
    });
  }

  async preview(dto: PreviewCalculationDto, user: CurrentUser) {
    this.assertManualPurchasePriceAccess([dto], user);

    if (dto.leadId) {
      const lead = await this.guardLeadForHplCalculation(dto.leadId, user);
      const commercial = this.requireCommercialDecision(lead);
      const [item] = this.deriveCalculationItems(
        [dto],
        lead.qualification,
        commercial,
      );
      return this.previewResolvedItem(
        item,
        user,
        lead.qualification?.application,
      );
    }

    return this.previewResolvedItem(this.resolveCatalogPreviewItem(dto), user);
  }

  private async previewResolvedItem(
    item: ResolvedCalculationItem,
    user: CurrentUser,
    application?: HplApplication | null,
  ) {
    const geometry = await this.resolveLineGeometry(item, application);
    const mechanical = {
      sheetsCount: geometry.sheetsCount,
      areaM2: geometry.coveredAreaM2,
      wastePercent: geometry.wastePercent,
      sellingCoefficient: HPL_SELLING_COEFFICIENT,
    };

    if (
      !item.purchasePricePerM2Cny &&
      this.canSubmitManualPurchasePrice(user)
    ) {
      return mechanical;
    }

    const cnyUsdRate = await this.currencyRateService.getActiveCnyUsdRate();
    const calculated = await this.priceGeometry(item, geometry, 0, cnyUsdRate);

    return {
      sheetsCount: calculated.sheetsCount,
      areaM2: calculated.areaM2,
      wastePercent: calculated.wastePercent,
      supplierPricePerM2: calculated.supplierPricePerM2,
      purchasePricePerM2Cny: calculated.supplierPricePerM2,
      clientPricePerM2: calculated.clientPricePerM2,
      pricePerSheet: calculated.pricePerSheet,
      total: calculated.totalPrice,
      cnyUsdRate,
      sellingCoefficient: HPL_SELLING_COEFFICIENT,
    };
  }

  async prepareManagerCatalogGroup(
    leadId: string,
    items: CalculationItemDto[],
    user: CurrentUser,
    options: { allowIncomplete?: boolean } = {},
  ): Promise<{
    lead: LeadForHplCalculation;
    cnyUsdRate: null;
    calculatedItems: CalculatedLineItem[];
  }> {
    this.assertManualPurchasePriceAccess(items, user);
    const lead = await this.guardLeadForCalculationRequest(leadId, user);
    const resolved = this.deriveManagerCatalogItems(
      items,
      lead.qualification,
      options,
    );
    const calculatedItems = await Promise.all(
      resolved.map((item, index) => this.snapshotManagerItem(item, index)),
    );

    return { lead, cnyUsdRate: null, calculatedItems };
  }

  private async snapshotManagerItem(
    item: ResolvedCalculationItem,
    sortOrder: number,
  ): Promise<CalculatedLineItem> {
    // A CalculationRequest is a technical snapshot, not a commercial
    // calculation. In particular, the selected type intentionally overrides
    // the old Lead application and no purchase-price lookup happens here.
    if (
      !item.panelTypeId ||
      !item.panelSizeId ||
      !item.qualityClassId ||
      !item.requiredAreaM2 ||
      item.thicknessMm == null
    ) {
      return this.snapshotIncompleteRequestItem(item, sortOrder);
    }

    const geometry = await this.resolveLineGeometry({
      ...item,
      panelTypeId: item.panelTypeId,
      panelSizeId: item.panelSizeId,
      qualityClassId: item.qualityClassId,
      thicknessMm: item.thicknessMm,
      requiredAreaM2: item.requiredAreaM2,
    });
    const unpriced = new Prisma.Decimal(0);

    return {
      panelTypeId: item.panelTypeId,
      panelSizeId: item.panelSizeId,
      thicknessMm: geometry.thicknessMm,
      supplierId: item.supplierId,
      qualityClassId: item.qualityClassId,
      colorId: geometry.colorId,
      colorCode: geometry.colorCode,
      colorName: geometry.colorName,
      coating: geometry.coating,
      texture: geometry.texture,
      decor: optionalLineText(item.decor),
      note: geometry.note,
      customTypeDescription: geometry.customTypeDescription,
      customWidthMm: geometry.customWidthMm,
      customHeightMm: geometry.customHeightMm,
      requiredAreaM2: geometry.requiredAreaM2.toDecimalPlaces(4),
      sheetsCount: geometry.sheetsCount,
      supplierPricePerM2: unpriced,
      clientPricePerM2: unpriced,
      pricePerM2: unpriced,
      pricePerSheet: unpriced,
      totalPrice: unpriced,
      wastePercent: geometry.wastePercent,
      sortOrder,
      areaM2: geometry.coveredAreaM2,
    };
  }

  private snapshotIncompleteRequestItem(
    item: ResolvedCalculationItem,
    sortOrder: number,
  ): CalculatedLineItem {
    const unpriced = new Prisma.Decimal(0);
    const requiredAreaM2 = item.requiredAreaM2
      ? new Prisma.Decimal(item.requiredAreaM2).toDecimalPlaces(4)
      : null;

    return {
      panelTypeId: item.panelTypeId,
      panelSizeId: item.panelSizeId,
      thicknessMm: item.thicknessMm,
      supplierId: item.supplierId,
      qualityClassId: item.qualityClassId,
      colorId: item.colorId ?? null,
      colorCode: optionalLineText(item.colorCode),
      colorName: optionalLineText(item.colorName),
      coating: optionalLineText(item.coating),
      texture: optionalLineText(item.texture),
      decor: optionalLineText(item.decor),
      note: optionalLineText(item.note),
      customTypeDescription: optionalLineText(item.customTypeDescription),
      customWidthMm: item.customWidthMm ?? null,
      customHeightMm: item.customHeightMm ?? null,
      requiredAreaM2,
      sheetsCount: 0,
      supplierPricePerM2: unpriced,
      clientPricePerM2: unpriced,
      pricePerM2: unpriced,
      pricePerSheet: unpriced,
      totalPrice: unpriced,
      wastePercent: unpriced,
      sortOrder,
      areaM2: requiredAreaM2 ?? unpriced,
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
    const geometry = await this.resolveLineGeometry(item, application);
    return this.priceGeometry(item, geometry, sortOrder, cnyUsdRate);
  }

  private async priceGeometry(
    item: ResolvedCalculationItem,
    geometry: LineGeometry,
    sortOrder: number,
    cnyUsdRate: Prisma.Decimal,
  ): Promise<CalculatedLineItem> {
    if (!item.supplierId || !item.qualityClassId) {
      throw new BusinessException(
        HttpStatus.BAD_REQUEST,
        'SUPPLIER_REQUIRED_FOR_PRICING',
        'Для коммерческого расчёта руководитель должен выбрать поставщика',
      );
    }

    const price = await this.priceCalc.calculate({
      supplierId: item.supplierId,
      qualityClassId: item.qualityClassId,
      thicknessMm: geometry.thicknessMm,
      widthMm: geometry.widthMm,
      heightMm: geometry.heightMm,
      sheets: geometry.sheetsCount,
      cnyUsdRate,
      purchasePricePerM2Cny: item.purchasePricePerM2Cny,
    });

    return {
      panelTypeId: item.panelTypeId,
      panelSizeId: item.panelSizeId,
      thicknessMm: geometry.thicknessMm,
      supplierId: item.supplierId,
      qualityClassId: item.qualityClassId,
      colorId: geometry.colorId,
      colorCode: geometry.colorCode,
      colorName: geometry.colorName,
      coating: geometry.coating,
      texture: geometry.texture,
      decor: optionalLineText(item.decor),
      note: geometry.note,
      customTypeDescription: geometry.customTypeDescription,
      customWidthMm: geometry.customWidthMm,
      customHeightMm: geometry.customHeightMm,
      requiredAreaM2: geometry.requiredAreaM2.toDecimalPlaces(4),
      sheetsCount: geometry.sheetsCount,
      supplierPricePerM2: price.supplierPricePerM2,
      clientPricePerM2: price.clientPricePerM2,
      pricePerM2: price.clientPricePerM2,
      pricePerSheet: price.pricePerSheet,
      totalPrice: price.total,
      wastePercent: geometry.wastePercent,
      sortOrder,
      areaM2: price.areaM2,
    };
  }

  private async resolveLineGeometry(
    item: ResolvedCalculationItem,
    application?: HplApplication | null,
  ): Promise<LineGeometry> {
    if (
      !item.panelTypeId ||
      !item.panelSizeId ||
      !item.requiredAreaM2 ||
      !item.qualityClassId ||
      item.thicknessMm == null
    ) {
      throw new BusinessException(
        HttpStatus.BAD_REQUEST,
        'CALCULATION_PREFILL_INCOMPLETE',
        MANAGER_CALCULATION_ITEM_REQUIRED_MESSAGE,
      );
    }

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
      item.supplierId
        ? this.prisma.supplierQualityMapping.findFirst({
            where: {
              supplierId: item.supplierId,
              panelTypeId: item.panelTypeId,
              qualityClassId: item.qualityClassId,
            },
          })
        : Promise.resolve(null),
      item.colorId
        ? this.prisma.panelColor.findUnique({ where: { id: item.colorId } })
        : Promise.resolve(null),
    ]);

    let rawColor: { colorCode: string; colorName: string } | null = null;
    if (!color && item.colorCode && item.supplierId) {
      rawColor = await this.prisma.panelColor.findFirst({
        where: {
          supplierId: item.supplierId,
          colorCode: item.colorCode,
        },
        select: { colorCode: true, colorName: true },
      });
    }

    if (!panelType) {
      throw new BusinessException(
        HttpStatus.BAD_REQUEST,
        'PANEL_TYPE_NOT_FOUND',
        'Выбранный тип панели не найден',
      );
    }

    if (
      application &&
      panelType.code !== HPL_CUSTOM_PANEL_TYPE_CODE &&
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

    const mappingRequired =
      supplierQualityMatrixApplies(application ?? null) &&
      panelType.code !== HPL_CUSTOM_PANEL_TYPE_CODE;
    if (mappingRequired && !mapping) {
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

    if (color && item.supplierId && color.supplierId !== item.supplierId) {
      throw new BusinessException(
        HttpStatus.BAD_REQUEST,
        'COLOR_SUPPLIER_MISMATCH',
        'Выбранный цвет не принадлежит этому поставщику',
      );
    }

    if (item.colorCode && item.supplierId && !color && !rawColor) {
      throw new BusinessException(
        HttpStatus.BAD_REQUEST,
        'COLOR_SUPPLIER_MISMATCH',
        'Выбранный декор не найден у выбранного поставщика',
      );
    }

    const thicknessResult = validateHplThickness(application, item.thicknessMm);
    if (!thicknessResult.ok) {
      throw new BusinessException(
        HttpStatus.BAD_REQUEST,
        thicknessResult.errorCode,
        thicknessResult.message,
      );
    }
    const thicknessMm = thicknessResult.thicknessMm;

    const quantity = this.quantityCalc.calculate(requiredArea, size);
    const sheetsCount = quantity.sheetsCount;
    if (sheetsCount <= 0) {
      throw new BusinessException(
        HttpStatus.BAD_REQUEST,
        'INVALID_QUANTITY',
        'Количество листов должно быть больше 0',
      );
    }

    if (panelType.code === HPL_CUSTOM_PANEL_TYPE_CODE) {
      const customNote = item.customTypeDescription?.trim();
      if (!customNote) {
        throw new BusinessException(
          HttpStatus.BAD_REQUEST,
          'CUSTOM_TYPE_DESCRIPTION_REQUIRED',
          'Для типа «Другой» укажите описание запроса',
        );
      }
    }

    return {
      panelTypeId: item.panelTypeId,
      panelSizeId: item.panelSizeId,
      thicknessMm,
      supplierId: item.supplierId,
      qualityClassId: item.qualityClassId,
      colorId: item.colorId ?? null,
      colorCode:
        color?.colorCode ?? rawColor?.colorCode ?? item.colorCode ?? null,
      colorName:
        color?.colorName ?? rawColor?.colorName ?? item.colorName ?? null,
      coating: item.coating?.trim() || null,
      texture: item.texture?.trim() || null,
      note: item.note?.trim() || null,
      customTypeDescription: item.customTypeDescription?.trim() || null,
      customWidthMm: item.customWidthMm ?? null,
      customHeightMm: item.customHeightMm ?? null,
      requiredAreaM2: requiredArea.toDecimalPlaces(4),
      sheetsCount,
      wastePercent: quantity.wastePercent,
      widthMm: size.widthMm,
      heightMm: size.heightMm,
      coveredAreaM2: quantity.actualAreaM2.toDecimalPlaces(4),
    };
  }

  private deriveManagerCatalogItems(
    items: CalculationItemDto[],
    qualification: LeadQualification | null,
    options: { allowIncomplete?: boolean } = {},
  ): ResolvedCalculationItem[] {
    return items.map((item) => {
      const thicknessMm = parseThicknessMm(resolveThicknessMm(item));
      assertCustomDimensionsPair(item);
      const incomplete =
        !item.panelTypeId ||
        !item.panelSizeId ||
        !item.qualityClassId ||
        !item.requiredAreaM2 ||
        thicknessMm == null;
      if (incomplete && !options.allowIncomplete) {
        throw new BusinessException(
          HttpStatus.BAD_REQUEST,
          'CALCULATION_PREFILL_INCOMPLETE',
          MANAGER_CALCULATION_ITEM_REQUIRED_MESSAGE,
        );
      }

      if (
        item.requiredAreaM2 &&
        new Prisma.Decimal(item.requiredAreaM2).lt(0)
      ) {
        throw new BusinessException(
          HttpStatus.BAD_REQUEST,
          'INVALID_AREA',
          'Площадь не может быть отрицательной',
        );
      }

      return {
        panelTypeId: item.panelTypeId ?? null,
        panelSizeId: item.panelSizeId ?? null,
        thicknessMm,
        supplierId: item.supplierId ?? null,
        qualityClassId: item.qualityClassId ?? null,
        requiredAreaM2: item.requiredAreaM2 ?? null,
        colorId: item.colorId ?? null,
        colorCode: item.colorCode,
        colorName: item.colorName,
        coating: item.coating,
        texture: item.texture,
        decor: item.decor,
        note: item.note,
        customTypeDescription:
          item.customTypeDescription ?? qualification?.customerRequirements,
        customWidthMm: item.customWidthMm,
        customHeightMm: item.customHeightMm,
        purchasePricePerM2Cny: this.parseManualPurchasePriceCny(
          item.purchasePricePerM2Cny,
        ),
      };
    });
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
      const thicknessMm = parseThicknessMm(
        resolveThicknessMm(item) ?? qualification!.thicknessMm,
      );
      const requiredAreaM2 =
        item.requiredAreaM2 ?? qualification!.requiredAreaM2?.toString();
      const customWidthMm = qualification!.customWidthMm;
      const customHeightMm = qualification!.customHeightMm;

      if (!panelTypeId || !thicknessMm || !requiredAreaM2) {
        throw new BusinessException(
          HttpStatus.BAD_REQUEST,
          'CALCULATION_PREFILL_INCOMPLETE',
          'Недостаточно данных Stage-1 для расчёта',
        );
      }

      if (!panelSizeId) {
        if ((customWidthMm ?? 0) > 0 && (customHeightMm ?? 0) > 0) {
          throw new BusinessException(
            HttpStatus.UNPROCESSABLE_ENTITY,
            'CUSTOM_SIZE_PRICING_NOT_CONFIGURED',
            'Нестандартный размер принят, но цена для custom-размера не настроена',
            {
              customWidthMm,
              customHeightMm,
            },
          );
        }

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
        colorCode: item.colorCode,
        colorName: item.colorName,
        coating: item.coating,
        texture: item.texture,
        decor: item.decor,
        note: item.note,
        customTypeDescription: item.customTypeDescription,
        customWidthMm: item.customWidthMm,
        customHeightMm: item.customHeightMm,
        purchasePricePerM2Cny: this.parseManualPurchasePriceCny(
          item.purchasePricePerM2Cny,
        ),
      };
    });
  }

  private resolveCatalogPreviewItem(
    dto: PreviewCalculationDto,
  ): ResolvedCalculationItem {
    const thicknessMm = parseThicknessMm(resolveThicknessMm(dto));
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
      colorCode: dto.colorCode,
      colorName: dto.colorName,
      coating: dto.coating,
      texture: dto.texture,
      decor: dto.decor,
      customTypeDescription: dto.customTypeDescription,
      customWidthMm: dto.customWidthMm,
      customHeightMm: dto.customHeightMm,
      purchasePricePerM2Cny: this.parseManualPurchasePriceCny(
        dto.purchasePricePerM2Cny,
      ),
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
        qualification: {
          include: { items: { orderBy: { sortOrder: 'asc' } } },
        },
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
      lead.status === LeadStatus.UNQUALIFIED
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

  async guardLeadForCalculationRequest(
    leadId: string,
    user: CurrentUser,
  ): Promise<LeadForHplCalculation> {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, deletedAt: null },
      include: {
        qualification: {
          include: { items: { orderBy: { sortOrder: 'asc' } } },
        },
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
      lead.status === LeadStatus.UNQUALIFIED
    ) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        'LEAD_NOT_CALCULABLE',
        'Расчёт недоступен для терминального лида',
      );
    }

    if (
      lead.status !== LeadStatus.QUALIFIED &&
      lead.status !== LeadStatus.IN_PROGRESS
    ) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        'LEAD_NOT_CALCULABLE',
        'Сначала заполните квалификацию Stage 1',
      );
    }

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

  private async assertRequestMutable(requestId: string | null): Promise<void> {
    if (!requestId) {
      return;
    }

    const request = await this.prisma.calculationRequest.findFirst({
      where: { id: requestId, deletedAt: null },
      select: { status: true },
    });

    if (request && request.status !== CALCULATION_REQUEST_STATUS.DRAFT) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        'CALCULATION_REQUEST_LOCKED',
        'Запрос отправлен руководителю, расчёты менять нельзя',
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

  private canSubmitManualPurchasePrice(user: CurrentUser): boolean {
    return user.permissions.includes(MANUAL_PURCHASE_PRICE_PERMISSION);
  }

  private assertManualPurchasePriceAccess(
    items: Array<{ purchasePricePerM2Cny?: string }>,
    user: CurrentUser,
  ): void {
    const submitted = items.some(
      (item) =>
        item.purchasePricePerM2Cny !== undefined &&
        item.purchasePricePerM2Cny !== null,
    );
    if (!submitted || this.canSubmitManualPurchasePrice(user)) {
      return;
    }

    throw new BusinessException(
      HttpStatus.FORBIDDEN,
      'MANUAL_PURCHASE_PRICE_FORBIDDEN',
      'Ручной ввод закупочной цены доступен только руководителю',
    );
  }

  private requireManualPurchasePrices(
    items: Array<{ purchasePricePerM2Cny?: string }>,
  ): void {
    for (const item of items) {
      if (!this.parseManualPurchasePriceCny(item.purchasePricePerM2Cny)) {
        throw new BusinessException(
          HttpStatus.BAD_REQUEST,
          'PURCHASE_PRICE_REQUIRED',
          'Укажите закупочную цену, CNY/м²',
        );
      }
    }
  }

  private parseManualPurchasePriceCny(
    value?: string,
  ): Prisma.Decimal | undefined {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }

    const price = new Prisma.Decimal(value);
    if (price.lte(0)) {
      throw new BusinessException(
        HttpStatus.BAD_REQUEST,
        'INVALID_SUPPLIER_PRICE',
        'Закупочная цена должна быть больше 0',
      );
    }

    return price;
  }
}
