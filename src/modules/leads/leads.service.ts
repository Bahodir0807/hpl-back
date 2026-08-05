import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
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
import { DisqualifyLeadDto } from './dto/disqualify-lead.dto';
import { FilterLeadDto } from './dto/filter-lead.dto';
import { QualifyLeadDto } from './dto/qualify-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';

const FIRST_CONTACT_SLA_MS = 2 * 60 * 60 * 1000;
const READ_ALL_LEADS_PERMISSION = 'leads:read_all';

type LeadListResult = {
  items: Lead[];
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
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateLeadDto, currentUserId: string): Promise<Lead> {
    const ownerId = dto.ownerId ?? currentUserId;
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
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.lead.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  async findOne(id: string) {
    const lead = await this.prisma.lead.findFirst({
      where: { id, deletedAt: null },
      include: {
        owner: true,
        client: true,
        projectObject: true,
        contact: true,
        deal: true,
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

    return lead;
  }

  async update(id: string, dto: UpdateLeadDto): Promise<Lead> {
    await this.ensureLeadExists(id);

    return this.prisma.lead.update({
      where: { id },
      data: {
        title: dto.title,
        source: dto.source,
        ownerId: dto.ownerId,
        clientId: dto.clientId,
        contactId: dto.contactId,
        needDescription: dto.needDescription,
        estimatedAmount: dto.estimatedAmount,
        targetDate: dto.targetDate,
        projectObjectId: dto.projectObjectId,
        decisionMakerContact: dto.decisionMakerContact,
      },
    });
  }

  async qualify(
    id: string,
    dto: QualifyLeadDto,
    currentUserId: string,
  ): Promise<Lead> {
    const lead = await this.ensureLeadExists(id);
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

      return tx.lead.update({
        where: { id },
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
    });
  }

  async disqualify(id: string, dto: DisqualifyLeadDto): Promise<Lead> {
    const reason = dto.reason.trim();

    if (!reason) {
      throw new BadRequestException('unqualificationReason is required');
    }

    await this.ensureLeadExists(id);

    return this.prisma.lead.update({
      where: { id },
      data: {
        status: LeadStatus.UNQUALIFIED,
        unqualificationReason: reason,
      },
    });
  }

  async assign(
    id: string,
    dto: AssignLeadDto,
    currentUserId: string,
  ): Promise<Lead> {
    const lead = await this.ensureLeadExists(id);

    if (lead.ownerId === dto.newOwnerId) {
      return lead;
    }

    return this.prisma.$transaction(async (tx) => {
      const updatedLead = await tx.lead.update({
        where: { id },
        data: { ownerId: dto.newOwnerId },
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

  async softDelete(id: string): Promise<Lead> {
    await this.ensureLeadExists(id);

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
      ownerId: canReadAllLeads
        ? filterDto.ownerId
        : (filterDto.ownerId ?? currentUserId),
      OR: filterDto.search
        ? [
            { title: { contains: filterDto.search, mode: 'insensitive' } },
            { source: { contains: filterDto.search, mode: 'insensitive' } },
            {
              needDescription: {
                contains: filterDto.search,
                mode: 'insensitive',
              },
            },
            {
              client: {
                name: { contains: filterDto.search, mode: 'insensitive' },
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
