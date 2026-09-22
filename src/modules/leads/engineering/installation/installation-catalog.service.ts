import { HttpStatus, Injectable } from '@nestjs/common';
import { ActivityType, InstallationWorkUnit, Prisma } from '@prisma/client';
import { BusinessException } from '../../../../common/exceptions/business.exception';
import type { CurrentUser } from '../../../../common/interfaces/current-user.interface';
import { PrismaService } from '../../../prisma/prisma.service';
import { decimalToString, toDecimal } from '../facade/facade-decimal';
import { INSTALLATION_PRICING_PERMISSIONS } from './installation-pricing.constants';
import type {
  CreateInstallationContractorDto,
  CreateInstallationRateDto,
  CreateInstallationWorkTypeDto,
  UpdateInstallationContractorDto,
  UpdateInstallationRateDto,
  UpdateInstallationWorkTypeDto,
} from './dto/installation-catalog.dto';

@Injectable()
export class InstallationCatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async listWorkTypes(user: CurrentUser, includeInactive = false) {
    this.assertCatalogRead(user);
    const items = await this.prisma.installationWorkType.findMany({
      where: includeInactive ? undefined : { isActive: true },
      orderBy: [{ category: 'asc' }, { nameRu: 'asc' }],
    });
    return { items: items.map((item) => this.toWorkTypeView(item)) };
  }

  async createWorkType(dto: CreateInstallationWorkTypeDto, user: CurrentUser) {
    this.assertManageContractors(user);
    const code = this.normalizeCode(dto.code);
    const existing = await this.prisma.installationWorkType.findUnique({
      where: { code },
    });
    if (existing) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        'INSTALLATION_WORK_TYPE_CODE_EXISTS',
        'Код вида работ уже используется',
      );
    }
    const created = await this.prisma.$transaction(async (tx) => {
      const workType = await tx.installationWorkType.create({
        data: {
          code,
          nameRu: dto.nameRu.trim(),
          nameUz: dto.nameUz.trim(),
          nameEn: dto.nameEn.trim(),
          description: dto.description?.trim() || null,
          unit: dto.unit,
          category: dto.category ?? 'OTHER',
          isActive: dto.isActive ?? true,
        },
      });
      await this.writeHistory(tx, {
        actorId: user.id,
        action: 'INSTALLATION_WORK_TYPE_CREATED',
        entityType: 'InstallationWorkType',
        entityId: workType.id,
        content: 'Создан вид монтажных работ',
        metadata: { code: workType.code, unit: workType.unit },
      });
      return workType;
    });
    return this.toWorkTypeView(created);
  }

  async updateWorkType(
    id: string,
    dto: UpdateInstallationWorkTypeDto,
    user: CurrentUser,
  ) {
    this.assertManageContractors(user);
    const existing = await this.prisma.installationWorkType.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new BusinessException(
        HttpStatus.NOT_FOUND,
        'INSTALLATION_WORK_TYPE_NOT_FOUND',
        'Вид монтажных работ не найден',
      );
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const workType = await tx.installationWorkType.update({
        where: { id },
        data: {
          nameRu: dto.nameRu?.trim(),
          nameUz: dto.nameUz?.trim(),
          nameEn: dto.nameEn?.trim(),
          description:
            dto.description === undefined
              ? undefined
              : dto.description?.trim() || null,
          unit: dto.unit,
          category: dto.category,
          isActive: dto.isActive,
        },
      });
      await this.writeHistory(tx, {
        actorId: user.id,
        action: 'INSTALLATION_WORK_TYPE_UPDATED',
        entityType: 'InstallationWorkType',
        entityId: workType.id,
        content: 'Обновлён вид монтажных работ',
        metadata: { code: workType.code, isActive: workType.isActive },
      });
      return workType;
    });
    return this.toWorkTypeView(updated);
  }

  async listContractors(user: CurrentUser, includeInactive = false) {
    this.assertCatalogRead(user);
    const items = await this.prisma.installationContractor.findMany({
      where: includeInactive ? undefined : { isActive: true },
      include: { supplier: { select: { id: true, name: true, code: true } } },
      orderBy: { name: 'asc' },
    });
    return { items: items.map((item) => this.toContractorView(item)) };
  }

  async createContractor(
    dto: CreateInstallationContractorDto,
    user: CurrentUser,
  ) {
    this.assertManageContractors(user);
    if (dto.supplierId) {
      await this.requireSupplier(dto.supplierId);
    }
    const created = await this.prisma.$transaction(async (tx) => {
      const contractor = await tx.installationContractor.create({
        data: {
          name: dto.name.trim(),
          type: dto.type,
          contactName: dto.contactName?.trim() || null,
          phone: dto.phone?.trim() || null,
          note: dto.note?.trim() || null,
          supplierId: dto.supplierId ?? null,
          isActive: dto.isActive ?? true,
        },
        include: { supplier: { select: { id: true, name: true, code: true } } },
      });
      await this.writeHistory(tx, {
        actorId: user.id,
        action: 'INSTALLATION_CONTRACTOR_CREATED',
        entityType: 'InstallationContractor',
        entityId: contractor.id,
        content: 'Создана монтажная бригада / подрядчик',
        metadata: {
          type: contractor.type,
          supplierId: contractor.supplierId,
          installerRoleCreated: false,
        },
      });
      return contractor;
    });
    return this.toContractorView(created);
  }

  async updateContractor(
    id: string,
    dto: UpdateInstallationContractorDto,
    user: CurrentUser,
  ) {
    this.assertManageContractors(user);
    const existing = await this.prisma.installationContractor.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new BusinessException(
        HttpStatus.NOT_FOUND,
        'INSTALLATION_CONTRACTOR_NOT_FOUND',
        'Бригада или подрядчик не найдены',
      );
    }
    if (dto.supplierId) {
      await this.requireSupplier(dto.supplierId);
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const contractor = await tx.installationContractor.update({
        where: { id },
        data: {
          name: dto.name?.trim(),
          type: dto.type,
          contactName:
            dto.contactName === undefined
              ? undefined
              : dto.contactName?.trim() || null,
          phone: dto.phone === undefined ? undefined : dto.phone?.trim() || null,
          note: dto.note === undefined ? undefined : dto.note?.trim() || null,
          supplierId:
            dto.supplierId === undefined ? undefined : dto.supplierId,
          isActive: dto.isActive,
        },
        include: { supplier: { select: { id: true, name: true, code: true } } },
      });
      await this.writeHistory(tx, {
        actorId: user.id,
        action: 'INSTALLATION_CONTRACTOR_UPDATED',
        entityType: 'InstallationContractor',
        entityId: contractor.id,
        content: 'Обновлена монтажная бригада / подрядчик',
        metadata: { isActive: contractor.isActive, type: contractor.type },
      });
      return contractor;
    });
    return this.toContractorView(updated);
  }

  async listRates(
    user: CurrentUser,
    query: {
      contractorId?: string;
      workTypeId?: string;
      includeInactive?: boolean;
    },
  ) {
    this.assertReadCost(user);
    const rates = await this.prisma.installationContractorRate.findMany({
      where: {
        contractorId: query.contractorId,
        workTypeId: query.workTypeId,
        isActive: query.includeInactive ? undefined : true,
      },
      include: {
        contractor: true,
        workType: true,
      },
      orderBy: [{ createdAt: 'desc' }],
    });
    return { items: rates.map((rate) => this.toRateView(rate)) };
  }

  async createRate(dto: CreateInstallationRateDto, user: CurrentUser) {
    this.assertManageRates(user);
    const [contractor, workType] = await Promise.all([
      this.prisma.installationContractor.findUnique({
        where: { id: dto.contractorId },
      }),
      this.prisma.installationWorkType.findUnique({
        where: { id: dto.workTypeId },
      }),
    ]);
    if (!contractor) {
      throw new BusinessException(
        HttpStatus.BAD_REQUEST,
        'INSTALLATION_CONTRACTOR_NOT_FOUND',
        'Бригада или подрядчик не найдены',
      );
    }
    if (!workType) {
      throw new BusinessException(
        HttpStatus.BAD_REQUEST,
        'INSTALLATION_WORK_TYPE_NOT_FOUND',
        'Вид монтажных работ не найден',
      );
    }
    this.assertRateUnitCompatible(dto.unit, workType.unit);
    const created = await this.prisma.$transaction(async (tx) => {
      const rate = await tx.installationContractorRate.create({
        data: {
          contractorId: dto.contractorId,
          workTypeId: dto.workTypeId,
          unit: dto.unit,
          pricePerUnit: this.parseNonNegativePrice(dto.pricePerUnit),
          currency: this.normalizeCurrency(dto.currency),
          validFrom: new Date(dto.validFrom),
          validTo: dto.validTo ? new Date(dto.validTo) : null,
          isActive: dto.isActive ?? true,
          note: dto.note?.trim() || null,
        },
        include: { contractor: true, workType: true },
      });
      await this.writeHistory(tx, {
        actorId: user.id,
        action: 'INSTALLATION_RATE_CREATED',
        entityType: 'InstallationContractorRate',
        entityId: rate.id,
        content: 'Создан тариф монтажных работ',
        metadata: {
          contractorId: rate.contractorId,
          workTypeId: rate.workTypeId,
          currency: rate.currency,
          unit: rate.unit,
        },
      });
      return rate;
    });
    return this.toRateView(created);
  }

  async updateRate(
    id: string,
    dto: UpdateInstallationRateDto,
    user: CurrentUser,
  ) {
    this.assertManageRates(user);
    const existing = await this.prisma.installationContractorRate.findUnique({
      where: { id },
      include: { workType: true },
    });
    if (!existing) {
      throw new BusinessException(
        HttpStatus.NOT_FOUND,
        'INSTALLATION_RATE_NOT_FOUND',
        'Тариф не найден',
      );
    }
    const nextUnit = dto.unit ?? existing.unit;
    this.assertRateUnitCompatible(nextUnit, existing.workType.unit);
    const updated = await this.prisma.$transaction(async (tx) => {
      const rate = await tx.installationContractorRate.update({
        where: { id },
        data: {
          unit: dto.unit,
          pricePerUnit:
            dto.pricePerUnit === undefined
              ? undefined
              : this.parseNonNegativePrice(dto.pricePerUnit),
          currency:
            dto.currency === undefined
              ? undefined
              : this.normalizeCurrency(dto.currency),
          validFrom: dto.validFrom ? new Date(dto.validFrom) : undefined,
          validTo:
            dto.validTo === undefined
              ? undefined
              : dto.validTo
                ? new Date(dto.validTo)
                : null,
          isActive: dto.isActive,
          note: dto.note === undefined ? undefined : dto.note?.trim() || null,
        },
        include: { contractor: true, workType: true },
      });
      await this.writeHistory(tx, {
        actorId: user.id,
        action: 'INSTALLATION_RATE_UPDATED',
        entityType: 'InstallationContractorRate',
        entityId: rate.id,
        content: 'Обновлён тариф монтажных работ',
        metadata: { isActive: rate.isActive, currency: rate.currency },
      });
      return rate;
    });
    return this.toRateView(updated);
  }

  private assertCatalogRead(user: CurrentUser): void {
    if (
      user.permissions.includes(INSTALLATION_PRICING_PERMISSIONS.MANAGE_CONTRACTORS) ||
      user.permissions.includes(INSTALLATION_PRICING_PERMISSIONS.MANAGE_RATES) ||
      user.permissions.includes(INSTALLATION_PRICING_PERMISSIONS.READ_COST) ||
      user.permissions.includes(INSTALLATION_PRICING_PERMISSIONS.PREPARE)
    ) {
      return;
    }
    throw new BusinessException(
      HttpStatus.FORBIDDEN,
      'FORBIDDEN',
      'Нет доступа к справочнику монтажных работ',
    );
  }

  private assertManageContractors(user: CurrentUser): void {
    if (
      !user.permissions.includes(
        INSTALLATION_PRICING_PERMISSIONS.MANAGE_CONTRACTORS,
      )
    ) {
      throw new BusinessException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Нет права управлять бригадами и видами работ',
      );
    }
  }

  private assertManageRates(user: CurrentUser): void {
    if (
      !user.permissions.includes(INSTALLATION_PRICING_PERMISSIONS.MANAGE_RATES)
    ) {
      throw new BusinessException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Нет права управлять тарифами монтажа',
      );
    }
  }

  private assertReadCost(user: CurrentUser): void {
    if (
      !user.permissions.includes(INSTALLATION_PRICING_PERMISSIONS.READ_COST)
    ) {
      throw new BusinessException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Нет доступа к тарифам монтажа',
      );
    }
  }

  private assertRateUnitCompatible(
    rateUnit: InstallationWorkUnit,
    workUnit: InstallationWorkUnit,
  ): void {
    if (rateUnit !== workUnit) {
      throw new BusinessException(
        HttpStatus.BAD_REQUEST,
        'INSTALLATION_RATE_UNIT_MISMATCH',
        'Единица тарифа должна совпадать с единицей вида работ',
        { rateUnit, workUnit },
      );
    }
  }

  private async requireSupplier(supplierId: string) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { id: true },
    });
    if (!supplier) {
      throw new BusinessException(
        HttpStatus.BAD_REQUEST,
        'SUPPLIER_NOT_FOUND',
        'Поставщик для внешнего подрядчика не найден',
      );
    }
  }

  private normalizeCode(raw: string): string {
    const code = raw.trim();
    if (!code) {
      throw new BusinessException(
        HttpStatus.BAD_REQUEST,
        'INSTALLATION_WORK_TYPE_CODE_INVALID',
        'Укажите код вида работ',
      );
    }
    return code;
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

  private parseNonNegativePrice(raw: string): Prisma.Decimal {
    try {
      const value = toDecimal(raw.trim());
      if (!value.isFinite() || value.lt(0)) {
        throw new Error('invalid');
      }
      return value;
    } catch {
      throw new BusinessException(
        HttpStatus.BAD_REQUEST,
        'INSTALLATION_RATE_PRICE_INVALID',
        'Тариф не может быть отрицательным',
      );
    }
  }

  private toWorkTypeView(item: {
    id: string;
    code: string;
    nameRu: string;
    nameUz: string;
    nameEn: string;
    description: string | null;
    unit: InstallationWorkUnit;
    category: string;
    isActive: boolean;
  }) {
    return {
      id: item.id,
      code: item.code,
      nameRu: item.nameRu,
      nameUz: item.nameUz,
      nameEn: item.nameEn,
      description: item.description,
      unit: item.unit,
      category: item.category,
      isActive: item.isActive,
    };
  }

  private toContractorView(item: {
    id: string;
    name: string;
    type: string;
    contactName: string | null;
    phone: string | null;
    note: string | null;
    supplierId: string | null;
    isActive: boolean;
    supplier?: { id: string; name: string; code: string } | null;
  }) {
    return {
      id: item.id,
      name: item.name,
      type: item.type,
      contactName: item.contactName,
      phone: item.phone,
      note: item.note,
      supplierId: item.supplierId,
      supplierName: item.supplier?.name ?? null,
      supplierCode: item.supplier?.code ?? null,
      isActive: item.isActive,
      userId: null,
      roleName: null,
    };
  }

  private toRateView(rate: {
    id: string;
    contractorId: string;
    workTypeId: string;
    unit: InstallationWorkUnit;
    pricePerUnit: Prisma.Decimal;
    currency: string;
    validFrom: Date;
    validTo: Date | null;
    isActive: boolean;
    note: string | null;
    contractor: { name: string; type: string; isActive: boolean };
    workType: { code: string; nameRu: string; unit: InstallationWorkUnit };
  }) {
    return {
      id: rate.id,
      contractorId: rate.contractorId,
      contractorName: rate.contractor.name,
      contractorType: rate.contractor.type,
      workTypeId: rate.workTypeId,
      workTypeCode: rate.workType.code,
      workTypeName: rate.workType.nameRu,
      unit: rate.unit,
      pricePerUnit: decimalToString(rate.pricePerUnit),
      currency: rate.currency,
      validFrom: rate.validFrom.toISOString(),
      validTo: rate.validTo?.toISOString() ?? null,
      isActive: rate.isActive,
      note: rate.note,
    };
  }

  private async writeHistory(
    tx: Prisma.TransactionClient,
    input: {
      actorId: string;
      action: string;
      entityType: string;
      entityId: string;
      content: string;
      metadata: Record<string, unknown>;
    },
  ): Promise<void> {
    await tx.activity.create({
      data: {
        type: ActivityType.STATUS_CHANGED,
        relatedType: input.entityType,
        relatedId: input.entityId,
        authorId: input.actorId,
        content: input.content,
        metadata: { action: input.action, ...input.metadata },
      },
    });
    await tx.auditLog.create({
      data: {
        userId: input.actorId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        newValue: input.metadata as Prisma.InputJsonValue,
      },
    });
  }
}
