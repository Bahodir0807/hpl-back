"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReportsService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const prisma_service_1 = require("../prisma/prisma.service");
const DEAL_STAGES = [
    client_1.DealStage.QUALIFICATION,
    client_1.DealStage.HPL_SELECTION,
    client_1.DealStage.OFFER_PREPARATION,
    client_1.DealStage.NEGOTIATION,
    client_1.DealStage.AGREEMENT_PENDING,
    client_1.DealStage.PAYMENT_PREPARATION,
    client_1.DealStage.SHIPPED,
    client_1.DealStage.WON,
    client_1.DealStage.LOST,
];
const OPEN_TASK_STATUSES = [
    client_1.TaskStatus.PENDING,
    client_1.TaskStatus.IN_PROGRESS,
];
let ReportsService = class ReportsService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async getFunnel(filterDto) {
        const range = this.buildDateRange(filterDto);
        const baseWhere = {
            deletedAt: null,
            ownerId: filterDto.managerId,
            createdAt: range,
        };
        const stages = await Promise.all(DEAL_STAGES.map(async (stage) => {
            const where = {
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
        }));
        const totalDeals = stages.reduce((sum, stage) => sum + stage.count, 0);
        const wonDeals = stages.find((stage) => stage.stage === client_1.DealStage.WON)?.count ?? 0;
        const firstStageCount = stages[0]?.count ?? 0;
        const metrics = stages.map((stage, index) => {
            const previousCount = index === 0 ? firstStageCount : stages[index - 1].count;
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
    async getOverdues(filterDto) {
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
        const groups = new Map();
        for (const task of tasks) {
            const managerId = task.assignee.id;
            const current = groups.get(managerId) ?? {
                user: task.assignee,
                overdueCount: 0,
                criticalOverdueCount: 0,
                delayHoursTotal: 0,
            };
            current.overdueCount += 1;
            current.delayHoursTotal += Math.max(0, (now.getTime() - task.dueDate.getTime()) / 3_600_000);
            if (task.dueDate < criticalBefore) {
                current.criticalOverdueCount += 1;
            }
            groups.set(managerId, current);
        }
        const managers = Array.from(groups.values()).map((group) => ({
            managerId: group.user.id,
            managerName: this.userName(group.user),
            overdueCount: group.overdueCount,
            criticalOverdueCount: group.criticalOverdueCount,
            averageDelayHours: group.overdueCount > 0
                ? this.round(group.delayHoursTotal / group.overdueCount)
                : 0,
        }));
        return {
            managers,
            totalOverdue: tasks.length,
            totalCritical: managers.reduce((sum, manager) => sum + manager.criticalOverdueCount, 0),
        };
    }
    async getKpi(filterDto) {
        const range = this.buildDateRange(filterDto);
        const period = this.startOfMonth(range.gte);
        const users = await this.prisma.user.findMany({
            where: {
                id: filterDto.managerId,
                isActive: true,
                roles: {
                    some: {
                        role: {
                            name: { in: [client_1.RoleName.MANAGER, client_1.RoleName.HEAD] },
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
        const managers = await Promise.all(users.map((user) => this.buildManagerKpi(user, range, period)));
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
    async buildManagerKpi(user, range, period) {
        const [salesPlan, leadPlan, wonSales, totalLeads, qualifiedLeads, convertedLeads, completedTasks, completedOnTimeTasks, activityCount,] = await this.prisma.$transaction([
            this.prisma.salesPlan.findUnique({
                where: { userId_period: { userId: user.id, period } },
            }),
            this.prisma.leadPlan.findUnique({
                where: { userId_period: { userId: user.id, period } },
            }),
            this.prisma.deal.aggregate({
                where: {
                    ownerId: user.id,
                    stage: client_1.DealStage.WON,
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
                    status: { in: [client_1.LeadStatus.QUALIFIED, client_1.LeadStatus.CONVERTED] },
                    updatedAt: range,
                },
            }),
            this.prisma.lead.count({
                where: {
                    ownerId: user.id,
                    deletedAt: null,
                    status: client_1.LeadStatus.CONVERTED,
                    updatedAt: range,
                },
            }),
            this.prisma.task.count({
                where: {
                    assigneeId: user.id,
                    status: client_1.TaskStatus.COMPLETED,
                    completedAt: range,
                },
            }),
            this.prisma.task.count({
                where: {
                    assigneeId: user.id,
                    status: client_1.TaskStatus.COMPLETED,
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
        const deadlineCompliancePercent = this.percent(completedOnTimeTasks, completedTasks);
        const crmDisciplinePercent = Math.min(100, this.percent(activityCount, 20));
        const totalScore = salesPlanPercent * 0.4 +
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
    buildDateRange(filterDto) {
        const now = new Date();
        const from = filterDto.dateFrom ?? this.startOfMonth(now);
        const to = filterDto.dateTo ?? this.endOfMonth(from);
        return { gte: from, lte: to };
    }
    startOfMonth(date) {
        return new Date(date.getFullYear(), date.getMonth(), 1);
    }
    endOfMonth(date) {
        return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
    }
    percent(value, total) {
        if (total <= 0) {
            return 0;
        }
        return Math.min(100, (value / total) * 100);
    }
    round(value) {
        return Math.round(value * 100) / 100;
    }
    toNumber(value) {
        return value === null || value === undefined ? 0 : Number(value);
    }
    userName(user) {
        return `${user.firstName} ${user.lastName}`.trim();
    }
};
exports.ReportsService = ReportsService;
exports.ReportsService = ReportsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], ReportsService);
//# sourceMappingURL=reports.service.js.map