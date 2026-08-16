import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ActivityType,
  HplApplication,
  Lead,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UpsertLeadQualificationDto } from './dto/upsert-lead-qualification.dto';
import {
  mapQualificationWriteData,
  serializeLeadQualification,
  toCalculationRequirementPrefill,
} from './lead-qualification.mapper';
import {
  assertCustomDimensionsPair,
  assertStage1QualificationComplete,
} from './lead-qualification.rules';

const READ_ALL_LEADS_PERMISSION = 'leads:read_all';

const qualificationInclude = Prisma.validator<Prisma.LeadQualificationInclude>()(
  {
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
  },
);

type PrismaTx = Prisma.TransactionClient;

@Injectable()
export class LeadQualificationService {
  constructor(private readonly prisma: PrismaService) {}

  async get(leadId: string, currentUserId: string, permissions: string[]) {
    const lead = await this.ensureLeadAccess(leadId, currentUserId, permissions);
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
    };
  }

  async upsert(
    leadId: string,
    dto: UpsertLeadQualificationDto,
    currentUserId: string,
    permissions: string[],
  ) {
    await this.ensureLeadAccess(leadId, currentUserId, permissions);

    return this.prisma.$transaction((tx) =>
      this.upsertInTx(tx, leadId, dto, currentUserId, 'lead_qualification_updated'),
    );
  }

  async upsertInTx(
    tx: PrismaTx,
    leadId: string,
    dto: UpsertLeadQualificationDto,
    currentUserId: string,
    activityAction: string,
  ) {
    assertCustomDimensionsPair(dto);
    const writeData = mapQualificationWriteData(dto);
    await this.assertCatalogReferences(tx, writeData);

    const qualification = await this.upsertQualificationRow(
      tx,
      leadId,
      writeData,
    );

    await tx.activity.create({
      data: {
        type: ActivityType.NOTE,
        relatedType: 'Lead',
        relatedId: leadId,
        authorId: currentUserId,
        content: 'Stage-1 HPL qualification updated',
        metadata: {
          action: activityAction,
          application: qualification.application,
          installationRequired: qualification.installationRequired,
          stockOnly: qualification.stockOnly,
          urgent: qualification.urgent,
          willingToWait: qualification.willingToWait,
        },
      },
    });

    return serializeLeadQualification(qualification);
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

  private async assertCatalogReferences(
    tx: PrismaTx,
    data: ReturnType<typeof mapQualificationWriteData>,
  ): Promise<void> {
    if (data.panelTypeId) {
      const panelType = await tx.panelType.findUnique({
        where: { id: data.panelTypeId },
        select: { id: true, code: true, isActive: true },
      });

      if (!panelType || !panelType.isActive) {
        throw new BadRequestException('panelTypeId is invalid or inactive');
      }

      if (
        data.application === HplApplication.INTERIOR &&
        panelType.code === 'exterior'
      ) {
        throw new BadRequestException(
          'panelTypeId is incompatible with application INTERIOR',
        );
      }

      if (
        data.application === HplApplication.EXTERIOR &&
        panelType.code === 'interior'
      ) {
        throw new BadRequestException(
          'panelTypeId is incompatible with application EXTERIOR',
        );
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
  ): Promise<Lead> {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, deletedAt: null },
    });

    if (!lead) {
      throw new NotFoundException('Lead not found');
    }

    if (permissions.includes(READ_ALL_LEADS_PERMISSION)) {
      return lead;
    }

    if (lead.ownerId === currentUserId) {
      return lead;
    }

    throw new ForbiddenException('Access to this lead is forbidden');
  }
}
