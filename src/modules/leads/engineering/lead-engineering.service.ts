import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  ActivityType,
  EngineeringAssignmentStatus,
  LeadStatus,
  Prisma,
  RoleName,
  TaskPriority,
  TaskStatus,
  TaskType,
} from '@prisma/client';
import { BusinessException } from '../../../common/exceptions/business.exception';
import type { CurrentUser } from '../../../common/interfaces/current-user.interface';
import { PrismaService } from '../../prisma/prisma.service';
import { UpsertLeadQualificationDto } from '../dto/upsert-lead-qualification.dto';
import { LeadQualificationService } from '../lead-qualification.service';
import { serializeLeadQualification } from '../lead-qualification.mapper';
import {
  canAccessLeadRecord,
  hasOwnerOrReadAllLeadAccess,
  leadNeedsEngineer,
} from './engineering-access';
import {
  ENGINEERING_ASSIGNED_TITLE,
  ENGINEERING_COMPLETED_TITLE,
  ENGINEERING_NOTIFICATION_TYPE,
  ENGINEERING_PERMISSIONS,
  ENGINEERING_RETURNED_TITLE,
  ENGINEERING_TASK_PREFIX,
  ENGINEERING_TASK_SLA_MS,
} from './engineering.constants';
import { AssignEngineerDto } from './dto/assign-engineer.dto';
import { FilterEngineeringLeadsDto } from './dto/filter-engineering-leads.dto';
import { ReturnEngineeringAssignmentDto } from './dto/return-engineering-assignment.dto';

const ASSIGNABLE_LEAD_STATUSES: LeadStatus[] = [
  LeadStatus.NEW,
  LeadStatus.IN_PROGRESS,
  LeadStatus.QUALIFIED,
];

const assignmentPersonSelect = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
} as const;

const assignmentInclude = {
  engineer: { select: assignmentPersonSelect },
  assignedBy: { select: assignmentPersonSelect },
  returnedBy: { select: assignmentPersonSelect },
  completedBy: { select: assignmentPersonSelect },
  primaryQualificationCompletedBy: { select: assignmentPersonSelect },
} satisfies Prisma.LeadEngineeringAssignmentInclude;

type PrismaTx = Prisma.TransactionClient;

@Injectable()
export class LeadEngineeringService {
  private readonly logger = new Logger(LeadEngineeringService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly leadQualificationService: LeadQualificationService,
  ) {}

  async listEngineers() {
    const users = await this.prisma.user.findMany({
      where: {
        isActive: true,
        roles: { some: { role: { name: RoleName.ENGINEER } } },
      },
      select: assignmentPersonSelect,
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });

    return { items: users };
  }

  async listQueue(filter: FilterEngineeringLeadsDto, user: CurrentUser) {
    const page = filter.page ?? 1;
    const limit = filter.limit ?? 20;
    const status = filter.status ?? EngineeringAssignmentStatus.ACTIVE;

    const where: Prisma.LeadEngineeringAssignmentWhereInput = {
      engineerId: user.id,
      status,
      lead: { deletedAt: null },
    };

    const [assignments, total] = await this.prisma.$transaction([
      this.prisma.leadEngineeringAssignment.findMany({
        where,
        include: {
          ...assignmentInclude,
          lead: {
            select: {
              id: true,
              title: true,
              status: true,
              ownerId: true,
              client: { select: { id: true, name: true } },
              projectObject: {
                select: { id: true, name: true, address: true },
              },
              qualification: {
                select: {
                  installationRequired: true,
                  ventFacadeKitRequired: true,
                },
              },
            },
          },
        },
        orderBy: { assignedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.leadEngineeringAssignment.count({ where }),
    ]);

    return {
      items: assignments.map((assignment) => ({
        id: assignment.lead.id,
        title: assignment.lead.title,
        status: assignment.lead.status,
        ownerId: assignment.lead.ownerId,
        client: assignment.lead.client,
        projectObject: assignment.lead.projectObject,
        installationRequired:
          assignment.lead.qualification?.installationRequired ?? null,
        ventFacadeKitRequired:
          assignment.lead.qualification?.ventFacadeKitRequired ?? null,
        engineering: this.toAssignmentView(assignment),
      })),
      total,
      page,
      limit,
    };
  }

  async getWorkspace(leadId: string, user: CurrentUser) {
    const lead = await this.loadLeadOrThrow(leadId);
    await this.assertEngineeringReadAccess(lead, user);

    const [assignment, activities, clientFiles, dealFiles] = await Promise.all([
      this.prisma.leadEngineeringAssignment.findFirst({
        where: { leadId, engineerId: user.id },
        orderBy: { assignedAt: 'desc' },
        include: assignmentInclude,
      }),
      this.prisma.activity.findMany({
        where: { relatedType: 'Lead', relatedId: leadId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: {
          author: {
            select: { id: true, firstName: true, lastName: true },
          },
        },
      }),
      lead.clientId
        ? this.prisma.file.findMany({
            where: { relatedType: 'CLIENT', relatedId: lead.clientId },
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              originalName: true,
              mimeType: true,
              size: true,
              createdAt: true,
            },
          })
        : Promise.resolve([]),
      lead.dealId
        ? this.prisma.file.findMany({
            where: { relatedType: 'DEAL', relatedId: lead.dealId },
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              originalName: true,
              mimeType: true,
              size: true,
              createdAt: true,
            },
          })
        : Promise.resolve([]),
    ]);

    return {
      lead: this.toEngineerLeadView(lead),
      qualification: lead.qualification
        ? serializeLeadQualification(lead.qualification)
        : null,
      engineering: assignment ? this.toAssignmentView(assignment) : null,
      activities,
      files: [...clientFiles, ...dealFiles],
    };
  }

  async assign(leadId: string, dto: AssignEngineerDto, user: CurrentUser) {
    const lead = await this.loadLeadOrThrow(leadId);
    this.assertAssignerAccess(lead, user);
    this.assertLeadAssignable(lead);
    if (!leadNeedsEngineer(lead.qualification)) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        'ENGINEERING_NOT_REQUIRED',
        'Инженер подключается только при заказе подсистемы или монтажа',
      );
    }

    const engineer = await this.prisma.user.findFirst({
      where: {
        id: dto.engineerId,
        isActive: true,
        roles: { some: { role: { name: RoleName.ENGINEER } } },
      },
      select: { id: true },
    });
    if (!engineer) {
      throw new BusinessException(
        HttpStatus.BAD_REQUEST,
        'ENGINEER_NOT_FOUND',
        'Назначить можно только активного пользователя с ролью ENGINEER',
      );
    }

    const { assignment, notifyEngineerId, created } =
      await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(hashtext(${`engineering-assign:${leadId}`}))
        `;

        const active = await tx.leadEngineeringAssignment.findFirst({
          where: {
            leadId,
            status: EngineeringAssignmentStatus.ACTIVE,
            activeLeadId: leadId,
          },
          include: assignmentInclude,
        });

        if (active?.engineerId === engineer.id) {
          return {
            assignment: active,
            notifyEngineerId: null,
            created: false,
          };
        }

        if (active) {
          await tx.leadEngineeringAssignment.update({
            where: { id: active.id },
            data: {
              status: EngineeringAssignmentStatus.SUPERSEDED,
              activeLeadId: null,
              supersededAt: new Date(),
            },
          });
        }

        const next = await tx.leadEngineeringAssignment.create({
          data: {
            leadId,
            engineerId: engineer.id,
            assignedById: user.id,
            status: EngineeringAssignmentStatus.ACTIVE,
            activeLeadId: leadId,
          },
          include: assignmentInclude,
        });

        await this.writeHistory(tx, {
          leadId,
          authorId: user.id,
          action: 'lead_engineering_assigned',
          content: 'Lead assigned to engineer',
          metadata: {
            assignmentId: next.id,
            engineerId: engineer.id,
            previousAssignmentId: active?.id ?? null,
          },
        });

        await this.ensureEngineeringTask(tx, lead, engineer.id, user.id);

        return {
          assignment: next,
          notifyEngineerId: engineer.id,
          created: true,
        };
      });

    if (notifyEngineerId) {
      await this.notifySafe({
        userId: notifyEngineerId,
        title: ENGINEERING_ASSIGNED_TITLE,
        message: `Лид «${lead.title}» передан вам для технической квалификации`,
        type: ENGINEERING_NOTIFICATION_TYPE.ASSIGNED,
        leadId,
      });
    }

    return {
      ownerId: lead.ownerId,
      created,
      engineering: this.toAssignmentView(assignment),
    };
  }

  async returnToManager(
    leadId: string,
    dto: ReturnEngineeringAssignmentDto,
    user: CurrentUser,
  ) {
    const lead = await this.loadLeadOrThrow(leadId);
    const assignment = await this.requireActiveAssignment(leadId, user.id);

    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.leadEngineeringAssignment.update({
        where: { id: assignment.id },
        data: {
          status: EngineeringAssignmentStatus.RETURNED,
          activeLeadId: null,
          returnReason: dto.reason.trim(),
          returnedAt: new Date(),
          returnedById: user.id,
        },
        include: assignmentInclude,
      });

      await this.writeHistory(tx, {
        leadId,
        authorId: user.id,
        action: 'lead_engineering_returned',
        content: dto.reason.trim(),
        metadata: {
          assignmentId: next.id,
          returnReason: dto.reason.trim(),
        },
      });

      return next;
    });

    await this.notifySafe({
      userId: lead.ownerId,
      title: ENGINEERING_RETURNED_TITLE,
      message: `Инженер вернул лид «${lead.title}»: ${dto.reason.trim()}`,
      type: ENGINEERING_NOTIFICATION_TYPE.RETURNED,
      leadId,
    });

    return {
      ownerId: lead.ownerId,
      qualificationPreserved: true,
      dealId: lead.dealId,
      engineering: this.toAssignmentView(updated),
    };
  }

  async complete(leadId: string, user: CurrentUser) {
    const lead = await this.loadLeadOrThrow(leadId);
    const assignment = await this.requireActiveAssignment(leadId, user.id);

    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.leadEngineeringAssignment.update({
        where: { id: assignment.id },
        data: {
          primaryQualificationCompletedAt: new Date(),
          primaryQualificationCompletedById: user.id,
        },
        include: assignmentInclude,
      });

      await this.writeHistory(tx, {
        leadId,
        authorId: user.id,
        action: 'lead_engineering_primary_completed',
        content: 'Primary engineering qualification completed',
        metadata: { assignmentId: next.id, accessRetained: true },
      });

      return next;
    });

    await this.notifySafe({
      userId: lead.ownerId,
      title: ENGINEERING_COMPLETED_TITLE,
      message: `Инженер завершил первичную квалификацию по лиду «${lead.title}»`,
      type: ENGINEERING_NOTIFICATION_TYPE.COMPLETED,
      leadId,
    });

    return {
      ownerId: lead.ownerId,
      quoteCreated: false,
      priceApproved: false,
      accessRetained: true,
      engineering: this.toAssignmentView(updated),
    };
  }

  async finish(leadId: string, user: CurrentUser) {
    const lead = await this.loadLeadOrThrow(leadId);
    const assignment = await this.requireActiveAssignment(leadId, user.id);

    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.leadEngineeringAssignment.update({
        where: { id: assignment.id },
        data: {
          status: EngineeringAssignmentStatus.COMPLETED,
          activeLeadId: null,
          completedAt: new Date(),
          completedById: user.id,
        },
        include: assignmentInclude,
      });

      await this.writeHistory(tx, {
        leadId,
        authorId: user.id,
        action: 'lead_engineering_finished',
        content: 'Engineering work closed',
        metadata: { assignmentId: next.id },
      });

      return next;
    });

    await this.notifySafe({
      userId: lead.ownerId,
      title: 'Инженер завершил работу',
      message: `Инженер закрыл инженерную работу по лиду «${lead.title}»`,
      type: ENGINEERING_NOTIFICATION_TYPE.COMPLETED,
      leadId,
    });

    return {
      ownerId: lead.ownerId,
      quoteCreated: false,
      priceApproved: false,
      accessRetained: false,
      engineering: this.toAssignmentView(updated),
    };
  }

  async updateTechnicalQualification(
    leadId: string,
    dto: UpsertLeadQualificationDto,
    user: CurrentUser,
  ) {
    await this.requireActiveAssignment(leadId, user.id);
    return this.leadQualificationService.upsert(
      leadId,
      dto,
      user.id,
      user.permissions,
    );
  }

  private async loadLeadOrThrow(leadId: string) {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, deletedAt: null },
      include: {
        client: {
          select: {
            id: true,
            name: true,
            phone: true,
            email: true,
            contacts: {
              orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
              select: {
                id: true,
                firstName: true,
                lastName: true,
                phone: true,
                email: true,
                position: true,
                isPrimary: true,
              },
            },
          },
        },
        contact: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
            email: true,
          },
        },
        projectObject: true,
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
          },
        },
        owner: { select: assignmentPersonSelect },
      },
    });

    if (!lead) {
      throw new BusinessException(
        HttpStatus.NOT_FOUND,
        'LEAD_NOT_FOUND',
        'Лид не найден',
      );
    }

    return lead;
  }

  private assertAssignerAccess(
    lead: { ownerId: string },
    user: CurrentUser,
  ): void {
    if (!user.permissions.includes(ENGINEERING_PERMISSIONS.ASSIGN)) {
      throw new BusinessException(
        HttpStatus.FORBIDDEN,
        'ENGINEERING_ASSIGN_FORBIDDEN',
        'Недостаточно прав для передачи лида инженеру',
      );
    }

    if (!hasOwnerOrReadAllLeadAccess(lead, user.id, user.permissions)) {
      throw new BusinessException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'У вас нет доступа к этому лиду',
      );
    }
  }

  private assertLeadAssignable(lead: { status: LeadStatus }): void {
    if (!ASSIGNABLE_LEAD_STATUSES.includes(lead.status)) {
      throw new BusinessException(
        HttpStatus.CONFLICT,
        'ENGINEERING_LEAD_NOT_ASSIGNABLE',
        'Нельзя передать инженеру закрытый, потерянный или конвертированный лид',
      );
    }
  }

  private async assertEngineeringReadAccess(
    lead: { id: string; ownerId: string },
    user: CurrentUser,
  ): Promise<void> {
    const allowed = await canAccessLeadRecord(
      this.prisma,
      lead,
      user.id,
      user.permissions,
    );
    if (!allowed) {
      throw new BusinessException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'У вас нет доступа к этому лиду',
      );
    }
  }

  private async requireActiveAssignment(leadId: string, engineerId: string) {
    const assignment = await this.prisma.leadEngineeringAssignment.findFirst({
      where: {
        leadId,
        engineerId,
        status: EngineeringAssignmentStatus.ACTIVE,
        activeLeadId: leadId,
      },
      include: assignmentInclude,
    });

    if (!assignment) {
      throw new BusinessException(
        HttpStatus.FORBIDDEN,
        'ENGINEERING_ASSIGNMENT_REQUIRED',
        'Действие доступно только назначенному инженеру',
      );
    }

    return assignment;
  }

  private async ensureEngineeringTask(
    tx: PrismaTx,
    lead: { id: string; title: string },
    engineerId: string,
    createdById: string,
  ): Promise<void> {
    const existing = await tx.task.findFirst({
      where: {
        relatedType: 'Lead',
        relatedId: lead.id,
        assigneeId: engineerId,
        type: TaskType.CALCULATION,
        status: { in: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS] },
      },
      select: { id: true },
    });
    if (existing) {
      return;
    }

    const dueDate = new Date(Date.now() + ENGINEERING_TASK_SLA_MS);
    await tx.task.create({
      data: {
        title: `${ENGINEERING_TASK_PREFIX} ${lead.title}`,
        type: TaskType.CALCULATION,
        status: TaskStatus.PENDING,
        priority: TaskPriority.HIGH,
        dueDate,
        originalDueDate: dueDate,
        assigneeId: engineerId,
        createdById,
        relatedType: 'Lead',
        relatedId: lead.id,
      },
    });
  }

  private async writeHistory(
    tx: PrismaTx,
    input: {
      leadId: string;
      authorId: string;
      action: string;
      content: string;
      metadata: Record<string, unknown>;
    },
  ): Promise<void> {
    await tx.activity.create({
      data: {
        type: ActivityType.STATUS_CHANGED,
        relatedType: 'Lead',
        relatedId: input.leadId,
        authorId: input.authorId,
        content: input.content,
        metadata: {
          action: input.action,
          ...input.metadata,
        },
      },
    });
    await tx.auditLog.create({
      data: {
        userId: input.authorId,
        action: input.action.toUpperCase(),
        entityType: 'Lead',
        entityId: input.leadId,
        newValue: input.metadata as Prisma.InputJsonValue,
      },
    });
  }

  private async notifySafe(input: {
    userId: string;
    title: string;
    message: string;
    type: string;
    leadId: string;
  }): Promise<void> {
    try {
      await this.prisma.notification.create({
        data: {
          userId: input.userId,
          title: input.title,
          message: input.message,
          type: input.type,
          relatedType: 'Lead',
          relatedId: input.leadId,
        },
      });
    } catch (error) {
      this.logger.error(
        `Engineering notification ${input.type} failed after commit`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  private toAssignmentView(
    assignment: Prisma.LeadEngineeringAssignmentGetPayload<{
      include: typeof assignmentInclude;
    }>,
  ) {
    return {
      id: assignment.id,
      status: assignment.status,
      engineer: assignment.engineer,
      assignedBy: assignment.assignedBy,
      assignedAt: assignment.assignedAt,
      returnReason: assignment.returnReason,
      returnedAt: assignment.returnedAt,
      returnedBy: assignment.returnedBy,
      completedAt: assignment.completedAt,
      completedBy: assignment.completedBy,
      primaryQualificationCompletedAt:
        assignment.primaryQualificationCompletedAt,
      primaryQualificationCompletedBy:
        assignment.primaryQualificationCompletedBy,
    };
  }

  private toEngineerLeadView(
    lead: Awaited<ReturnType<LeadEngineeringService['loadLeadOrThrow']>>,
  ) {
    return {
      id: lead.id,
      title: lead.title,
      status: lead.status,
      source: lead.source,
      ownerId: lead.ownerId,
      owner: lead.owner,
      clientId: lead.clientId,
      contactId: lead.contactId,
      projectObjectId: lead.projectObjectId,
      needDescription: lead.needDescription,
      decisionMakerContact: lead.decisionMakerContact,
      client: lead.client,
      contact: lead.contact,
      projectObject: lead.projectObject,
    };
  }
}
