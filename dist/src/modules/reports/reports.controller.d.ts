import { ReportFilterDto } from './dto/report-filter.dto';
import { ReportsService } from './reports.service';
export declare class ReportsController {
    private readonly reportsService;
    constructor(reportsService: ReportsService);
    getFunnel(filterDto: ReportFilterDto): Promise<import("./reports.service").FunnelReport>;
    getOverdues(filterDto: ReportFilterDto): Promise<import("./reports.service").OverduesReport>;
    getKpi(filterDto: ReportFilterDto): Promise<import("./reports.service").KpiReport>;
}
