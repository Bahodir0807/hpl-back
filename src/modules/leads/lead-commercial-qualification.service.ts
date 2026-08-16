import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ActivityType,
  CommercialQualificationStatus,
  HplApplication,
  Lead,
  LeadStatus,
  Prisma,
  TaskComputedStatus,
  TaskStatus,
} from '@prisma/client';
import { panelTypeCodeForApplication } from '../../panels/pricing/hpl-quality-matrix';
import { PrismaService } from '../prisma/prisma.service';
import { UpsertLeadCommercialQualificationDto } from './dto/upsert-lead-commercial-qualification.dto';
import {
  READ_ALL_LEADS_PERMISSION,
  STAGE2_HANDOFF_TASK_PREFIX,
  STAGE2_HANDOFF_TASK_RESULT,
} from './lead.constants';
import {
  commercialQualificationInclude,
  serializeLeadCommercialQualification,
  toCommercialPrefill,
} from './lead-commercial-qualification.mapper';
import { assertStage1QualificationComplete } from './lead-qualification.rules';

type PrismaTx = Prisma.TransactionClient;

@Injectable()
export class LeadCommercialQualificationService {
  constructor(private readonly prisma: PrismaService) {}

  async get(leadId: string, currentUserId: string, permissions: string[]) {
    const lead = await this.ensureLeadAccess(leadId, currentUserId, permissions);
    const commercialQualification =
      await this.prisma.leadCommercialQualification.findUnique({
        where: { leadId: lead.id },
        include: commercialQualificationInclude,
      });

    return {
      leadId: lead.id,
      commercialQualification: commercialQualification
        ? serializeLeadCommercialQualification(commercialQualification)
        : null,
      commercialPrefill: commercialQualification
        ? toCommercialPrefill(commercialQualification)
        : null,
    };
  }

  async confirm(
    leadId: string,
    dto: UpsertLeadCommercialQualificationDto,
    currentUserId: string,
    permissions: string[],
  ) {
    const lead = await this.ensureLeadAccess(leadId, currentUserId, permissions);
    this.assertLeadEligibleForStage2(lead);

    return this.prisma.$transaction((tx) =>
      this.confirmInTx(tx, lead, dto, currentUserId),
    );
  }

  private async confirmInTx(
    tx: PrismaTx,
    lead: Lead,
    dto: UpsertLeadCommercialQualificationDto,
    currentUserId: string,
  ) {
    const currentLead = await tx.lead.findFirst({
      where: { id: lead.id, deletedAt: null },
    });
    if (!currentLead) {
      throw new NotFoundException('Lead not found');
    }
    this.assertLeadEligibleForStage2(currentLead);

    const stage1 = await tx.leadQualification.findUnique({
      where: { leadId: lead.id },
    });
    assertStage1QualificationComplete(stage1);

    const mapping = await this.assertSupplierQualityMapping(
      tx,
      dto.supplierId,
      dto.qualityClassId,
      stage1!.application!,
      stage1!.panelTypeId,
    );

    const existing = await tx.leadCommercialQualification.findUnique({
      where: { leadId: lead.id },
      include: commercialQualificationInclude,
    });

    const sameCommercialDecision =
      existing !== null &&
      existing.supplierId === dto.supplierId &&
      existing.qualityClassId === dto.qualityClassId;

    const decisionComment =
      dto.decisionComment === undefined
        ? (existing?.decisionComment ?? null)
        : dto.decisionComment || null;

    if (
      existing &&
      sameCommercialDecision &&
      existing.decisionComment === decisionComment
    ) {
      return serializeLeadCommercialQualification(existing);
    }

    if (existing && sameCommercialDecision) {
      const updated = await tx.leadCommercialQualification.update({
        where: { leadId: lead.id },
        data: { decisionComment },
        include: commercialQualificationInclude,
      });

      return serializeLeadCommercialQualification(updated);
    }

    const confirmedAt = new Date();

    const commercialQualification = existing
      ? await tx.leadCommercialQualification.update({
          where: { leadId: lead.id },
          data: {
            supplierId: dto.supplierId,
            qualityClassId: dto.qualityClassId,
            mappingId: mapping.id,
            status: CommercialQualificationStatus.CONFIRMED,
            decisionComment,
            confirmedById: currentUserId,
            confirmedAt,
          },
          include: commercialQualificationInclude,
        })
      : await tx.leadCommercialQualification.create({
          data: {
            leadId: lead.id,
            supplierId: dto.supplierId,
            qualityClassId: dto.qualityClassId,
            mappingId: mapping.id,
            status: CommercialQualificationStatus.CONFIRMED,
            decisionComment,
            confirmedById: currentUserId,
            confirmedAt,
          },
          include: commercialQualificationInclude,
        });

    const action = existing
      ? 'lead_commercially_requalified'
      : 'lead_commercially_qualified';

    await tx.activity.create({
      data: {
        type: ActivityType.NOTE,
        relatedType: 'Lead',
        relatedId: lead.id,
        authorId: currentUserId,
        content: existing
          ? 'Stage-2 commercial qualification updated'
          : 'Stage-2 commercial qualification confirmed',
        metadata: {
          action,
          supplierId: dto.supplierId,
          qualityClassId: dto.qualityClassId,
          mappingId: mapping.id,
          decisionComment,
        },
      },
    });

    await tx.auditLog.create({
      data: {
        userId: currentUserId,
        action: existing
          ? 'LEAD_COMMERCIAL_REQUALIFIED'
          : 'LEAD_COMMERCIAL_QUALIFIED',
        entityType: 'Lead',
        entityId: lead.id,
        oldValue: existing
          ? {
              supplierId: existing.supplierId,
              qualityClassId: existing.qualityClassId,
            }
          : { commercialQualification: null },
        newValue: {
          supplierId: dto.supplierId,
          qualityClassId: dto.qualityClassId,
          status: CommercialQualificationStatus.CONFIRMED,
          decisionComment,
        },
      },
    });

    if (!existing) {
      await tx.task.updateMany({
        where: {
          relatedType: 'Lead',
          relatedId: lead.id,
          title: { startsWith: STAGE2_HANDOFF_TASK_PREFIX },
          status: { in: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS] },
        },
        data: {
          status: TaskStatus.COMPLETED,
          computedStatus: TaskComputedStatus.ON_TIME,
          result: STAGE2_HANDOFF_TASK_RESULT,
          completedAt: confirmedAt,
        },
      });

      await tx.notification.create({
        data: {
          userId: lead.ownerId,
          title: 'Commercial qualification ready',
          message: `Lead "${lead.title}" is ready for calculation`,
          type: 'lead_commercially_qualified',
          relatedType: 'Lead',
          relatedId: lead.id,
        },
      });
    } else {
      await tx.notification.create({
        data: {
          userId: lead.ownerId,
          title: 'Commercial qualification updated',
          message: `Lead "${lead.title}" commercial solution was updated`,
          type: 'lead_commercially_qualified',
          relatedType: 'Lead',
          relatedId: lead.id,
        },
      });
    }

    return serializeLeadCommercialQualification(commercialQualification);
  }

  private async assertSupplierQualityMapping(
    tx: PrismaTx,
    supplierId: string,
    qualityClassId: string,
    application: HplApplication,
    panelTypeId: string | null,
  ) {
    const supplier = await tx.supplier.findUnique({
      where: { id: supplierId },
      select: { id: true, code: true },
    });
    if (!supplier) {
      throw new BadRequestException('supplierId is invalid');
    }

    const qualityClass = await tx.qualityClass.findUnique({
      where: { id: qualityClassId },
      select: { id: true, code: true },
    });
    if (!qualityClass) {
      throw new BadRequestException('qualityClassId is invalid');
    }

    const expectedCode = panelTypeCodeForApplication(application);
    const panelType = panelTypeId
      ? await tx.panelType.findUnique({
          where: { id: panelTypeId },
          select: { id: true, code: true, isActive: true },
        })
      : await tx.panelType.findFirst({
          where: { code: expectedCode, isActive: true },
          select: { id: true, code: true, isActive: true },
        });

    if (!panelType || !panelType.isActive || panelType.code !== expectedCode) {
      throw new BadRequestException(
        'Stage-1 application has no compatible panel type for commercial mapping',
      );
    }

    const mapping = await tx.supplierQualityMapping.findFirst({
      where: {
        supplierId,
        qualityClassId,
        panelTypeId: panelType.id,
      },
    });

    if (!mapping) {
      throw new BadRequestException({
        message: 'Supplier and quality are incompatible with the customer application',
        supplierId,
        qualityClassId,
        application,
        panelTypeCode: panelType.code,
      });
    }

    return mapping;
  }

  private assertLeadEligibleForStage2(lead: Lead): void {
    if (lead.status === LeadStatus.CONVERTED || lead.dealId !== null) {
      throw new ConflictException(
        'Converted lead cannot receive commercial qualification',
      );
    }

    if (lead.status === LeadStatus.UNQUALIFIED) {
      throw new ConflictException(
        'Unqualified lead cannot receive commercial qualification',
      );
    }

    if (lead.status !== LeadStatus.QUALIFIED) {
      throw new ConflictException(
        'Stage-2 commercial qualification requires a Stage-1 QUALIFIED lead',
      );
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
