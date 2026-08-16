import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ActivityType,
  CalculationSession,
  Lead,
  Prisma,
} from '@prisma/client';
import { BusinessException } from '../common/exceptions/business.exception';
import type { CurrentUser } from '../common/interfaces/current-user.interface';
import { PanelPriceCalculator } from '../panels/services/panel-price-calculator.service';
import { PanelQuantityCalculator } from '../panels/services/panel-quantity-calculator.service';
import { CurrencyRateService } from '../panels/services/currency-rate.service';
import {
  HPL_SELLING_COEFFICIENT,
  HPL_SELLING_CURRENCY,
} from '../panels/pricing/hpl-pricing.constants';
import { PrismaService } from '../modules/prisma/prisma.service';
import {
  CALCULATION_PERMISSIONS,
  CALCULATION_STATUS,
  LEADS_READ_ALL_PERMISSION,
} from './calculation.constants';
import {
  CalculationItemDto,
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
    const lead = await this.guardLeadAccess(dto.leadId, user);
    const cnyUsdRate = await this.currencyRateService.getActiveCnyUsdRate();
    const calculatedItems = await this.calculateItems(dto.items, cnyUsdRate);

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

    const cnyUsdRate = dto.items
      ? await this.currencyRateService.getActiveCnyUsdRate()
      : undefined;
    const calculatedItems = dto.items
      ? await this.calculateItems(dto.items, cnyUsdRate!)
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

  async preview(dto: CalculationItemDto) {
    const cnyUsdRate = await this.currencyRateService.getActiveCnyUsdRate();
    const item = await this.calculateItem(dto, 0, cnyUsdRate);

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
    items: CalculationItemDto[],
    cnyUsdRate: Prisma.Decimal,
  ): Promise<CalculatedLineItem[]> {
    return Promise.all(
      items.map((item, index) => this.calculateItem(item, index, cnyUsdRate)),
    );
  }

  private async calculateItem(
    item: CalculationItemDto,
    sortOrder: number,
    cnyUsdRate: Prisma.Decimal,
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

    const thicknessMm = resolveThicknessMm(item);

    if (thicknessMm == null) {
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
