import { HttpStatus, Injectable, Optional } from '@nestjs/common';
import {
  InstallationCalculationStatus,
  InstallationQuantitySource,
  InstallationWorkUnit,
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
import { decimalToString, toDecimal } from '../facade/facade-decimal';
import {
  INSTALLATION_PERMISSIONS,
} from './installation-pricing.constants';
import type {
  InstallationCompleteDto,
  InstallationSaveDraftDto,
  InstallationSaveItemDto,
} from './dto/installation-calculation.dto';
import { InstallationCommercialService } from './installation-commercial.service';

const calculationInclude = {
  items: { orderBy: { sortOrder: 'asc' as const } },
} satisfies Prisma.InstallationCalculationInclude;

type CalculationRow = Prisma.InstallationCalculationGetPayload<{
  include: typeof calculationInclude;
}>;

@Injectable()
export class InstallationCalculationService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    private readonly installationCommercial: InstallationCommercialService | null = null,
  ) {}

  async getWorkspace(leadId: string, user: CurrentUser) {
    const { lead, assignment, canEdit } = await this.loadAccess(leadId, user);
    const qualification = lead.qualification;
    const installationRequired = qualification?.installationRequired === true;

    const [workTypes, calculation] = await Promise.all([
      this.prisma.installationWorkType.findMany({
        where: { isActive: true },
        orderBy: [{ category: 'asc' }, { nameRu: 'asc' }],
      }),
      this.prisma.installationCalculation.findUnique({
        where: { leadId },
        include: calculationInclude,
      }),
    ]);

    return {
      applicable: installationRequired,
      reason: installationRequired ? null : 'INSTALLATION_NOT_REQUESTED',
      canEdit,
      assignmentId: assignment?.id ?? null,
      suggestedArea: this.suggestArea(qualification),
      approvedNormAvailable: false,
      workTypes: workTypes.map((item) => ({
        id: item.id,
        code: item.code,
        nameRu: item.nameRu,
        nameEn: item.nameEn,
        nameUz: item.nameUz,
        description: item.description,
        unit: item.unit,
        category: item.category,
      })),
      calculation: calculation ? this.toCalculationView(calculation) : null,
      quoteCreated: false,
      dealCreated: false,
    };
  }

  async saveDraft(
    leadId: string,
    dto: InstallationSaveDraftDto,
    user: CurrentUser,
  ) {
    const { lead, assignment, canEdit } = await this.loadAccess(leadId, user);
    this.assertCanEdit(canEdit);
    this.assertInstallationRequired(lead.qualification);

    const existing = await this.prisma.installationCalculation.findUnique({
      where: { leadId },
      include: calculationInclude,
    });
    this.assertRevision(existing, dto.expectedRevision);

    const workTypes = await this.prisma.installationWorkType.findMany({
      where: { isActive: true },
    });
    const workTypeById = new Map(workTypes.map((item) => [item.id, item]));
    const nextItems = this.buildItems(
      dto.items ?? [],
      workTypeById,
      this.suggestArea(lead.qualification),
    );

    const result = await this.prisma.$transaction(async (tx) => {
      const calculation = existing
        ? await tx.installationCalculation.update({
            where: { id: existing.id },
            data: {
              assignmentId: assignment!.id,
              engineerId: user.id,
              note: dto.note === undefined ? existing.note : dto.note,
              revision: { increment: 1 },
            },
          })
        : await tx.installationCalculation.create({
            data: {
              leadId,
              assignmentId: assignment!.id,
              engineerId: user.id,
              note: dto.note ?? null,
              status: InstallationCalculationStatus.DRAFT,
            },
          });

      await tx.installationCalculationItem.deleteMany({
        where: { calculationId: calculation.id },
      });
      if (nextItems.length > 0) {
        await tx.installationCalculationItem.createMany({
          data: nextItems.map((item, index) => ({
            calculationId: calculation.id,
            workTypeId: item.workTypeId,
            workTypeCode: item.workTypeCode,
            workTypeName: item.workTypeName,
            workTypeSnapshot: item.workTypeSnapshot as Prisma.InputJsonValue,
            unit: item.unit,
            quantity: item.quantity,
            quantitySource: item.quantitySource,
            note: item.note,
            sortOrder: item.sortOrder ?? index,
          })),
        });
      }
      await tx.installationCalculationRevision.create({
        data: {
          calculationId: calculation.id,
          actorId: user.id,
          action: existing ? 'INSTALLATION_DRAFT_SAVED' : 'INSTALLATION_CREATED',
          payload: {
            itemCount: nextItems.length,
            previousRevision: existing?.revision ?? null,
          } as Prisma.InputJsonValue,
        },
      });
      return tx.installationCalculation.findUniqueOrThrow({
        where: { id: calculation.id },
        include: calculationInclude,
      });
    });

    await this.notifyTechnicalChange(result);
    return this.toCalculationView(result);
  }

  async complete(
    leadId: string,
    dto: InstallationCompleteDto,
    user: CurrentUser,
  ) {
    const { lead, assignment, canEdit } = await this.loadAccess(leadId, user);
    this.assertCanEdit(canEdit);
    this.assertInstallationRequired(lead.qualification);

    const existing = await this.prisma.installationCalculation.findUnique({
      where: { leadId },
      include: calculationInclude,
    });
    if (!existing) {
      throw new BusinessException(
        HttpStatus.NOT_FOUND,
        'INSTALLATION_CALCULATION_NOT_FOUND',
        'Монтажный расчёт ещё не создан',
      );
    }
    this.assertRevision(existing, dto.expectedRevision);
    if (existing.items.length === 0) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        'INSTALLATION_ITEMS_REQUIRED',
        'Добавьте хотя бы одну монтажную работу перед завершением подготовки',
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.installationCalculation.update({
        where: { id: existing.id },
        data: {
          assignmentId: assignment!.id,
          engineerId: user.id,
          status: InstallationCalculationStatus.READY,
          revision: { increment: 1 },
        },
      });
      await tx.installationCalculationRevision.create({
        data: {
          calculationId: existing.id,
          actorId: user.id,
          action: 'INSTALLATION_TECHNICAL_READY',
          payload: { itemCount: existing.items.length } as Prisma.InputJsonValue,
        },
      });
      return tx.installationCalculation.findUniqueOrThrow({
        where: { id: existing.id },
        include: calculationInclude,
      });
    });

    await this.notifyTechnicalChange(result);
    return this.toCalculationView(result);
  }

  private buildItems(
    items: InstallationSaveItemDto[],
    workTypeById: Map<
      string,
      {
        id: string;
        code: string;
        nameRu: string;
        nameEn: string;
        nameUz: string;
        description: string | null;
        unit: InstallationWorkUnit;
        category: string;
        isActive: boolean;
      }
    >,
    suggestedArea: {
      value: string | null;
      source: string | null;
      ambiguous: boolean;
    },
  ) {
    return items.map((item, index) => {
      const workType = workTypeById.get(item.workTypeId);
      if (!workType) {
        throw new BusinessException(
          HttpStatus.BAD_REQUEST,
          'INSTALLATION_WORK_TYPE_UNKNOWN',
          'Вид монтажных работ не найден или неактивен',
        );
      }
      const quantitySource =
        item.quantitySource ?? InstallationQuantitySource.MANUAL;
      if (quantitySource === InstallationQuantitySource.APPROVED_NORM) {
        throw new BusinessException(
          HttpStatus.CONFLICT,
          'INSTALLATION_NORM_NOT_CONFIGURED',
          'Утверждённой нормы трудозатрат нет. Укажите объём вручную.',
        );
      }
      let quantity = this.parseNonNegativeDecimal(
        item.quantity,
        'INSTALLATION_QTY_INVALID',
        'Объём работ не может быть отрицательным',
      );
      if (quantitySource === InstallationQuantitySource.CONFIRMED_AREA) {
        if (workType.unit !== InstallationWorkUnit.M2) {
          throw new BusinessException(
            HttpStatus.BAD_REQUEST,
            'INSTALLATION_CONFIRMED_AREA_UNIT',
            'Подтверждённую площадь можно выбрать только для работ в м²',
          );
        }
        if (suggestedArea.ambiguous || !suggestedArea.value) {
          throw new BusinessException(
            HttpStatus.CONFLICT,
            'INSTALLATION_CONFIRMED_AREA_MISSING',
            'Подтверждённая площадь облицовки отсутствует или неоднозначна',
          );
        }
        quantity = toDecimal(suggestedArea.value);
      }
      return {
        workTypeId: workType.id,
        workTypeCode: workType.code,
        workTypeName: workType.nameRu,
        workTypeSnapshot: {
          id: workType.id,
          code: workType.code,
          nameRu: workType.nameRu,
          nameEn: workType.nameEn,
          nameUz: workType.nameUz,
          unit: workType.unit,
          category: workType.category,
          description: workType.description,
        },
        unit: workType.unit,
        quantity,
        quantitySource,
        note: item.note ?? null,
        sortOrder: item.sortOrder ?? index,
      };
    });
  }

  private async notifyTechnicalChange(calculation: CalculationRow) {
    if (!this.installationCommercial) {
      return;
    }
    await this.installationCommercial.onTechnicalRevisionChanged(
      calculation.leadId,
      calculation.revision,
      calculation.status,
      calculation.engineerId,
    );
  }

  private async loadAccess(leadId: string, user: CurrentUser) {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, deletedAt: null },
      include: {
        qualification: {
          include: {
            items: {
              orderBy: { sortOrder: 'asc' },
              select: { requiredAreaM2: true },
            },
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
    const engineerReader =
      hasEngineeringReadPermission(user.permissions) ||
      user.permissions.includes(INSTALLATION_PERMISSIONS.READ);
    const assignment = engineerReader
      ? await findActiveEngineeringAssignment(this.prisma, leadId, user.id)
      : await this.prisma.leadEngineeringAssignment.findFirst({
          where: { leadId, status: 'ACTIVE', activeLeadId: leadId },
        });

    if (!ownerAccess && !(engineerReader && assignment)) {
      throw new BusinessException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'У вас нет доступа к монтажному расчёту',
      );
    }

    const canEdit =
      Boolean(assignment) &&
      assignment?.engineerId === user.id &&
      user.permissions.includes(INSTALLATION_PERMISSIONS.UPDATE_TECHNICAL);

    return { lead, assignment, canEdit };
  }

  private assertCanEdit(canEdit: boolean): void {
    if (!canEdit) {
      throw new BusinessException(
        HttpStatus.FORBIDDEN,
        'INSTALLATION_EDIT_FORBIDDEN',
        'Редактировать монтажный расчёт может только назначенный инженер',
      );
    }
  }

  private assertInstallationRequired(
    qualification: { installationRequired?: boolean | null } | null,
  ): void {
    if (qualification?.installationRequired !== true) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        'INSTALLATION_NOT_APPLICABLE',
        'Монтажный расчёт создаётся только если клиенту нужен монтаж',
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
        'INSTALLATION_REVISION_CONFLICT',
        'Расчёт уже изменён. Обновите данные и повторите сохранение.',
        { currentRevision: existing.revision },
      );
    }
  }

  private suggestArea(
    qualification: {
      requiredAreaM2?: Prisma.Decimal | null;
      items?: Array<{ requiredAreaM2: Prisma.Decimal | null }>;
    } | null,
  ) {
    const values = [
      qualification?.requiredAreaM2,
      ...(qualification?.items ?? []).map((item) => item.requiredAreaM2),
    ]
      .filter((value): value is Prisma.Decimal => value != null)
      .map((value) => toDecimal(value).toFixed());
    const unique = [...new Set(values)];
    return {
      value: unique.length === 1 ? unique[0] : null,
      source: unique.length === 1 ? 'HPL_QUALIFICATION' : null,
      ambiguous: unique.length > 1,
      candidates: unique.length > 1 ? unique : undefined,
    };
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

  private toCalculationView(calculation: CalculationRow) {
    return {
      id: calculation.id,
      leadId: calculation.leadId,
      assignmentId: calculation.assignmentId,
      engineerId: calculation.engineerId,
      status: calculation.status,
      revision: calculation.revision,
      note: calculation.note,
      ready: calculation.status === InstallationCalculationStatus.READY,
      quoteCreated: false,
      dealCreated: false,
      items: calculation.items.map((item) => ({
        id: item.id,
        workTypeId: item.workTypeId,
        workTypeCode: item.workTypeCode,
        workTypeName: item.workTypeName,
        unit: item.unit,
        quantity: toDecimal(item.quantity).toFixed(),
        quantitySource: item.quantitySource,
        note: item.note,
        sortOrder: item.sortOrder,
      })),
    };
  }
}
