import { DealStage } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ReportFilterDto } from './dto/report-filter.dto';
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
export declare class ReportsService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    getFunnel(filterDto: ReportFilterDto): Promise<FunnelReport>;
    getOverdues(filterDto: ReportFilterDto): Promise<OverduesReport>;
    getKpi(filterDto: ReportFilterDto): Promise<KpiReport>;
    private buildManagerKpi;
    private buildDateRange;
    private startOfMonth;
    private endOfMonth;
    private percent;
    private round;
    private toNumber;
    private userName;
}
