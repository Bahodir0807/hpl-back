import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ActivityType,
  HplApplication,
  Lead,
  LeadQualification,
  LeadStatus,
  Prisma,
} from '@prisma/client';
import { BusinessException } from '../../common/exceptions/business.exception';
import { PrismaService } from '../prisma/prisma.service';
import { UpsertLeadQualificationDto } from './dto/upsert-lead-qualification.dto';
import {
  mapQualificationItemWriteData,
  mapQualificationWriteData,
  serializeLeadQualification,
  toCalculationRequirementPrefill,
} from './lead-qualification.mapper';
import {
  canAccessLeadRecord,
  hasOwnerOrReadAllLeadAccess,
} from './engineering/engineering-access';
import { ENGINEERING_PERMISSIONS } from './engineering/engineering.constants';
import {
  assertCustomDimensionsPair,
  assertStage1QualificationComplete,
} from './lead-qualification.rules';
import {
  canonicalizePanelTypeCode,
  panelTypeCodeForApplication,
} from '../../panels/hpl-catalog';
import { validateHplThickness } from '../../panels/hpl-thickness';

const qualificationInclude =
  Prisma.validator<Prisma.LeadQualificationInclude>()({
    panelType: {
      select: { id: true, code: true, displayNameRu: true, isActive: true },
    },
    panelSize: {
      select: {
        id: true,
        displayName: true,
        widthMm: true,
        heightMm: true,
        areaM2: true,
        isActive: true,
      },
    },
    items: {
      orderBy: { sortOrder: 'asc' },
      include: {
        panelType: {
          select: { id: true, code: true, displayNameRu: true },
        },
        panelSize: {
          select: {
            id: true,
            displayName: true,
            widthMm: true,
            heightMm: true,
            areaM2: true,
          },
        },
      },
    },
  });

type PrismaTx = Prisma.TransactionClient;

function toLegacyItemMirror(
  item: ReturnType<typeof mapQualificationItemWriteData> | undefined,
) {
  return {
    application: item?.application ?? null,
    panelTypeId: item?.panelTypeId ?? null,
    thicknessMm: item?.thicknessMm ?? null,
    panelSizeId: item?.panelSizeId ?? null,
    customWidthMm: item?.customWidthMm ?? null,
    customHeightMm: item?.customHeightMm ?? null,
    colorCode: item?.colorCode ?? null,
    colorName: item?.colorName ?? null,
    requiredAreaM2: item?.requiredAreaM2 ?? null,
  };
}

function assertUrgencyMutualExclusion(
  urgent: boolean | null | undefined,
  willingToWait: boolean | null | undefined,
): void {
  if (urgent === true && willingToWait === true) {
    throw new BadRequestException(
      'urgent and willingToWait cannot both be true',
    );
  }
}

@Injectable()
export class LeadQualificationService {
  constructor(private readonly prisma: PrismaService) {}

  async get(leadId: string, currentUserId: string, permissions: string[]) {
    const lead = await this.ensureLeadAccess(
      leadId,
      currentUserId,
      permissions,
    );
    const qualification = await this.prisma.leadQualification.findUnique({
      where: { leadId: lead.id },
      include: qualificationInclude,
    });

    return {
      leadId: lead.id,
      qualification: qualification
        ? serializeLeadQualification(qualification)
        : null,
      requirementPrefill: qualification
        ? toCalculationRequirementPrefill(qualification)
        : null,
      ...(qualification?.items
        ? {
            requirementPrefills: qualification.items.map(
              toCalculationRequirementPrefill,
            ),
          }
        : {}),
    };
  }

  async upsert(
    leadId: string,
    dto: UpsertLeadQualificationDto,
    currentUserId: string,
    permissions: string[],
  ) {
    const lead = await this.ensureLeadAccess(
      leadId,
      currentUserId,
      permissions,
      { allowEngineeringWrite: true },
    );
    if (lead.status === LeadStatus.LOST) {
      throw new BadRequestException('Lost lead qualification is immutable');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.lead.update({
        where: { id: leadId },
        data: { updatedAt: new Date() },
      });
      await this.assertFulfillmentFieldsMutable(tx, leadId, dto);
      return this.upsertInTx(
        tx,
        leadId,
        dto,
        currentUserId,
        'lead_qualification_updated',
      );
    });
  }

  async upsertInTx(
    tx: PrismaTx,
    leadId: string,
    dto: UpsertLeadQualificationDto,
    currentUserId: string,
    activityAction: string,
  ) {
    const items = dto.items;
    if (items === undefined) {
      assertCustomDimensionsPair(dto);
    }
    const writeData = mapQualificationWriteData(dto);
    const existing = await tx.leadQualification.findUnique({
      where: { leadId },
      select: {
        id: true,
        application: true,
        thicknessMm: true,
        panelTypeId: true,
        urgent: true,
        willingToWait: true,
      },
    });

    if (items !== undefined) {
      const firstItem = items[0]
        ? mapQualificationItemWriteData(items[0])
        : undefined;
      Object.assign(writeData, toLegacyItemMirror(firstItem));

      for (const item of items) {
        assertCustomDimensionsPair(item);
        const itemData = mapQualificationItemWriteData(item);
        const itemApplication = itemData.application ?? null;

        if (itemData.thicknessMm != null) {
          const thicknessResult = validateHplThickness(
            itemApplication,
            itemData.thicknessMm,
          );
          if (!thicknessResult.ok) {
            throw new BusinessException(
              HttpStatus.BAD_REQUEST,
              thicknessResult.errorCode,
              thicknessResult.message,
            );
          }
          itemData.thicknessMm = thicknessResult.thicknessMm;
        }

        await this.assertCatalogReferences(tx, itemData, itemApplication);
      }
    } else {
      const mergedApplication =
        writeData.application !== undefined
          ? writeData.application
          : existing?.application;
      const mergedThickness =
        writeData.thicknessMm !== undefined
          ? writeData.thicknessMm
          : existing?.thicknessMm;
      if (mergedThickness != null) {
        const thicknessResult = validateHplThickness(
          mergedApplication,
          mergedThickness,
        );
        if (!thicknessResult.ok) {
          throw new BusinessException(
            HttpStatus.BAD_REQUEST,
            thicknessResult.errorCode,
            thicknessResult.message,
          );
        }
        if (writeData.thicknessMm !== undefined) {
          writeData.thicknessMm = thicknessResult.thicknessMm;
        }
      }
      await this.assertCatalogReferences(tx, writeData, mergedApplication);
    }

    if (
      writeData.urgent !== undefined ||
      writeData.willingToWait !== undefined
    ) {
      assertUrgencyMutualExclusion(
        writeData.urgent !== undefined ? writeData.urgent : existing?.urgent,
        writeData.willingToWait !== undefined
          ? writeData.willingToWait
          : existing?.willingToWait,
      );
    }

    const qualification = await this.upsertQualificationRow(
      tx,
      leadId,
      writeData,
    );

    let qualificationWithItems = qualification;
    if (items !== undefined) {
      await this.syncQualificationItems(tx, qualification.id, items);
      qualificationWithItems = await tx.leadQualification.findUniqueOrThrow({
        where: { id: qualification.id },
        include: qualificationInclude,
      });
    } else {
      await this.syncLegacyQualificationItem(tx, qualification);
    }

    await tx.activity.create({
      data: {
        type: ActivityType.NOTE,
        relatedType: 'Lead',
        relatedId: leadId,
        authorId: currentUserId,
        content: 'Stage-1 HPL qualification updated',
        metadata: {
          action: activityAction,
          application: qualificationWithItems.application,
          installationRequired: qualificationWithItems.installationRequired,
          stockOnly: qualificationWithItems.stockOnly,
          urgent: qualificationWithItems.urgent,
          willingToWait: qualificationWithItems.willingToWait,
        },
      },
    });

    return serializeLeadQualification(qualificationWithItems);
  }

  private async syncQualificationItems(
    tx: PrismaTx,
    qualificationId: string,
    items: NonNullable<UpsertLeadQualificationDto['items']>,
  ): Promise<void> {
    const existing = await tx.leadQualificationItem.findMany({
      where: { qualificationId },
      select: { id: true },
    });
    const existingIds = new Set(existing.map((item) => item.id));
    const requestedIds = items
      .map((item) => item.id)
      .filter((id): id is string => Boolean(id));

    for (const id of requestedIds) {
      if (!existingIds.has(id)) {
        throw new BadRequestException(
          `Lead qualification item ${id} does not belong to this qualification`,
        );
      }
    }

    await tx.leadQualificationItem.deleteMany({
      where: {
        qualificationId,
        ...(requestedIds.length ? { id: { notIn: requestedIds } } : {}),
      },
    });

    for (const [sortOrder, item] of items.entries()) {
      const data = {
        ...mapQualificationItemWriteData(item),
        sortOrder,
      };
      if (item.id) {
        await tx.leadQualificationItem.update({
          where: { id: item.id },
          data,
        });
      } else {
        await tx.leadQualificationItem.create({
          data: {
            qualificationId,
            ...data,
          },
        });
      }
    }
  }

  private async syncLegacyQualificationItem(
    tx: PrismaTx,
    qualification: LeadQualification,
  ): Promise<void> {
    const items = await tx.leadQualificationItem.findMany({
      where: { qualificationId: qualification.id },
      select: { id: true },
      take: 2,
    });
    if (items.length !== 1) {
      return;
    }

    await tx.leadQualificationItem.update({
      where: { id: items[0].id },
      data: {
        sortOrder: 0,
        application: qualification.application,
        panelTypeId: qualification.panelTypeId,
        thicknessMm: qualification.thicknessMm,
        panelSizeId: qualification.panelSizeId,
        customWidthMm: qualification.customWidthMm,
        customHeightMm: qualification.customHeightMm,
        colorCode: qualification.colorCode,
        colorName: qualification.colorName,
        requiredAreaM2: qualification.requiredAreaM2,
      },
    });
  }

  private async upsertQualificationRow(
    tx: PrismaTx,
    leadId: string,
    writeData: ReturnType<typeof mapQualificationWriteData>,
  ) {
    try {
      return await tx.leadQualification.upsert({
        where: { leadId },
        create: {
          leadId,
          ...writeData,
        },
        update: writeData,
        include: qualificationInclude,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return tx.leadQualification.update({
          where: { leadId },
          data: writeData,
          include: qualificationInclude,
        });
      }

      throw error;
    }
  }

  assertStage1Complete(
    qualification: Parameters<typeof assertStage1QualificationComplete>[0],
  ): void {
    assertStage1QualificationComplete(qualification);
  }

  private async assertFulfillmentFieldsMutable(
    tx: PrismaTx,
    leadId: string,
    dto: UpsertLeadQualificationDto,
  ): Promise<void> {
    if (dto.stockOnly === undefined && dto.installationRequired === undefined) {
      return;
    }

    const [lead, current, committedQuote] = await Promise.all([
      tx.lead.findUnique({
        where: { id: leadId },
        select: { dealId: true, status: true },
      }),
      tx.leadQualification.findUnique({
        where: { leadId },
        select: { stockOnly: true, installationRequired: true },
      }),
      tx.panelQuote.findFirst({
        where: {
          leadId,
          OR: [
            { status: { in: ['approved', 'converted'] } },
            { clientAcceptedAt: { not: null } },
          ],
        },
        select: { id: true },
      }),
    ]);

    const stockOnlyChanged =
      dto.stockOnly !== undefined && dto.stockOnly !== current?.stockOnly;
    const installationChanged =
      dto.installationRequired !== undefined &&
      dto.installationRequired !== current?.installationRequired;
    const committed =
      lead?.status === LeadStatus.CONVERTED || committedQuote !== null;

    if (committed && (stockOnlyChanged || installationChanged)) {
      throw new ConflictException(
        'Fulfillment-critical qualification fields are immutable after commercial commitment',
      );
    }
  }

  private async assertCatalogReferences(
    tx: PrismaTx,
    data: ReturnType<typeof mapQualificationWriteData>,
    application?: HplApplication | null,
  ): Promise<void> {
    if (data.panelTypeId) {
      const panelType = await tx.panelType.findUnique({
        where: { id: data.panelTypeId },
        select: { id: true, code: true, isActive: true },
      });

      if (!panelType || !panelType.isActive) {
        throw new BadRequestException('panelTypeId is invalid or inactive');
      }

      if (application) {
        const expectedCode = panelTypeCodeForApplication(application);
        const actualCode = canonicalizePanelTypeCode(panelType.code);
        if (actualCode !== expectedCode) {
          throw new BadRequestException(
            `panelTypeId is incompatible with application ${application}`,
          );
        }
      }
    }

    if (data.panelSizeId) {
      const panelSize = await tx.panelSize.findUnique({
        where: { id: data.panelSizeId },
        select: { id: true, isActive: true },
      });

      if (!panelSize || !panelSize.isActive) {
        throw new BadRequestException('panelSizeId is invalid or inactive');
      }
    }
  }

  private async ensureLeadAccess(
    leadId: string,
    currentUserId: string,
    permissions: string[],
    options?: { allowEngineeringWrite?: boolean },
  ): Promise<Lead> {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, deletedAt: null },
    });

    if (!lead) {
      throw new NotFoundException('Lead not found');
    }

    if (hasOwnerOrReadAllLeadAccess(lead, currentUserId, permissions)) {
      return lead;
    }

    const engineeringAllowed = await canAccessLeadRecord(
      this.prisma,
      lead,
      currentUserId,
      permissions,
    );
    if (!engineeringAllowed) {
      throw new ForbiddenException('Access to this lead is forbidden');
    }

    if (
      options?.allowEngineeringWrite &&
      !permissions.includes(ENGINEERING_PERMISSIONS.UPDATE_TECHNICAL)
    ) {
      throw new ForbiddenException('Access to this lead is forbidden');
    }

    return lead;
  }
}
