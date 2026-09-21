import { HttpStatus, Injectable } from '@nestjs/common';
import {
  FacadeAreaSource,
  FacadeCalculationStatus,
  Prisma,
} from '@prisma/client';
import { BusinessException } from '../../../../common/exceptions/business.exception';
import type { CurrentUser } from '../../../../common/interfaces/current-user.interface';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  findActiveEngineeringAssignment,
  hasEngineeringReadPermission,
  hasOwnerOrReadAllLeadAccess,
} from '../engineering-access';
import { ENGINEERING_PERMISSIONS } from '../engineering.constants';
import {
  BASE_FACADE_CONFIG_CODE,
  BASE_FACADE_NORM_SET_CODE,
} from './facade-norms';
import { decimalToString, multiplyAreaByNorm, toDecimal } from './facade-decimal';
import type {
  FacadeAddItemDto,
  FacadeCalculateDto,
  FacadeSaveDraftDto,
} from './dto/facade-calculation.dto';

const calculationInclude = {
  items: { orderBy: { sortOrder: 'asc' as const } },
  config: true,
  normSet: true,
} satisfies Prisma.FacadeSubsystemCalculationInclude;

@Injectable()
export class FacadeCalculationService {
  constructor(private readonly prisma: PrismaService) {}

  async getWorkspace(leadId: string, user: CurrentUser) {
    const { lead, assignment, canEdit } = await this.loadAccess(leadId, user);
    const qualification = lead.qualification;
    const subsystemRequired = qualification?.ventFacadeKitRequired === true;
    const installationOnly =
      qualification?.installationRequired === true && !subsystemRequired;

    const [configs, catalog, calculation] = await Promise.all([
      this.prisma.facadeSystemConfig.findMany({
        orderBy: { code: 'asc' },
      }),
      this.prisma.facadeMaterial.findMany({
        where: { isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { nameRu: 'asc' }],
      }),
      this.prisma.facadeSubsystemCalculation.findUnique({
        where: { leadId },
        include: calculationInclude,
      }),
    ]);

    return {
      applicable: subsystemRequired,
      reason: subsystemRequired
        ? null
        : installationOnly
          ? 'INSTALLATION_ONLY'
          : 'SUBSYSTEM_NOT_REQUESTED',
      canEdit,
      assignmentId: assignment?.id ?? null,
      suggestedArea: this.suggestArea(qualification),
      configs: configs.map((config) => ({
        id: config.id,
        code: config.code,
        nameRu: config.nameRu,
        nameEn: config.nameEn,
        nameUz: config.nameUz,
        isCalculable: config.isCalculable,
        panelWidthMm: config.panelWidthMm,
        panelHeightMm: config.panelHeightMm,
        panelAreaM2: decimalToString(config.panelAreaM2),
      })),
      catalog: catalog.map((material) => this.toMaterialView(material)),
      calculation: calculation ? this.toCalculationView(calculation) : null,
      quoteCreated: false,
      dealCreated: false,
    };
  }

  async calculate(leadId: string, dto: FacadeCalculateDto, user: CurrentUser) {
    const { lead, assignment, canEdit } = await this.loadAccess(leadId, user);
    this.assertCanEdit(canEdit);
    this.assertSubsystemRequired(lead.qualification);

    const area = this.parsePositiveDecimal(
      dto.claddingAreaM2,
      'FACADE_AREA_INVALID',
      'Укажите площадь облицовки больше 0',
    );
    const areaSource =
      dto.areaSource === FacadeAreaSource.HPL_QUALIFICATION
        ? FacadeAreaSource.HPL_QUALIFICATION
        : FacadeAreaSource.ENGINEER_ENTERED;

    const config = await this.prisma.facadeSystemConfig.findUnique({
      where: { code: dto.configCode },
    });
    if (!config) {
      throw new BusinessException(
        HttpStatus.BAD_REQUEST,
        'FACADE_CONFIG_UNKNOWN',
        'Неизвестная конфигурация фасада',
      );
    }

    const existing = await this.prisma.facadeSubsystemCalculation.findUnique({
      where: { leadId },
      include: calculationInclude,
    });
    this.assertRevision(existing, dto.expectedRevision);

    if (!config.isCalculable) {
      return this.saveUnsupported({
        leadId,
        assignmentId: assignment!.id,
        engineerId: user.id,
        configId: config.id,
        area,
        areaSource,
        existing,
        notes: existing?.notes ?? null,
        actorId: user.id,
      });
    }

    const normSet = await this.prisma.facadeNormSet.findFirst({
      where: { configId: config.id, isCurrent: true },
      include: {
        norms: {
          include: { material: true },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });
    if (!normSet || normSet.norms.length === 0) {
      return this.saveUnsupported({
        leadId,
        assignmentId: assignment!.id,
        engineerId: user.id,
        configId: config.id,
        area,
        areaSource,
        existing,
        notes: existing?.notes ?? null,
        actorId: user.id,
      });
    }

    const manualByCode = new Map(
      (existing?.items ?? [])
        .filter((item) => item.isManual)
        .map((item) => [item.materialCode, item]),
    );
    if (manualByCode.size > 0 && dto.confirmRecalculate !== true) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        'FACADE_RECALC_CONFIRMATION_REQUIRED',
        'В расчёте есть ручные корректировки. Подтвердите пересчёт.',
        {
          manualItemCodes: [...manualByCode.keys()],
        },
      );
    }

    const extraItems = (existing?.items ?? []).filter((item) => item.isExtra);

    const result = await this.prisma.$transaction(async (tx) => {
      const calculation = existing
        ? await tx.facadeSubsystemCalculation.update({
            where: { id: existing.id },
            data: {
              assignmentId: assignment!.id,
              engineerId: user.id,
              configId: config.id,
              normSetId: normSet.id,
              claddingAreaM2: area,
              areaSource,
              status: FacadeCalculationStatus.CALCULATED,
              revision: { increment: 1 },
            },
          })
        : await tx.facadeSubsystemCalculation.create({
            data: {
              leadId,
              assignmentId: assignment!.id,
              engineerId: user.id,
              configId: config.id,
              normSetId: normSet.id,
              claddingAreaM2: area,
              areaSource,
              status: FacadeCalculationStatus.CALCULATED,
            },
          });

      await tx.facadeSubsystemCalculationItem.deleteMany({
        where: { calculationId: calculation.id, isExtra: false },
      });

      for (const norm of normSet.norms) {
        const calculatedQty = multiplyAreaByNorm(area, norm.qtyPerM2);
        const previous = manualByCode.get(norm.material.code);
        await tx.facadeSubsystemCalculationItem.create({
          data: {
            calculationId: calculation.id,
            materialId: norm.material.id,
            materialCode: norm.material.code,
            materialName: norm.material.nameRu,
            category: norm.material.category,
            unit: norm.unit,
            specSnapshot: (norm.material.spec ?? Prisma.JsonNull) as Prisma.InputJsonValue,
            qtyPerM2: norm.qtyPerM2,
            calculatedQty,
            finalQty: previous ? previous.finalQty : calculatedQty,
            isManual: Boolean(previous),
            isExtra: false,
            note: previous?.note ?? null,
            sortOrder: norm.sortOrder,
          },
        });
      }

      if (!existing) {
        for (const extra of extraItems) {
          await tx.facadeSubsystemCalculationItem.create({
            data: {
              calculationId: calculation.id,
              materialId: extra.materialId,
              materialCode: extra.materialCode,
              materialName: extra.materialName,
              category: extra.category,
              unit: extra.unit,
              specSnapshot: extra.specSnapshot as Prisma.InputJsonValue,
              qtyPerM2: extra.qtyPerM2,
              calculatedQty: extra.calculatedQty,
              finalQty: extra.finalQty,
              isManual: true,
              isExtra: true,
              note: extra.note,
              sortOrder: extra.sortOrder,
            },
          });
        }
      }

      await tx.facadeSubsystemCalculationRevision.create({
        data: {
          calculationId: calculation.id,
          actorId: user.id,
          action: existing ? 'RECALCULATED' : 'CREATED',
          payload: {
            claddingAreaM2: area.toFixed(),
            configCode: config.code,
            normSetCode: normSet.code,
            quoteCreated: false,
            dealCreated: false,
          },
        },
      });

      return tx.facadeSubsystemCalculation.findUniqueOrThrow({
        where: { id: calculation.id },
        include: calculationInclude,
      });
    });

    return {
      ...this.toCalculationView(result),
      quoteCreated: false,
      dealCreated: false,
    };
  }

  async saveDraft(leadId: string, dto: FacadeSaveDraftDto, user: CurrentUser) {
    const { canEdit } = await this.loadAccess(leadId, user);
    this.assertCanEdit(canEdit);
    const existing = await this.requireCalculation(leadId);
    this.assertRevision(existing, dto.expectedRevision);

    const itemUpdates = new Map(
      (dto.items ?? []).map((item) => [item.id, item]),
    );

    const result = await this.prisma.$transaction(async (tx) => {
      if (dto.items) {
        for (const item of existing.items) {
          const update = itemUpdates.get(item.id);
          if (!update) {
            continue;
          }
          const finalQty = this.parseNonNegativeDecimal(
            update.finalQty,
            'FACADE_QTY_INVALID',
            'Количество не может быть отрицательным',
          );
          const calculated = item.calculatedQty
            ? toDecimal(item.calculatedQty)
            : null;
          const isManual =
            item.isExtra ||
            !calculated ||
            !calculated.eq(finalQty);
          await tx.facadeSubsystemCalculationItem.update({
            where: { id: item.id },
            data: {
              finalQty,
              isManual,
              note: update.note === undefined ? item.note : update.note,
            },
          });
        }
      }

      const updated = await tx.facadeSubsystemCalculation.update({
        where: { id: existing.id },
        data: {
          notes: dto.notes === undefined ? existing.notes : dto.notes,
          revision: { increment: 1 },
        },
        include: calculationInclude,
      });

      await tx.facadeSubsystemCalculationRevision.create({
        data: {
          calculationId: existing.id,
          actorId: user.id,
          action: 'SAVED',
          payload: { quoteCreated: false, dealCreated: false },
        },
      });

      return updated;
    });

    return {
      ...this.toCalculationView(result),
      quoteCreated: false,
      dealCreated: false,
    };
  }

  async addItem(leadId: string, dto: FacadeAddItemDto, user: CurrentUser) {
    const { canEdit } = await this.loadAccess(leadId, user);
    this.assertCanEdit(canEdit);
    const existing = await this.requireCalculation(leadId);
    this.assertRevision(existing, dto.expectedRevision);

    const material = await this.prisma.facadeMaterial.findFirst({
      where: { id: dto.materialId, isActive: true },
    });
    if (!material) {
      throw new BusinessException(
        HttpStatus.BAD_REQUEST,
        'FACADE_MATERIAL_UNKNOWN',
        'Материал не найден в каталоге',
      );
    }

    const finalQty = this.parseNonNegativeDecimal(
      dto.finalQty,
      'FACADE_QTY_INVALID',
      'Количество не может быть отрицательным',
    );

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.facadeSubsystemCalculationItem.create({
        data: {
          calculationId: existing.id,
          materialId: material.id,
          materialCode: material.code,
          materialName: material.nameRu,
          category: material.category,
          unit: material.unit,
          specSnapshot: (material.spec ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          qtyPerM2: null,
          calculatedQty: null,
          finalQty,
          isManual: true,
          isExtra: true,
          note: dto.note ?? null,
          sortOrder: (existing.items.at(-1)?.sortOrder ?? 0) + 1,
        },
      });

      const updated = await tx.facadeSubsystemCalculation.update({
        where: { id: existing.id },
        data: { revision: { increment: 1 } },
        include: calculationInclude,
      });

      await tx.facadeSubsystemCalculationRevision.create({
        data: {
          calculationId: existing.id,
          actorId: user.id,
          action: 'ITEM_ADDED',
          payload: { materialCode: material.code },
        },
      });

      return updated;
    });

    return this.toCalculationView(result);
  }

  private async saveUnsupported(input: {
    leadId: string;
    assignmentId: string;
    engineerId: string;
    configId: string;
    area: Prisma.Decimal;
    areaSource: FacadeAreaSource;
    existing: Prisma.FacadeSubsystemCalculationGetPayload<{
      include: typeof calculationInclude;
    }> | null;
    notes: string | null;
    actorId: string;
  }) {
    const result = await this.prisma.$transaction(async (tx) => {
      const calculation = input.existing
        ? await tx.facadeSubsystemCalculation.update({
            where: { id: input.existing.id },
            data: {
              assignmentId: input.assignmentId,
              engineerId: input.engineerId,
              configId: input.configId,
              normSetId: null,
              claddingAreaM2: input.area,
              areaSource: input.areaSource,
              status: FacadeCalculationStatus.UNSUPPORTED,
              revision: { increment: 1 },
            },
          })
        : await tx.facadeSubsystemCalculation.create({
            data: {
              leadId: input.leadId,
              assignmentId: input.assignmentId,
              engineerId: input.engineerId,
              configId: input.configId,
              claddingAreaM2: input.area,
              areaSource: input.areaSource,
              notes: input.notes,
              status: FacadeCalculationStatus.UNSUPPORTED,
            },
          });

      await tx.facadeSubsystemCalculationItem.deleteMany({
        where: { calculationId: calculation.id, isExtra: false },
      });

      await tx.facadeSubsystemCalculationRevision.create({
        data: {
          calculationId: calculation.id,
          actorId: input.actorId,
          action: 'UNSUPPORTED_CONFIG',
          payload: { ready: false },
        },
      });

      return tx.facadeSubsystemCalculation.findUniqueOrThrow({
        where: { id: calculation.id },
        include: calculationInclude,
      });
    });

    return {
      ...this.toCalculationView(result),
      quoteCreated: false,
      dealCreated: false,
    };
  }

  private suggestArea(
    qualification: {
      requiredAreaM2: Prisma.Decimal | null;
      items: Array<{ requiredAreaM2: Prisma.Decimal | null }>;
    } | null,
  ) {
    if (!qualification) {
      return { value: null, source: null, ambiguous: false };
    }

    const itemAreas = qualification.items
      .map((item) => item.requiredAreaM2)
      .filter((value): value is Prisma.Decimal => value !== null)
      .map((value) => value.toFixed());
    const unique = [...new Set(itemAreas)];

    if (unique.length > 1) {
      return {
        value: null,
        source: null,
        ambiguous: true,
        candidates: unique,
      };
    }

    if (unique.length === 1) {
      return {
        value: unique[0],
        source: FacadeAreaSource.HPL_QUALIFICATION,
        ambiguous: false,
      };
    }

    if (qualification.requiredAreaM2) {
      return {
        value: qualification.requiredAreaM2.toFixed(),
        source: FacadeAreaSource.HPL_QUALIFICATION,
        ambiguous: false,
      };
    }

    return { value: null, source: null, ambiguous: false };
  }

  private async loadAccess(leadId: string, user: CurrentUser) {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, deletedAt: null },
      include: {
        qualification: {
          include: {
            items: { orderBy: { sortOrder: 'asc' }, select: { requiredAreaM2: true } },
          },
        },
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
    const engineerReader = hasEngineeringReadPermission(user.permissions);
    const assignment = engineerReader
      ? await findActiveEngineeringAssignment(this.prisma, leadId, user.id)
      : await this.prisma.leadEngineeringAssignment.findFirst({
          where: { leadId, status: 'ACTIVE', activeLeadId: leadId },
        });

    if (!ownerAccess && !(engineerReader && assignment)) {
      throw new BusinessException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'У вас нет доступа к этому расчёту подсистемы',
      );
    }

    const canEdit =
      Boolean(assignment) &&
      assignment?.engineerId === user.id &&
      user.permissions.includes(ENGINEERING_PERMISSIONS.UPDATE_TECHNICAL);

    return { lead, assignment, canEdit };
  }

  private assertCanEdit(canEdit: boolean): void {
    if (!canEdit) {
      throw new BusinessException(
        HttpStatus.FORBIDDEN,
        'FACADE_EDIT_FORBIDDEN',
        'Редактировать расчёт подсистемы может только назначенный инженер',
      );
    }
  }

  private assertSubsystemRequired(
    qualification: { ventFacadeKitRequired?: boolean | null } | null,
  ): void {
    if (qualification?.ventFacadeKitRequired !== true) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        'FACADE_NOT_APPLICABLE',
        'Автоматический расчёт подсистемы создаётся только при заказе подсистемы',
      );
    }
  }

  private assertRevision(
    existing: { revision: number } | null,
    expected?: number,
  ): void {
    if (!existing || expected === undefined) {
      return;
    }
    if (existing.revision !== expected) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        'FACADE_REVISION_CONFLICT',
        'Расчёт уже изменён. Обновите данные и повторите сохранение.',
        { currentRevision: existing.revision },
      );
    }
  }

  private async requireCalculation(leadId: string) {
    const calculation = await this.prisma.facadeSubsystemCalculation.findUnique({
      where: { leadId },
      include: calculationInclude,
    });
    if (!calculation) {
      throw new BusinessException(
        HttpStatus.NOT_FOUND,
        'FACADE_CALCULATION_NOT_FOUND',
        'Расчёт подсистемы ещё не создан',
      );
    }
    return calculation;
  }

  private parsePositiveDecimal(
    raw: string,
    errorCode: string,
    message: string,
  ): Prisma.Decimal {
    const value = this.parseNonNegativeDecimal(raw, errorCode, message);
    if (value.lte(0)) {
      throw new BusinessException(HttpStatus.BAD_REQUEST, errorCode, message);
    }
    return value;
  }

  private parseNonNegativeDecimal(
    raw: string,
    errorCode: string,
    message: string,
  ): Prisma.Decimal {
    try {
      const value = toDecimal(raw.trim());
      if (!value.isFinite() || value.lt(0)) {
        throw new Error('invalid');
      }
      return value;
    } catch {
      throw new BusinessException(HttpStatus.BAD_REQUEST, errorCode, message);
    }
  }

  private toMaterialView(material: {
    id: string;
    code: string;
    nameRu: string;
    nameEn: string;
    nameUz: string;
    category: string;
    unit: string;
    spec: Prisma.JsonValue | null;
  }) {
    return {
      id: material.id,
      code: material.code,
      nameRu: material.nameRu,
      nameEn: material.nameEn,
      nameUz: material.nameUz,
      category: material.category,
      unit: material.unit,
      spec: material.spec,
      hasPrice: false,
      price: null,
    };
  }

  private toCalculationView(
    calculation: Prisma.FacadeSubsystemCalculationGetPayload<{
      include: typeof calculationInclude;
    }>,
  ) {
    return {
      id: calculation.id,
      leadId: calculation.leadId,
      assignmentId: calculation.assignmentId,
      engineerId: calculation.engineerId,
      status: calculation.status,
      revision: calculation.revision,
      claddingAreaM2: decimalToString(calculation.claddingAreaM2),
      areaSource: calculation.areaSource,
      notes: calculation.notes,
      configCode: calculation.config.code,
      configIsCalculable: calculation.config.isCalculable,
      normSetCode: calculation.normSet?.code ?? null,
      ready: calculation.status === FacadeCalculationStatus.CALCULATED,
      items: calculation.items.map((item) => ({
        id: item.id,
        materialId: item.materialId,
        materialCode: item.materialCode,
        materialName: item.materialName,
        category: item.category,
        unit: item.unit,
        spec: item.specSnapshot,
        qtyPerM2: decimalToString(item.qtyPerM2),
        calculatedQty: decimalToString(item.calculatedQty),
        finalQty: toDecimal(item.finalQty).toFixed(),
        isManual: item.isManual,
        isExtra: item.isExtra,
        note: item.note,
        sortOrder: item.sortOrder,
      })),
      createdAt: calculation.createdAt,
      updatedAt: calculation.updatedAt,
      baseConfigCode: BASE_FACADE_CONFIG_CODE,
      baseNormSetCode: BASE_FACADE_NORM_SET_CODE,
    };
  }
}
