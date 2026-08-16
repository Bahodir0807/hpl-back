import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import {
  DealStage,
  LeadPlan,
  LeadStatus,
  Prisma,
  RoleName,
  SalesPlan,
  TaskStatus,
} from '@prisma/client';
import type { Cache } from 'cache-manager';
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

type ManagerKpiInput = {
  salesPlan: SalesPlan | undefined;
  leadPlan: LeadPlan | undefined;
  actualSales: number;
  totalLeads: number;
  qualifiedLeads: number;
  convertedLeads: number;
  completedTasks: number;
  completedOnTimeTasks: number;
  activityCount: number;
};

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  async getFunnel(filterDto: ReportFilterDto): Promise<FunnelReport> {
    return this.cached('funnel', filterDto, () =>
      this.calculateFunnel(filterDto),
    );
  }

  // Один groupBy по stage вместо 2 запросов на каждую из 9 стадий
  private async calculateFunnel(
    filterDto: ReportFilterDto,
  ): Promise<FunnelReport> {
    const range = this.buildDateRange(filterDto);
    const grouped = await this.prisma.deal.groupBy({
      by: ['stage'],
      where: {
        deletedAt: null,
        ownerId: filterDto.managerId,
        createdAt: range,
      },
      orderBy: { stage: 'asc' },
      _count: { id: true },
      _sum: { totalAmount: true },
    });

    const byStage = new Map(grouped.map((row) => [row.stage, row]));
    const stages = DEAL_STAGES.map((stage) => {
      const row = byStage.get(stage);

      return {
        stage,
        count: row?._count.id ?? 0,
        amount: this.toNumber(row?._sum.totalAmount),
      };
    });
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
    return this.cached('overdues', filterDto, () =>
      this.calculateOverdues(filterDto),
    );
  }

  private async calculateOverdues(
    filterDto: ReportFilterDto,
  ): Promise<OverduesReport> {
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
    return this.cached('kpi', filterDto, () => this.calculateKpi(filterDto));
  }

  // 9 запросов на всех менеджеров вместо 9 запросов на каждого
  private async calculateKpi(filterDto: ReportFilterDto): Promise<KpiReport> {
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
    const userIds = users.map((user) => user.id);

    if (userIds.length === 0) {
      return {
        weights: {
          salesPlan: 40,
          qualifiedLeads: 15,
          conversion: 15,
          deadlineCompliance: 15,
          crmDiscipline: 15,
        },
        managers: [],
      };
    }

    const [
      salesPlans,
      leadPlans,
      wonByOwner,
      leadsTotalByOwner,
      leadsQualifiedByOwner,
      leadsConvertedByOwner,
      completedTasks,
      activityByAuthor,
    ] = await Promise.all([
      this.prisma.salesPlan.findMany({
        where: { userId: { in: userIds }, period },
      }),
      this.prisma.leadPlan.findMany({
        where: { userId: { in: userIds }, period },
      }),
      // Won-суммы — по факту перехода в WON внутри периода (DealStageHistory),
      // а не по updatedAt, который триггерится любым редактированием сделки
      this.prisma.deal.groupBy({
        by: ['ownerId'],
        where: {
          deletedAt: null,
          stageHistory: {
            some: { newStage: DealStage.WON, createdAt: range },
          },
        },
        orderBy: { ownerId: 'asc' },
        _sum: { totalAmount: true },
      }),
      this.prisma.lead.groupBy({
        by: ['ownerId'],
        where: { deletedAt: null, createdAt: range },
        orderBy: { ownerId: 'asc' },
        _count: { id: true },
      }),
      this.prisma.lead.groupBy({
        by: ['ownerId'],
        where: {
          deletedAt: null,
          status: { in: [LeadStatus.QUALIFIED, LeadStatus.CONVERTED] },
          updatedAt: range,
        },
        orderBy: { ownerId: 'asc' },
        _count: { id: true },
      }),
      this.prisma.lead.groupBy({
        by: ['ownerId'],
        where: {
          deletedAt: null,
          status: LeadStatus.CONVERTED,
          updatedAt: range,
        },
        orderBy: { ownerId: 'asc' },
        _count: { id: true },
      }),
      // Prisma не умеет сравнивать колонки между собой (completedAt <= dueDate),
      // поэтому on-time считаем в памяти по одной выборке
      this.prisma.task.findMany({
        where: {
          assigneeId: { in: userIds },
          status: TaskStatus.COMPLETED,
          completedAt: range,
        },
        select: { assigneeId: true, completedAt: true, dueDate: true },
      }),
      this.prisma.activity.groupBy({
        by: ['authorId'],
        where: { authorId: { in: userIds }, createdAt: range },
        orderBy: { authorId: 'asc' },
        _count: { id: true },
      }),
    ]);

    const salesPlanMap = new Map(salesPlans.map((plan) => [plan.userId, plan]));
    const leadPlanMap = new Map(leadPlans.map((plan) => [plan.userId, plan]));
    const wonMap = new Map(
      wonByOwner.map((row) => [
        row.ownerId,
        this.toNumber(row._sum.totalAmount),
      ]),
    );
    const totalLeadsMap = new Map(
      leadsTotalByOwner.map((row) => [row.ownerId, row._count.id]),
    );
    const qualifiedMap = new Map(
      leadsQualifiedByOwner.map((row) => [row.ownerId, row._count.id]),
    );
    const convertedMap = new Map(
      leadsConvertedByOwner.map((row) => [row.ownerId, row._count.id]),
    );
    const activityMap = new Map(
      activityByAuthor.map((row) => [row.authorId, row._count.id]),
    );

    const completedMap = new Map<string, number>();
    const onTimeMap = new Map<string, number>();

    for (const task of completedTasks) {
      completedMap.set(
        task.assigneeId,
        (completedMap.get(task.assigneeId) ?? 0) + 1,
      );

      if (task.completedAt && task.completedAt <= task.dueDate) {
        onTimeMap.set(
          task.assigneeId,
          (onTimeMap.get(task.assigneeId) ?? 0) + 1,
        );
      }
    }

    const managers = users.map((user) =>
      this.buildManagerKpi(user, {
        salesPlan: salesPlanMap.get(user.id),
        leadPlan: leadPlanMap.get(user.id),
        actualSales: wonMap.get(user.id) ?? 0,
        totalLeads: totalLeadsMap.get(user.id) ?? 0,
        qualifiedLeads: qualifiedMap.get(user.id) ?? 0,
        convertedLeads: convertedMap.get(user.id) ?? 0,
        completedTasks: completedMap.get(user.id) ?? 0,
        completedOnTimeTasks: onTimeMap.get(user.id) ?? 0,
        activityCount: activityMap.get(user.id) ?? 0,
      }),
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

  private buildManagerKpi(
    user: ReportUser,
    metrics: ManagerKpiInput,
  ): KpiManagerMetric {
    const salesPlanPercent = metrics.salesPlan
      ? this.percent(
          metrics.actualSales,
          this.toNumber(metrics.salesPlan.targetAmount),
        )
      : 0;
    const qualifiedLeadsPercent = metrics.leadPlan
      ? this.percent(metrics.qualifiedLeads, metrics.leadPlan.targetCount)
      : 0;
    const conversionPercent = this.percent(
      metrics.convertedLeads,
      metrics.totalLeads,
    );
    const deadlineCompliancePercent = this.percent(
      metrics.completedOnTimeTasks,
      metrics.completedTasks,
    );
    const crmDisciplinePercent = Math.min(
      100,
      this.percent(metrics.activityCount, 20),
    );
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

  private async cached<T>(
    reportName: string,
    filterDto: ReportFilterDto,
    compute: () => Promise<T>,
  ): Promise<T> {
    const cacheKey = `reports:${reportName}:${filterDto.managerId ?? 'all'}:${
      filterDto.dateFrom?.toISOString() ?? ''
    }:${filterDto.dateTo?.toISOString() ?? ''}`;
    const cached = await this.cacheManager.get<T>(cacheKey);

    if (cached !== undefined) {
      return cached;
    }

    const result = await compute();
    await this.cacheManager.set(cacheKey, result);

    return result;
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
