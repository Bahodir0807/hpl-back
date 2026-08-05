import { Injectable } from '@nestjs/common';
import {
  DealStage,
  LeadStatus,
  Prisma,
  RoleName,
  TaskStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ReportFilterDto } from './dto/report-filter.dto';

const DEAL_STAGES: DealStage[] = [
  DealStage.QUALIFICATION,
  DealStage.HPL_SELECTION,
  DealStage.OFFER_PREPARATION,
  DealStage.NEGOTIATION,
  DealStage.AGREEMENT_PENDING,
  DealStage.PAYMENT_PREPARATION,
  DealStage.SHIPPED,
  DealStage.WON,
  DealStage.LOST,
];

const OPEN_TASK_STATUSES: TaskStatus[] = [
  TaskStatus.PENDING,
  TaskStatus.IN_PROGRESS,
];

type DateRange = {
  gte: Date;
  lte: Date;
};

export type FunnelStageMetric = {
  stage: DealStage;
  count: number;
  amount: number;
  conversionPercent: number;
};

export type FunnelReport = {
  stages: FunnelStageMetric[];
  totalDeals: number;
  wonDeals: number;
  winConversionPercent: number;
};

export type OverdueManagerMetric = {
  managerId: string;
  managerName: string;
  overdueCount: number;
  criticalOverdueCount: number;
  averageDelayHours: number;
};

export type OverduesReport = {
  managers: OverdueManagerMetric[];
  totalOverdue: number;
  totalCritical: number;
};

export type KpiManagerMetric = {
  managerId: string;
  managerName: string;
  salesPlanPercent: number;
  qualifiedLeadsPercent: number;
  conversionPercent: number;
  deadlineCompliancePercent: number;
  crmDisciplinePercent: number;
  totalScore: number;
};

export type KpiReport = {
  weights: {
    salesPlan: 40;
    qualifiedLeads: 15;
    conversion: 15;
    deadlineCompliance: 15;
    crmDiscipline: 15;
  };
  managers: KpiManagerMetric[];
};

type ReportUser = {
  id: string;
  firstName: string;
  lastName: string;
};

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async getFunnel(filterDto: ReportFilterDto): Promise<FunnelReport> {
    const range = this.buildDateRange(filterDto);
    const baseWhere: Prisma.DealWhereInput = {
      deletedAt: null,
      ownerId: filterDto.managerId,
      createdAt: range,
    };

    const stages = await Promise.all(
      DEAL_STAGES.map(async (stage) => {
        const where: Prisma.DealWhereInput = {
          ...baseWhere,
          stage,
        };
        const [count, aggregate] = await this.prisma.$transaction([
          this.prisma.deal.count({ where }),
          this.prisma.deal.aggregate({
            where,
            _sum: { totalAmount: true },
          }),
        ]);

        return {
          stage,
          count,
          amount: this.toNumber(aggregate._sum.totalAmount),
        };
      }),
    );
    const totalDeals = stages.reduce((sum, stage) => sum + stage.count, 0);
    const wonDeals =
      stages.find((stage) => stage.stage === DealStage.WON)?.count ?? 0;
    const firstStageCount = stages[0]?.count ?? 0;
    const metrics = stages.map((stage, index): FunnelStageMetric => {
      const previousCount =
        index === 0 ? firstStageCount : stages[index - 1].count;

      return {
        ...stage,
        conversionPercent: this.percent(stage.count, previousCount),
      };
    });

    return {
      stages: metrics,
      totalDeals,
      wonDeals,
      winConversionPercent: this.percent(wonDeals, totalDeals),
    };
  }

  async getOverdues(filterDto: ReportFilterDto): Promise<OverduesReport> {
    const now = new Date();
    const criticalBefore = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const tasks = await this.prisma.task.findMany({
      where: {
        status: { in: OPEN_TASK_STATUSES },
        assigneeId: filterDto.managerId,
        dueDate: { lt: now },
      },
      select: {
        id: true,
        dueDate: true,
        assignee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });
    const groups = new Map<
      string,
      {
        user: ReportUser;
        overdueCount: number;
        criticalOverdueCount: number;
        delayHoursTotal: number;
      }
    >();

    for (const task of tasks) {
      const managerId = task.assignee.id;
      const current = groups.get(managerId) ?? {
        user: task.assignee,
        overdueCount: 0,
        criticalOverdueCount: 0,
        delayHoursTotal: 0,
      };

      current.overdueCount += 1;
      current.delayHoursTotal += Math.max(
        0,
        (now.getTime() - task.dueDate.getTime()) / 3_600_000,
      );

      if (task.dueDate < criticalBefore) {
        current.criticalOverdueCount += 1;
      }

      groups.set(managerId, current);
    }

    const managers = Array.from(groups.values()).map(
      (group): OverdueManagerMetric => ({
        managerId: group.user.id,
        managerName: this.userName(group.user),
        overdueCount: group.overdueCount,
        criticalOverdueCount: group.criticalOverdueCount,
        averageDelayHours:
          group.overdueCount > 0
            ? this.round(group.delayHoursTotal / group.overdueCount)
            : 0,
      }),
    );

    return {
      managers,
      totalOverdue: tasks.length,
      totalCritical: managers.reduce(
        (sum, manager) => sum + manager.criticalOverdueCount,
        0,
      ),
    };
  }

  async getKpi(filterDto: ReportFilterDto): Promise<KpiReport> {
    const range = this.buildDateRange(filterDto);
    const period = this.startOfMonth(range.gte);
    const users = await this.prisma.user.findMany({
      where: {
        id: filterDto.managerId,
        isActive: true,
        roles: {
          some: {
            role: {
              name: { in: [RoleName.MANAGER, RoleName.HEAD] },
            },
          },
        },
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });
    const managers = await Promise.all(
      users.map((user) => this.buildManagerKpi(user, range, period)),
    );

    return {
      weights: {
        salesPlan: 40,
        qualifiedLeads: 15,
        conversion: 15,
        deadlineCompliance: 15,
        crmDiscipline: 15,
      },
      managers,
    };
  }

  private async buildManagerKpi(
    user: ReportUser,
    range: DateRange,
    period: Date,
  ): Promise<KpiManagerMetric> {
    const [
      salesPlan,
      leadPlan,
      wonSales,
      totalLeads,
      qualifiedLeads,
      convertedLeads,
      completedTasks,
      completedOnTimeTasks,
      activityCount,
    ] = await this.prisma.$transaction([
      this.prisma.salesPlan.findUnique({
        where: { userId_period: { userId: user.id, period } },
      }),
      this.prisma.leadPlan.findUnique({
        where: { userId_period: { userId: user.id, period } },
      }),
      this.prisma.deal.aggregate({
        where: {
          ownerId: user.id,
          stage: DealStage.WON,
          deletedAt: null,
          updatedAt: range,
        },
        _sum: { totalAmount: true },
      }),
      this.prisma.lead.count({
        where: {
          ownerId: user.id,
          deletedAt: null,
          createdAt: range,
        },
      }),
      this.prisma.lead.count({
        where: {
          ownerId: user.id,
          deletedAt: null,
          status: { in: [LeadStatus.QUALIFIED, LeadStatus.CONVERTED] },
          updatedAt: range,
        },
      }),
      this.prisma.lead.count({
        where: {
          ownerId: user.id,
          deletedAt: null,
          status: LeadStatus.CONVERTED,
          updatedAt: range,
        },
      }),
      this.prisma.task.count({
        where: {
          assigneeId: user.id,
          status: TaskStatus.COMPLETED,
          completedAt: range,
        },
      }),
      this.prisma.task.count({
        where: {
          assigneeId: user.id,
          status: TaskStatus.COMPLETED,
          completedAt: range,
          dueDate: { gte: range.gte },
        },
      }),
      this.prisma.activity.count({
        where: {
          authorId: user.id,
          createdAt: range,
        },
      }),
    ]);
    const actualSales = this.toNumber(wonSales._sum.totalAmount);
    const salesPlanPercent = salesPlan
      ? this.percent(actualSales, this.toNumber(salesPlan.targetAmount))
      : 0;
    const qualifiedLeadsPercent = leadPlan
      ? this.percent(qualifiedLeads, leadPlan.targetCount)
      : 0;
    const conversionPercent = this.percent(convertedLeads, totalLeads);
    const deadlineCompliancePercent = this.percent(
      completedOnTimeTasks,
      completedTasks,
    );
    const crmDisciplinePercent = Math.min(100, this.percent(activityCount, 20));
    const totalScore =
      salesPlanPercent * 0.4 +
      qualifiedLeadsPercent * 0.15 +
      conversionPercent * 0.15 +
      deadlineCompliancePercent * 0.15 +
      crmDisciplinePercent * 0.15;

    return {
      managerId: user.id,
      managerName: this.userName(user),
      salesPlanPercent: this.round(salesPlanPercent),
      qualifiedLeadsPercent: this.round(qualifiedLeadsPercent),
      conversionPercent: this.round(conversionPercent),
      deadlineCompliancePercent: this.round(deadlineCompliancePercent),
      crmDisciplinePercent: this.round(crmDisciplinePercent),
      totalScore: this.round(totalScore),
    };
  }

  private buildDateRange(filterDto: ReportFilterDto): DateRange {
    const now = new Date();
    const from = filterDto.dateFrom ?? this.startOfMonth(now);
    const to = filterDto.dateTo ?? this.endOfMonth(from);

    return { gte: from, lte: to };
  }

  private startOfMonth(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), 1);
  }

  private endOfMonth(date: Date): Date {
    return new Date(
      date.getFullYear(),
      date.getMonth() + 1,
      0,
      23,
      59,
      59,
      999,
    );
  }

  private percent(value: number, total: number): number {
    if (total <= 0) {
      return 0;
    }

    return Math.min(100, (value / total) * 100);
  }

  private round(value: number): number {
    return Math.round(value * 100) / 100;
  }

  private toNumber(value: Prisma.Decimal | number | null | undefined): number {
    return value === null || value === undefined ? 0 : Number(value);
  }

  private userName(user: ReportUser): string {
    return `${user.firstName} ${user.lastName}`.trim();
  }
}
