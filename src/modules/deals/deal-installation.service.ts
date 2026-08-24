import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ActivityType,
  DealInstallation,
  InstallationStatus,
  Prisma,
  RoleName,
} from '@prisma/client';
import type { CurrentUser } from '../../common/interfaces/current-user.interface';
import { hasAnyRole, hasRole } from '../../common/enums/role.enum';
import { PrismaService } from '../prisma/prisma.service';
import { DealPolicyService } from './services/deal-policy.service';
import { DealCompletionService } from './deal-completion.service';
import { isInstallationRequired } from './deal-completion.rules';
import {
  DISTINCT_INSTALLATION_ACTORS_MESSAGE,
  FULFILLMENT_AUDIT,
  FULFILLMENT_NOTIFICATION,
  INSTALLATION_NOT_REQUIRED_MESSAGE,
} from './deal-fulfillment.constants';
import { FilterInstallationDto } from './dto/filter-installation.dto';
import type {
  InstallationJobDto,
  InstallationJobListDto,
} from './dto/installation-job.dto';
import { ScheduleInstallationDto } from './dto/schedule-installation.dto';
import { UpdateInstallationAssessmentDto } from './dto/update-installation-assessment.dto';
import {
  installationJobInclude,
  mapInstallationJob,
} from './installation-job.mapper';

@Injectable()
export class DealInstallationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dealPolicy: DealPolicyService,
    private readonly dealCompletion: DealCompletionService,
  ) {}

  async list(
    filterDto: FilterInstallationDto,
    user: CurrentUser,
  ): Promise<InstallationJobListDto> {
    this.assertAssessor(user);

    const page = filterDto.page ?? 1;
    const limit = filterDto.limit ?? 20;
    const where: Prisma.DealInstallationWhereInput = {
      deal: {
        deletedAt: null,
        installationRequiredSnapshot: true,
      },
    };

    if (filterDto.status) {
      where.status = filterDto.status;
    }

    if (filterDto.requiringAction === true) {
      where.completedAt = null;
      where.status = filterDto.status
        ? filterDto.status
        : { not: InstallationStatus.COMPLETED };
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.dealInstallation.findMany({
        where,
        include: installationJobInclude,
        orderBy: [
          { expectedInstallationAt: { sort: 'asc', nulls: 'last' } },
          { createdAt: 'desc' },
        ],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.dealInstallation.count({ where }),
    ]);

    return {
      items: rows.map(mapInstallationJob),
      total,
      page,
      limit,
    };
  }

  async getById(id: string, user: CurrentUser): Promise<InstallationJobDto> {
    this.assertAssessor(user);

    const installation = await this.prisma.dealInstallation.findFirst({
      where: { id, deal: { deletedAt: null } },
      include: installationJobInclude,
    });

    if (!installation) {
      throw new NotFoundException('Installation job not found');
    }

    return mapInstallationJob(installation);
  }

  async getByDealId(
    dealId: string,
    user: CurrentUser,
  ): Promise<DealInstallation> {
    const deal = await this.requireDealForInstallationAccess(dealId, user);
    const installation = await this.prisma.dealInstallation.findUnique({
      where: { dealId: deal.id },
    });

    if (!installation) {
      throw new NotFoundException('Installation job not found');
    }

    return installation;
  }

  async schedule(
    dealId: string,
    dto: ScheduleInstallationDto,
    user: CurrentUser,
  ): Promise<DealInstallation> {
    this.assertScheduler(user);
    this.assertScheduleDates(
      dto.expectedInstallationAt,
      dto.expectedCompletionAt,
    );

    const deal = await this.requireDealForManagement(dealId, user);
    await this.assertInstallationRequired(deal.id);

    return this.prisma.$transaction(async (tx) => {
      await this.dealCompletion.lockFulfillmentRows(tx, deal.id);

      const existing = await tx.dealInstallation.findUnique({
        where: { dealId: deal.id },
      });

      if (existing?.completedAt) {
        throw new ConflictException(
          'Cannot change installation dates after completion',
        );
      }

      const datesChanged =
        !existing ||
        !sameInstant(
          existing.expectedInstallationAt,
          dto.expectedInstallationAt,
        ) ||
        !sameInstant(existing.expectedCompletionAt, dto.expectedCompletionAt);

      const updated = existing
        ? await tx.dealInstallation.update({
            where: { id: existing.id },
            data: {
              expectedInstallationAt: dto.expectedInstallationAt,
              expectedCompletionAt: dto.expectedCompletionAt,
              status:
                existing.status === InstallationStatus.COMPLETED
                  ? existing.status
                  : existing.startedAt
                    ? InstallationStatus.IN_PROGRESS
                    : InstallationStatus.SCHEDULED,
            },
          })
        : await tx.dealInstallation.create({
            data: {
              dealId: deal.id,
              expectedInstallationAt: dto.expectedInstallationAt,
              expectedCompletionAt: dto.expectedCompletionAt,
              status: InstallationStatus.SCHEDULED,
            },
          });

      if (!datesChanged) {
        return updated;
      }

      await tx.activity.create({
        data: {
          authorId: user.id,
          relatedType: 'Deal',
          relatedId: deal.id,
          type: ActivityType.INSTALLATION_UPDATED,
          content: existing
            ? 'Installation planned dates changed'
            : 'Installation scheduled',
          metadata: {
            action: existing
              ? 'installation_dates_changed'
              : 'installation_scheduled',
            installationId: updated.id,
          },
        },
      });

      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: existing
            ? FULFILLMENT_AUDIT.INSTALLATION_DATES_CHANGED
            : FULFILLMENT_AUDIT.INSTALLATION_SCHEDULED,
          entityType: 'DealInstallation',
          entityId: updated.id,
          ...(existing
            ? {
                oldValue: {
                  expectedInstallationAt: toIso(
                    existing.expectedInstallationAt,
                  ),
                  expectedCompletionAt: toIso(existing.expectedCompletionAt),
                },
              }
            : {}),
          newValue: {
            expectedInstallationAt: toIso(updated.expectedInstallationAt),
            expectedCompletionAt: toIso(updated.expectedCompletionAt),
          },
        },
      });

      if (!existing) {
        await this.notifyRoleUsers(tx, [RoleName.INSTALLER], {
          title: 'Installation scheduled',
          message: 'A deal installation date was scheduled',
          type: FULFILLMENT_NOTIFICATION.INSTALLATION_SCHEDULED,
          relatedId: updated.id,
        });
      }

      return updated;
    });
  }

  async updateAssessment(
    dealId: string,
    dto: UpdateInstallationAssessmentDto,
    user: CurrentUser,
  ): Promise<DealInstallation> {
    this.assertAssessor(user);
    const deal = await this.requireDealForInstallationAccess(dealId, user);

    return this.prisma.$transaction(async (tx) => {
      await this.dealCompletion.lockFulfillmentRows(tx, deal.id);
      const installation = await this.requireInstallation(tx, deal.id);

      const nextAssessment =
        dto.assessmentComment !== undefined
          ? dto.assessmentComment.trim() || null
          : installation.assessmentComment;
      const nextWork =
        dto.workComment !== undefined
          ? dto.workComment.trim() || null
          : installation.workComment;

      if (
        nextAssessment === installation.assessmentComment &&
        nextWork === installation.workComment
      ) {
        return installation;
      }

      const assessed =
        dto.assessmentComment !== undefined &&
        nextAssessment !== installation.assessmentComment;

      const updated = await tx.dealInstallation.update({
        where: { id: installation.id },
        data: {
          assessmentComment: nextAssessment,
          workComment: nextWork,
          ...(assessed
            ? { assessedAt: new Date(), assessedById: user.id }
            : {}),
        },
      });

      if (assessed) {
        await tx.activity.create({
          data: {
            authorId: user.id,
            relatedType: 'Deal',
            relatedId: deal.id,
            type: ActivityType.INSTALLATION_UPDATED,
            content: 'Installation assessment updated',
            metadata: {
              action: 'installation_assessed',
              installationId: updated.id,
            },
          },
        });
        await tx.auditLog.create({
          data: {
            userId: user.id,
            action: FULFILLMENT_AUDIT.INSTALLATION_ASSESSED,
            entityType: 'DealInstallation',
            entityId: updated.id,
            newValue: { assessedById: user.id },
          },
        });
      }

      return updated;
    });
  }

  async start(dealId: string, user: CurrentUser): Promise<DealInstallation> {
    this.assertInstaller(user);
    const deal = await this.requireDealForInstallationAccess(dealId, user);

    return this.prisma.$transaction(async (tx) => {
      await this.dealCompletion.lockFulfillmentRows(tx, deal.id);
      const installation = await this.requireInstallation(tx, deal.id);

      if (installation.startedAt) {
        return installation;
      }

      if (installation.completedAt) {
        throw new ConflictException(
          'Cannot start installation after completion',
        );
      }

      const startedAt = new Date();
      const claimed = await tx.dealInstallation.updateMany({
        where: { id: installation.id, startedAt: null, completedAt: null },
        data: {
          startedAt,
          startedById: user.id,
          status: InstallationStatus.IN_PROGRESS,
        },
      });

      if (claimed.count !== 1) {
        const latest = await tx.dealInstallation.findUniqueOrThrow({
          where: { id: installation.id },
        });
        if (latest.startedAt) {
          return latest;
        }
        throw new ConflictException('Installation was not started');
      }

      await tx.activity.create({
        data: {
          authorId: user.id,
          relatedType: 'Deal',
          relatedId: deal.id,
          type: ActivityType.INSTALLATION_UPDATED,
          content: 'Installation work started',
          metadata: {
            action: 'installation_started',
            installationId: installation.id,
          },
        },
      });
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: FULFILLMENT_AUDIT.INSTALLATION_STARTED,
          entityType: 'DealInstallation',
          entityId: installation.id,
          newValue: {
            startedAt: startedAt.toISOString(),
            startedById: user.id,
          },
        },
      });

      return tx.dealInstallation.findUniqueOrThrow({
        where: { id: installation.id },
      });
    });
  }

  async confirmInstaller(
    dealId: string,
    user: CurrentUser,
  ): Promise<DealInstallation> {
    this.assertInstaller(user);
    const deal = await this.requireDealForInstallationAccess(dealId, user);

    return this.prisma.$transaction(async (tx) => {
      await this.dealCompletion.lockFulfillmentRows(tx, deal.id);
      const installation = await this.requireInstallation(tx, deal.id);

      if (installation.installerConfirmedAt) {
        await this.dealCompletion.tryFinalize(tx, deal.id, user.id);
        return tx.dealInstallation.findUniqueOrThrow({
          where: { id: installation.id },
        });
      }

      if (installation.supervisorConfirmedById === user.id) {
        throw new ConflictException(DISTINCT_INSTALLATION_ACTORS_MESSAGE);
      }

      const confirmedAt = new Date();
      const claimed = await tx.dealInstallation.updateMany({
        where: {
          id: installation.id,
          installerConfirmedAt: null,
        },
        data: {
          installerConfirmedAt: confirmedAt,
          installerConfirmedById: user.id,
        },
      });

      if (claimed.count !== 1) {
        const latest = await tx.dealInstallation.findUniqueOrThrow({
          where: { id: installation.id },
        });
        if (latest.installerConfirmedAt) {
          await this.dealCompletion.tryFinalize(tx, deal.id, user.id);
          return latest;
        }
        throw new ConflictException('Installer confirmation was not recorded');
      }

      await tx.activity.create({
        data: {
          authorId: user.id,
          relatedType: 'Deal',
          relatedId: deal.id,
          type: ActivityType.INSTALLATION_UPDATED,
          content: 'Installer confirmed installation work',
          metadata: {
            action: 'installation_installer_confirmed',
            installationId: installation.id,
          },
        },
      });
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: FULFILLMENT_AUDIT.INSTALLATION_INSTALLER_CONFIRMED,
          entityType: 'DealInstallation',
          entityId: installation.id,
          newValue: {
            installerConfirmedAt: confirmedAt.toISOString(),
            installerConfirmedById: user.id,
          },
        },
      });

      if (!installation.supervisorConfirmedAt) {
        await this.notifyRoleUsers(tx, [RoleName.HEAD, RoleName.DIRECTOR], {
          title: 'Installation supervisor confirmation pending',
          message:
            'Installer confirmed work; HEAD or DIRECTOR confirmation is pending',
          type: FULFILLMENT_NOTIFICATION.INSTALLATION_INSTALLER_CONFIRMED,
          relatedId: installation.id,
        });
      }

      await this.dealCompletion.tryFinalize(tx, deal.id, user.id);

      return tx.dealInstallation.findUniqueOrThrow({
        where: { id: installation.id },
      });
    });
  }

  async confirmSupervisor(
    dealId: string,
    user: CurrentUser,
  ): Promise<DealInstallation> {
    this.assertSupervisor(user);
    const deal = await this.requireDealForManagement(dealId, user);

    return this.prisma.$transaction(async (tx) => {
      await this.dealCompletion.lockFulfillmentRows(tx, deal.id);
      const installation = await this.requireInstallation(tx, deal.id);

      if (installation.supervisorConfirmedAt) {
        await this.dealCompletion.tryFinalize(tx, deal.id, user.id);
        return tx.dealInstallation.findUniqueOrThrow({
          where: { id: installation.id },
        });
      }

      if (installation.installerConfirmedById === user.id) {
        throw new ConflictException(DISTINCT_INSTALLATION_ACTORS_MESSAGE);
      }

      const confirmedAt = new Date();
      const claimed = await tx.dealInstallation.updateMany({
        where: {
          id: installation.id,
          supervisorConfirmedAt: null,
        },
        data: {
          supervisorConfirmedAt: confirmedAt,
          supervisorConfirmedById: user.id,
        },
      });

      if (claimed.count !== 1) {
        const latest = await tx.dealInstallation.findUniqueOrThrow({
          where: { id: installation.id },
        });
        if (latest.supervisorConfirmedAt) {
          await this.dealCompletion.tryFinalize(tx, deal.id, user.id);
          return latest;
        }
        throw new ConflictException('Supervisor confirmation was not recorded');
      }

      await tx.activity.create({
        data: {
          authorId: user.id,
          relatedType: 'Deal',
          relatedId: deal.id,
          type: ActivityType.INSTALLATION_UPDATED,
          content: 'Supervisor confirmed installation completion',
          metadata: {
            action: 'installation_supervisor_confirmed',
            installationId: installation.id,
          },
        },
      });
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: FULFILLMENT_AUDIT.INSTALLATION_SUPERVISOR_CONFIRMED,
          entityType: 'DealInstallation',
          entityId: installation.id,
          newValue: {
            supervisorConfirmedAt: confirmedAt.toISOString(),
            supervisorConfirmedById: user.id,
          },
        },
      });

      if (!installation.installerConfirmedAt) {
        await this.notifyRoleUsers(tx, [RoleName.INSTALLER], {
          title: 'Installation installer confirmation pending',
          message:
            'Management confirmed installation; installer confirmation is pending',
          type: FULFILLMENT_NOTIFICATION.INSTALLATION_SUPERVISOR_CONFIRMED,
          relatedId: installation.id,
        });
      }

      await this.dealCompletion.tryFinalize(tx, deal.id, user.id);

      return tx.dealInstallation.findUniqueOrThrow({
        where: { id: installation.id },
      });
    });
  }

  private assertScheduler(user: CurrentUser): void {
    if (hasAnyRole(user, [RoleName.HEAD, RoleName.DIRECTOR])) {
      return;
    }

    throw new ForbiddenException(
      'Installation dates may be set only by HEAD or DIRECTOR',
    );
  }

  private assertSupervisor(user: CurrentUser): void {
    if (hasAnyRole(user, [RoleName.HEAD, RoleName.DIRECTOR])) {
      return;
    }

    throw new ForbiddenException(
      'Installation supervisor confirmation requires HEAD or DIRECTOR',
    );
  }

  private assertInstaller(user: CurrentUser): void {
    if (hasRole(user, RoleName.INSTALLER)) {
      return;
    }

    throw new ForbiddenException(
      'Installation work confirmation requires the INSTALLER role',
    );
  }

  private assertAssessor(user: CurrentUser): void {
    if (
      hasRole(user, RoleName.INSTALLER) ||
      hasAnyRole(user, [RoleName.HEAD, RoleName.DIRECTOR])
    ) {
      return;
    }

    throw new ForbiddenException(
      'Installation assessment requires INSTALLER, HEAD, or DIRECTOR',
    );
  }

  private assertScheduleDates(start: Date, end: Date): void {
    if (end < start) {
      throw new BadRequestException(
        'expectedCompletionAt must not precede expectedInstallationAt',
      );
    }
  }

  private async requireDealForManagement(
    dealId: string,
    user: CurrentUser,
  ): Promise<{ id: string; ownerId: string }> {
    const deal = await this.prisma.deal.findFirst({
      where: { id: dealId, deletedAt: null },
      select: { id: true, ownerId: true },
    });

    if (!deal || !this.dealPolicy.canReadDeal(user, deal)) {
      throw new NotFoundException('Deal not found');
    }

    return deal;
  }

  private async requireDealForInstallationAccess(
    dealId: string,
    user: CurrentUser,
  ): Promise<{ id: string; ownerId: string }> {
    const deal = await this.prisma.deal.findFirst({
      where: { id: dealId, deletedAt: null },
      select: { id: true, ownerId: true },
    });

    if (!deal) {
      throw new NotFoundException('Deal not found');
    }

    if (
      this.dealPolicy.canReadDeal(user, deal) ||
      hasRole(user, RoleName.INSTALLER)
    ) {
      return deal;
    }

    throw new ForbiddenException('Access to this deal is forbidden');
  }

  private async assertInstallationRequired(dealId: string): Promise<void> {
    const deal = await this.prisma.deal.findFirst({
      where: { id: dealId, deletedAt: null },
      select: { installationRequiredSnapshot: true },
    });

    if (!isInstallationRequired(deal?.installationRequiredSnapshot)) {
      throw new ConflictException(INSTALLATION_NOT_REQUIRED_MESSAGE);
    }
  }

  private async requireInstallation(
    tx: Prisma.TransactionClient,
    dealId: string,
  ): Promise<DealInstallation> {
    const installation = await tx.dealInstallation.findUnique({
      where: { dealId },
    });

    if (!installation) {
      throw new NotFoundException('Installation job not found');
    }

    return installation;
  }

  private async notifyRoleUsers(
    tx: Prisma.TransactionClient,
    roles: RoleName[],
    input: {
      title: string;
      message: string;
      type: string;
      relatedId: string;
    },
  ): Promise<void> {
    const users = await tx.user.findMany({
      where: {
        isActive: true,
        roles: { some: { role: { name: { in: roles } } } },
      },
      select: { id: true },
    });

    if (users.length === 0) {
      return;
    }

    await tx.notification.createMany({
      data: users.map((user) => ({
        userId: user.id,
        title: input.title,
        message: input.message,
        type: input.type,
        relatedType: 'DealInstallation',
        relatedId: input.relatedId,
      })),
    });
  }
}

function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function sameInstant(
  left: Date | null | undefined,
  right: Date | null | undefined,
): boolean {
  if (!left && !right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return left.getTime() === right.getTime();
}
