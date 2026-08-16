import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ActivityType,
  DealStage,
  Lead,
  LeadStatus,
  Prisma,
  TaskPriority,
  TaskType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AssignLeadDto } from './dto/assign-lead.dto';
import { CreateLeadDto } from './dto/create-lead.dto';
import { CreateLeadNoteDto } from './dto/create-lead-note.dto';
import { DisqualifyLeadDto } from './dto/disqualify-lead.dto';
import { FilterLeadDto } from './dto/filter-lead.dto';
import { QualifyLeadDto } from './dto/qualify-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { LeadQualificationService } from './lead-qualification.service';

const FIRST_CONTACT_SLA_MS = 2 * 60 * 60 * 1000;
const READ_ALL_LEADS_PERMISSION = 'leads:read_all';

const leadRelationsInclude = Prisma.validator<Prisma.LeadInclude>()({
  owner: {
    select: { id: true, firstName: true, lastName: true, email: true },
  },
  client: { select: { id: true, name: true } },
  projectObject: { select: { id: true, name: true } },
  contact: { select: { id: true, firstName: true, lastName: true } },
  deal: { select: { id: true, title: true } },
  qualification: {
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

type LeadWithRelations = Prisma.LeadGetPayload<{
  include: typeof leadRelationsInclude;
}>;

type LeadListResult = {
  items: LeadWithRelations[];
  total: number;
  page: number;
  limit: number;
};

type QualificationData = {
  clientId: string | null;
  projectObjectId: string | null;
  needDescription: string | null;
  estimatedAmount: Prisma.Decimal | number | null;
  targetDate: Date | null;
  decisionMakerContact: string | null;
};

@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leadQualificationService: LeadQualificationService,
  ) {}

  async create(
    dto: CreateLeadDto,
    currentUserId: string,
    permissions: string[],
  ): Promise<LeadWithRelations> {
    const ownerId = this.resolveCreateOwnerId(
      dto.ownerId,
      currentUserId,
      permissions,
    );
    const now = new Date();
    const dueDate = new Date(now.getTime() + FIRST_CONTACT_SLA_MS);

    return this.prisma.$transaction(async (tx) => {
      const lead = await tx.lead.create({
        data: {
          title: dto.title,
          source: dto.source,
          ownerId,
          clientId: dto.clientId,
          contactId: dto.contactId,
          needDescription: dto.needDescription,
          estimatedAmount: dto.estimatedAmount,
          targetDate: dto.targetDate,
          projectObjectId: dto.projectObjectId,
          decisionMakerContact: dto.decisionMakerContact,
        },
        include: leadRelationsInclude,
      });

      await tx.task.create({
        data: {
          title: `First contact: ${lead.title}`,
          type: TaskType.FIRST_CONTACT,
          priority: TaskPriority.HIGH,
          dueDate,
          originalDueDate: dueDate,
          assigneeId: lead.ownerId,
          createdById: currentUserId,
          relatedType: 'Lead',
          relatedId: lead.id,
        },
      });

      return lead;
    });
  }

  async findAll(
    filterDto: FilterLeadDto,
    currentUserId: string,
    permissions: string[],
  ): Promise<LeadListResult> {
    const page = filterDto.page ?? 1;
    const limit = filterDto.limit ?? 20;
    const where = this.buildLeadWhere(filterDto, currentUserId, permissions);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.lead.findMany({
        where,
        include: leadRelationsInclude,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.lead.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  async findOne(id: string, currentUserId: string, permissions: string[]) {
    const lead = await this.prisma.lead.findFirst({
      where: { id, deletedAt: null },
      include: {
        ...leadRelationsInclude,
        assignmentHistory: {
          include: {
            previousOwner: true,
            newOwner: true,
            assignedBy: true,
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!lead) {
      throw new NotFoundException('Lead not found');
    }

    this.assertLeadAccess(lead, currentUserId, permissions);

    return lead;
  }

  async createCall(
    id: string,
    currentUserId: string,
    permissions: string[],
  ): Promise<{ dialUri: string; activityId: string }> {
    const lead = await this.prisma.lead.findFirst({
      where: { id, deletedAt: null },
      include: {
        contact: { select: { phone: true } },
        client: {
          include: {
            contacts: {
              orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
              take: 1,
            },
          },
        },
      },
    });

    if (!lead) {
      throw new NotFoundException('Lead not found');
    }

    this.assertLeadAccess(lead, currentUserId, permissions);

    const phone =
      lead.client?.contacts[0]?.phone ??
      lead.contact?.phone ??
      lead.client?.phone;

    if (!phone) {
      throw new BadRequestException('Lead has no phone number');
    }

    const dialUri = `tel:${phone}`;
    const activity = await this.prisma.activity.create({
      data: {
        type: ActivityType.CALL,
        relatedType: 'Lead',
        relatedId: lead.id,
        authorId: currentUserId,
        content: `Исходящий звонок: ${phone}`,
        metadata: {
          action: 'outbound_call',
          phone,
          dialUri,
        },
      },
    });

    return { dialUri, activityId: activity.id };
  }

  async createNote(
    id: string,
    dto: CreateLeadNoteDto,
    currentUserId: string,
    permissions: string[],
  ) {
    const lead = await this.ensureLeadExists(id);
    this.assertLeadAccess(lead, currentUserId, permissions);

    return this.prisma.activity.create({
      data: {
        type: ActivityType.NOTE,
        relatedType: 'Lead',
        relatedId: lead.id,
        authorId: currentUserId,
        content: dto.note,
        metadata: { action: 'manual_note' },
      },
    });
  }

  async update(
    id: string,
    dto: UpdateLeadDto,
    currentUserId: string,
    permissions: string[],
  ): Promise<LeadWithRelations> {
    const existingLead = await this.ensureLeadExists(id);
    this.assertLeadAccess(existingLead, currentUserId, permissions);

    if (dto.ownerId && dto.ownerId !== existingLead.ownerId) {
      if (!permissions.includes('leads:assign')) {
        throw new ForbiddenException(
          'leads:assign is required to change lead owner',
        );
      }

      await this.assign(
        id,
        { newOwnerId: dto.ownerId },
        currentUserId,
        permissions,
      );
    }

    return this.prisma.lead.update({
      where: { id },
      data: {
        title: dto.title,
        source: dto.source,
        clientId: dto.clientId,
        contactId: dto.contactId,
        needDescription: dto.needDescription,
        estimatedAmount: dto.estimatedAmount,
        targetDate: dto.targetDate,
        projectObjectId: dto.projectObjectId,
        decisionMakerContact: dto.decisionMakerContact,
      },
      include: leadRelationsInclude,
    });
  }

  async qualify(
    id: string,
    dto: QualifyLeadDto,
    currentUserId: string,
    permissions: string[],
  ): Promise<LeadWithRelations> {
    const lead = await this.ensureLeadExists(id);
    this.assertLeadAccess(lead, currentUserId, permissions);

    if (lead.status === LeadStatus.CONVERTED || lead.dealId !== null) {
      throw new ConflictException('Lead already converted to deal');
    }

    const qualificationData: QualificationData = {
      clientId: dto.clientId,
      projectObjectId: dto.projectObjectId,
      needDescription: dto.needDescription,
      estimatedAmount: dto.estimatedAmount,
      targetDate: dto.targetDate,
      decisionMakerContact: dto.decisionMakerContact,
    };

    this.assertQualificationComplete(qualificationData);

    const dueDate = new Date(Date.now() + FIRST_CONTACT_SLA_MS);

    return this.prisma.$transaction(async (tx) => {
      if (dto.qualification) {
        await this.leadQualificationService.upsertInTx(
          tx,
          id,
          dto.qualification,
          currentUserId,
          'lead_qualification_completed',
        );
      }

      const stage1 = await tx.leadQualification.findUnique({
        where: { leadId: id },
      });
      this.leadQualificationService.assertStage1Complete(stage1);

      const deal = await tx.deal.create({
        data: {
          title: lead.title,
          clientId: dto.clientId,
          projectObjectId: dto.projectObjectId,
          ownerId: lead.ownerId,
          stage: DealStage.QUALIFICATION,
          totalAmount: dto.estimatedAmount,
          expectedCloseDate: dto.targetDate,
          nextActionAt: dueDate,
        },
      });

      await tx.task.create({
        data: {
          title: `First deal action: ${deal.title}`,
          type: TaskType.FIRST_CONTACT,
          priority: TaskPriority.HIGH,
          dueDate,
          originalDueDate: dueDate,
          assigneeId: lead.ownerId,
          createdById: currentUserId,
          relatedType: 'Deal',
          relatedId: deal.id,
        },
      });

      // Атомарный захват лида: параллельный qualify не создаст вторую
      // сделку-сироту — проигравшая транзакция получит count = 0 и откатится
      const claimed = await tx.lead.updateMany({
        where: {
          id,
          deletedAt: null,
          dealId: null,
          status: { not: LeadStatus.CONVERTED },
        },
        data: {
          clientId: dto.clientId,
          projectObjectId: dto.projectObjectId,
          needDescription: dto.needDescription,
          estimatedAmount: dto.estimatedAmount,
          targetDate: dto.targetDate,
          decisionMakerContact: dto.decisionMakerContact,
          status: LeadStatus.CONVERTED,
          dealId: deal.id,
        },
      });

      if (claimed.count === 0) {
        throw new ConflictException('Lead already converted to deal');
      }

      const convertedLead = await tx.lead.findUnique({
        where: { id },
        include: leadRelationsInclude,
      });

      if (!convertedLead) {
        throw new NotFoundException('Lead not found');
      }

      return convertedLead;
    });
  }

  async disqualify(
    id: string,
    dto: DisqualifyLeadDto,
    currentUserId: string,
    permissions: string[],
  ): Promise<LeadWithRelations> {
    const reason = dto.reason.trim();

    if (!reason) {
      throw new BadRequestException('unqualificationReason is required');
    }

    const existingLead = await this.ensureLeadExists(id);
    this.assertLeadAccess(existingLead, currentUserId, permissions);

    return this.prisma.lead.update({
      where: { id },
      data: {
        status: LeadStatus.UNQUALIFIED,
        unqualificationReason: reason,
      },
      include: leadRelationsInclude,
    });
  }

  async assign(
    id: string,
    dto: AssignLeadDto,
    currentUserId: string,
    permissions: string[],
  ): Promise<LeadWithRelations> {
    const lead = await this.ensureLeadExists(id);
    this.assertLeadAccess(lead, currentUserId, permissions);

    if (lead.ownerId === dto.newOwnerId) {
      return this.prisma.lead.findUniqueOrThrow({
        where: { id },
        include: leadRelationsInclude,
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const updatedLead = await tx.lead.update({
        where: { id },
        data: { ownerId: dto.newOwnerId },
        include: leadRelationsInclude,
      });

      await tx.leadAssignmentHistory.create({
        data: {
          leadId: id,
          previousOwnerId: lead.ownerId,
          newOwnerId: dto.newOwnerId,
          assignedById: currentUserId,
        },
      });

      return updatedLead;
    });
  }

  async softDelete(
    id: string,
    currentUserId: string,
    permissions: string[],
  ): Promise<Lead> {
    const existingLead = await this.ensureLeadExists(id);
    this.assertLeadAccess(existingLead, currentUserId, permissions);

    return this.prisma.lead.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  private buildLeadWhere(
    filterDto: FilterLeadDto,
    currentUserId: string,
    permissions: string[],
  ): Prisma.LeadWhereInput {
    const canReadAllLeads = permissions.includes(READ_ALL_LEADS_PERMISSION);

    return {
      deletedAt: null,
      status: filterDto.status,
      source: filterDto.source,
      ownerId: canReadAllLeads ? filterDto.ownerId : currentUserId,
      OR: filterDto.search
        ? [
            { title: { contains: filterDto.search } },
            { source: { contains: filterDto.search } },
            {
              needDescription: {
                contains: filterDto.search,
              },
            },
            {
              client: {
                name: { contains: filterDto.search },
              },
            },
          ]
        : undefined,
    };
  }

  private assertQualificationComplete(data: QualificationData): void {
    const missingFields: string[] = [];

    if (!data.clientId) {
      missingFields.push('clientId');
    }

    if (!data.projectObjectId) {
      missingFields.push('projectObjectId');
    }

    if (!data.needDescription?.trim()) {
      missingFields.push('needDescription');
    }

    if (!data.estimatedAmount) {
      missingFields.push('estimatedAmount');
    }

    if (!data.targetDate) {
      missingFields.push('targetDate');
    }

    if (!data.decisionMakerContact?.trim()) {
      missingFields.push('decisionMakerContact');
    }

    if (missingFields.length > 0) {
      throw new BadRequestException({
        message: 'Lead qualification fields are incomplete',
        missingFields,
      });
    }
  }

  private resolveCreateOwnerId(
    requestedOwnerId: string | undefined,
    currentUserId: string,
    permissions: string[],
  ): string {
    if (!requestedOwnerId || requestedOwnerId === currentUserId) {
      return currentUserId;
    }

    if (!permissions.includes('leads:assign')) {
      throw new ForbiddenException(
        'leads:assign is required to assign lead owner',
      );
    }

    return requestedOwnerId;
  }

  private assertLeadAccess(
    lead: Pick<Lead, 'ownerId'>,
    currentUserId: string,
    permissions: string[],
  ): void {
    if (permissions.includes(READ_ALL_LEADS_PERMISSION)) {
      return;
    }

    if (lead.ownerId === currentUserId) {
      return;
    }

    throw new ForbiddenException('Access to this lead is forbidden');
  }

  private async ensureLeadExists(id: string): Promise<Lead> {
    const lead = await this.prisma.lead.findFirst({
      where: { id, deletedAt: null },
    });

    if (!lead) {
      throw new NotFoundException('Lead not found');
    }

    return lead;
  }
}
