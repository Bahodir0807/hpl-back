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
  LeadStatus,
  Prisma,
} from '@prisma/client';
import { BusinessException } from '../../common/exceptions/business.exception';
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
import {
  canonicalizePanelTypeCode,
  panelTypeCodeForApplication,
} from '../../panels/hpl-catalog';
import { validateHplThickness } from '../../panels/hpl-thickness';

const READ_ALL_LEADS_PERMISSION = 'leads:read_all';

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
  });

type PrismaTx = Prisma.TransactionClient;

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
    assertCustomDimensionsPair(dto);
    const writeData = mapQualificationWriteData(dto);
    const existing = await tx.leadQualification.findUnique({
      where: { leadId },
      select: {
        application: true,
        thicknessMm: true,
        panelTypeId: true,
      },
    });
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
