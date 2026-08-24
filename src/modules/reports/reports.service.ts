import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  DealStage,
  ExpectedReceiptStatus,
  InstallationStatus,
  LeadPlan,
  LeadStatus,
  Prisma,
  RoleName,
  SalesPlan,
  SupplierOrderStatus,
  TaskStatus,
} from '@prisma/client';
import type { Cache } from 'cache-manager';
import { PrismaService } from '../prisma/prisma.service';
import { ReportFilterDto } from './dto/report-filter.dto';
import { UpsertSalesPlanDto } from './dto/upsert-sales-plan.dto';

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
  amount: number | null;
  currency: string | null;
  amounts: Array<{ amount: number; currency: string }>;
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
  salesPlanPercent: number | null;
  salesPlanCurrency: string | null;
  actualSalesInPlanCurrency: number | null;
  salesPlanStatus: 'COMPLETE' | 'INCOMPLETE' | 'NOT_CONFIGURED';
  missingFxCurrencies: string[];
  qualifiedLeadsPercent: number;
  conversionPercent: number;
  deadlineCompliancePercent: number;
  crmDisciplinePercent: number;
  totalScore: number | null;
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
  salesPlan:
    | (SalesPlan & {
        fxRates: Array<{
          fromCurrency: string;
          rateToPlanCurrency: Prisma.Decimal;
        }>;
      })
    | undefined;
  leadPlan: LeadPlan | undefined;
  wonAmounts: Array<{ amount: number; currency: string }>;
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

  async getOverview(filterDto: ReportFilterDto) {
    return this.cached('overview', filterDto, async () => {
      const range = this.buildDateRange(filterDto);
      const now = new Date();
      const supplierActive = [
        SupplierOrderStatus.DRAFT,
        SupplierOrderStatus.SENT_TO_PRODUCTION,
        SupplierOrderStatus.IN_PRODUCTION,
        SupplierOrderStatus.READY_FOR_SHIPMENT,
        SupplierOrderStatus.SHIPPED,
      ];
      const [
        leadStatuses,
        leadLossReasons,
        dealLossReasons,
        quoteCreated,
        quoteApproved,
        quoteAccepted,
        dealStages,
        completedDeals,
        supplierStatuses,
        overdueSupplierOrders,
        installationStatuses,
        pendingDualConfirmation,
        stock,
        warehousePurchases,
        quoteDurations,
        supplierDurations,
        completionDurations,
      ] = await Promise.all([
        this.prisma.lead.groupBy({
          by: ['status'],
          where: { deletedAt: null, createdAt: range },
          orderBy: { status: 'asc' },
          _count: { id: true },
        }),
        this.prisma.lead.groupBy({
          by: ['lostReasonCode'],
          where: { lostAt: range, lostReasonCode: { not: null } },
          orderBy: { lostReasonCode: 'asc' },
          _count: { id: true },
        }),
        this.prisma.deal.groupBy({
          by: ['lostReasonCode'],
          where: { lostAt: range, lostReasonCode: { not: null } },
          orderBy: { lostReasonCode: 'asc' },
          _count: { id: true },
        }),
        this.prisma.panelQuote.count({ where: { createdAt: range } }),
        this.prisma.panelQuote.count({
          where: {
            createdAt: range,
            status: { in: ['approved', 'converted'] },
          },
        }),
        this.prisma.panelQuote.count({ where: { clientAcceptedAt: range } }),
        this.prisma.deal.groupBy({
          by: ['stage'],
          where: { deletedAt: null, createdAt: range },
          orderBy: { stage: 'asc' },
          _count: { id: true },
        }),
        this.prisma.deal.count({
          where: { deletedAt: null, completedAt: range },
        }),
        this.prisma.supplierOrder.groupBy({
          by: ['status'],
          where: { createdAt: range },
          orderBy: { status: 'asc' },
          _count: { id: true },
        }),
        this.prisma.supplierOrder.count({
          where: {
            createdAt: range,
            status: { in: supplierActive },
            expectedReadyAt: { lt: now },
            readyConfirmedAt: null,
          },
        }),
        this.prisma.dealInstallation.groupBy({
          by: ['status'],
          where: { createdAt: range },
          orderBy: { status: 'asc' },
          _count: { id: true },
        }),
        this.prisma.dealInstallation.count({
          where: {
            createdAt: range,
            status: InstallationStatus.IN_PROGRESS,
            OR: [
              { installerConfirmedAt: null },
              { supervisorConfirmedAt: null },
            ],
          },
        }),
        this.prisma.stockBalance.aggregate({
          _count: { id: true },
          _sum: { onHand: true, reserved: true },
        }),
        this.prisma.expectedReceipt.groupBy({
          by: ['status'],
          where: { createdAt: range },
          orderBy: { status: 'asc' },
          _count: { id: true },
        }),
        this.prisma.panelQuote.findMany({
          where: { clientAcceptedAt: range },
          select: { createdAt: true, clientAcceptedAt: true },
        }),
        this.prisma.supplierOrder.findMany({
          where: { readyConfirmedAt: range, orderedAt: { not: null } },
          select: { orderedAt: true, readyConfirmedAt: true },
        }),
        this.prisma.deal.findMany({
          where: { completedAt: range },
          select: {
            completedAt: true,
            stageHistory: {
              where: { newStage: DealStage.WON },
              orderBy: { createdAt: 'asc' },
              take: 1,
              select: { createdAt: true },
            },
          },
        }),
      ]);

      const leadCounts = Object.fromEntries(
        leadStatuses.map((row) => [row.status, row._count.id]),
      );
      const dealCounts = Object.fromEntries(
        dealStages.map((row) => [row.stage, row._count.id]),
      );
      const supplierCounts = Object.fromEntries(
        supplierStatuses.map((row) => [row.status, row._count.id]),
      );
      const installationCounts = Object.fromEntries(
        installationStatuses.map((row) => [row.status, row._count.id]),
      );
      const purchaseCounts = Object.fromEntries(
        warehousePurchases.map((row) => [row.status, row._count.id]),
      );
      const leadLossCounts = Object.fromEntries(
        leadLossReasons
          .filter((row) => row.lostReasonCode !== null)
          .map((row) => [row.lostReasonCode!, row._count.id]),
      );
      const dealLossCounts = Object.fromEntries(
        dealLossReasons
          .filter((row) => row.lostReasonCode !== null)
          .map((row) => [row.lostReasonCode!, row._count.id]),
      );

      return {
        period: { from: range.gte, to: range.lte },
        leads: {
          total: Object.values(leadCounts).reduce(
            (sum, count) => sum + count,
            0,
          ),
          byStatus: leadCounts,
          qualified:
            (leadCounts[LeadStatus.QUALIFIED] ?? 0) +
            (leadCounts[LeadStatus.CONVERTED] ?? 0),
          converted: leadCounts[LeadStatus.CONVERTED] ?? 0,
          lost: leadCounts[LeadStatus.LOST] ?? 0,
          lossReasons: leadLossCounts,
        },
        quotes: {
          created: quoteCreated,
          approved: quoteApproved,
          clientAccepted: quoteAccepted,
        },
        deals: {
          byStage: dealCounts,
          active: Object.entries(dealCounts)
            .filter(
              ([stage]) => stage !== DealStage.WON && stage !== DealStage.LOST,
            )
            .reduce((sum, [, count]) => sum + count, 0),
          won: dealCounts[DealStage.WON] ?? 0,
          lost: dealCounts[DealStage.LOST] ?? 0,
          operationallyCompleted: completedDeals,
          lossReasons: dealLossCounts,
        },
        supplierOrders: {
          byStatus: supplierCounts,
          active: supplierActive.reduce(
            (sum, status) => sum + (supplierCounts[status] ?? 0),
            0,
          ),
          overdueReadiness: overdueSupplierOrders,
        },
        installation: {
          byStatus: installationCounts,
          scheduled: installationCounts[InstallationStatus.SCHEDULED] ?? 0,
          pendingDualConfirmation,
          completed: installationCounts[InstallationStatus.COMPLETED] ?? 0,
        },
        warehouse: {
          stockRows: stock._count.id,
          onHand: stock._sum.onHand ?? 0,
          reserved: stock._sum.reserved ?? 0,
          available: (stock._sum.onHand ?? 0) - (stock._sum.reserved ?? 0),
          pendingPurchases: purchaseCounts[ExpectedReceiptStatus.PENDING] ?? 0,
          partiallyReceivedPurchases:
            purchaseCounts[ExpectedReceiptStatus.PARTIALLY_RECEIVED] ?? 0,
        },
        averageDurationsHours: {
          quoteCreatedToClientAccepted: this.averageHours(
            quoteDurations.map((row) => [row.createdAt, row.clientAcceptedAt]),
          ),
          supplierOrderedToReady: this.averageHours(
            supplierDurations.map((row) => [
              row.orderedAt,
              row.readyConfirmedAt,
            ]),
          ),
          dealWonToOperationalCompletion: this.averageHours(
            completionDurations.map((row) => [
              row.stageHistory[0]?.createdAt ?? null,
              row.completedAt,
            ]),
          ),
        },
      };
    });
  }

  // Один groupBy по stage вместо 2 запросов на каждую из 9 стадий
  private async calculateFunnel(
    filterDto: ReportFilterDto,
  ): Promise<FunnelReport> {
    const range = this.buildDateRange(filterDto);
    const grouped = await this.prisma.deal.groupBy({
      by: ['stage', 'currency'],
      where: {
        deletedAt: null,
        ownerId: filterDto.managerId,
        createdAt: range,
      },
      orderBy: { stage: 'asc' },
      _count: { id: true },
      _sum: { totalAmount: true },
    });

    const stages = DEAL_STAGES.map((stage) => {
      const rows = grouped.filter((row) => row.stage === stage);
      const amounts = rows.map((row) => ({
        amount: this.toNumber(row._sum.totalAmount),
        currency: row.currency,
      }));

      return {
        stage,
        count: rows.reduce((sum, row) => sum + row._count.id, 0),
        amount: amounts.length === 1 ? amounts[0].amount : null,
        currency: amounts.length === 1 ? amounts[0].currency : null,
        amounts,
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

  async upsertSalesPlan(dto: UpsertSalesPlanDto, createdById: string) {
    const period = this.startOfMonth(dto.period);
    const currencyCode = dto.currencyCode.trim().toUpperCase();
    const duplicate = new Set<string>();
    for (const rate of dto.fxRates) {
      const from = rate.fromCurrency.trim().toUpperCase();
      if (from === currencyCode || duplicate.has(from)) {
        throw new BadRequestException(
          'FX currencies must be unique and different from plan currency',
        );
      }
      duplicate.add(from);
    }

    const plan = await this.prisma.$transaction(async (tx) => {
      const plan = await tx.salesPlan.upsert({
        where: { userId_period: { userId: dto.userId, period } },
        create: {
          userId: dto.userId,
          period,
          targetAmount: new Prisma.Decimal(dto.targetAmount),
          currencyCode,
        },
        update: {
          targetAmount: new Prisma.Decimal(dto.targetAmount),
          currencyCode,
        },
      });
      await tx.salesPlanFxRate.deleteMany({ where: { salesPlanId: plan.id } });
      if (dto.fxRates.length) {
        await tx.salesPlanFxRate.createMany({
          data: dto.fxRates.map((rate) => ({
            salesPlanId: plan.id,
            fromCurrency: rate.fromCurrency.trim().toUpperCase(),
            rateToPlanCurrency: new Prisma.Decimal(rate.rateToPlanCurrency),
            createdById,
          })),
        });
      }
      return tx.salesPlan.findUniqueOrThrow({
        where: { id: plan.id },
        include: { fxRates: { orderBy: { fromCurrency: 'asc' } } },
      });
    });
    await this.cacheManager.clear();
    return plan;
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
        include: { fxRates: true },
      }),
      this.prisma.leadPlan.findMany({
        where: { userId: { in: userIds }, period },
      }),
      // Won-суммы — по факту перехода в WON внутри периода (DealStageHistory),
      // а не по updatedAt, который триггерится любым редактированием сделки
      this.prisma.deal.groupBy({
        by: ['ownerId', 'currency'],
        where: {
          deletedAt: null,
          stageHistory: {
            some: { newStage: DealStage.WON, createdAt: range },
          },
        },
        orderBy: [{ ownerId: 'asc' }, { currency: 'asc' }],
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
    const wonMap = new Map<
      string,
      Array<{ amount: number; currency: string }>
    >();
    for (const row of wonByOwner) {
      const current = wonMap.get(row.ownerId) ?? [];
      current.push({
        amount: this.toNumber(row._sum.totalAmount),
        currency: row.currency.trim().toUpperCase(),
      });
      wonMap.set(row.ownerId, current);
    }
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
        wonAmounts: wonMap.get(user.id) ?? [],
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
    const fxMap = new Map(
      metrics.salesPlan?.fxRates.map((rate) => [
        rate.fromCurrency.trim().toUpperCase(),
        this.toNumber(rate.rateToPlanCurrency),
      ]) ?? [],
    );
    const planCurrency =
      metrics.salesPlan?.currencyCode?.trim().toUpperCase() ?? null;
    const missingFxCurrencies = metrics.salesPlan
      ? [
          ...new Set(
            metrics.wonAmounts
              .map((row) => row.currency)
              .filter(
                (currency) => currency !== planCurrency && !fxMap.has(currency),
              ),
          ),
        ]
      : [];
    const actualSalesInPlanCurrency =
      metrics.salesPlan && planCurrency && missingFxCurrencies.length === 0
        ? metrics.wonAmounts.reduce(
            (sum, row) =>
              sum +
              row.amount *
                (row.currency === planCurrency ? 1 : fxMap.get(row.currency)!),
            0,
          )
        : null;
    const salesPlanPercent =
      metrics.salesPlan && actualSalesInPlanCurrency !== null
        ? this.percent(
            actualSalesInPlanCurrency,
            this.toNumber(metrics.salesPlan.targetAmount),
          )
        : null;
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
      salesPlanPercent === null
        ? null
        : salesPlanPercent * 0.4 +
          qualifiedLeadsPercent * 0.15 +
          conversionPercent * 0.15 +
          deadlineCompliancePercent * 0.15 +
          crmDisciplinePercent * 0.15;

    return {
      managerId: user.id,
      managerName: this.userName(user),
      salesPlanPercent:
        salesPlanPercent === null ? null : this.round(salesPlanPercent),
      salesPlanCurrency: planCurrency,
      actualSalesInPlanCurrency:
        actualSalesInPlanCurrency === null
          ? null
          : this.round(actualSalesInPlanCurrency),
      salesPlanStatus: !metrics.salesPlan
        ? 'NOT_CONFIGURED'
        : !planCurrency || missingFxCurrencies.length
          ? 'INCOMPLETE'
          : 'COMPLETE',
      missingFxCurrencies,
      qualifiedLeadsPercent: this.round(qualifiedLeadsPercent),
      conversionPercent: this.round(conversionPercent),
      deadlineCompliancePercent: this.round(deadlineCompliancePercent),
      crmDisciplinePercent: this.round(crmDisciplinePercent),
      totalScore: totalScore === null ? null : this.round(totalScore),
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

    if (from > to) {
      throw new BadRequestException(
        'dateFrom must be before or equal to dateTo',
      );
    }

    return { gte: from, lte: to };
  }

  private averageHours(
    pairs: Array<[Date | null, Date | null]>,
  ): number | null {
    const durations = pairs
      .filter((pair): pair is [Date, Date] => Boolean(pair[0] && pair[1]))
      .map(([start, end]) => (end.getTime() - start.getTime()) / 3_600_000)
      .filter((duration) => duration >= 0);
    if (durations.length === 0) return null;
    return this.round(
      durations.reduce((sum, duration) => sum + duration, 0) / durations.length,
    );
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
