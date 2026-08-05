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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReportsController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const permissions_decorator_1 = require("../../common/decorators/permissions.decorator");
const permissions_guard_1 = require("../../common/guards/permissions.guard");
const jwt_auth_guard_1 = require("../auth/guards/jwt-auth.guard");
const report_filter_dto_1 = require("./dto/report-filter.dto");
const reports_service_1 = require("./reports.service");
let ReportsController = class ReportsController {
    reportsService;
    constructor(reportsService) {
        this.reportsService = reportsService;
    }
    getFunnel(filterDto) {
        return this.reportsService.getFunnel(filterDto);
    }
    getOverdues(filterDto) {
        return this.reportsService.getOverdues(filterDto);
    }
    getKpi(filterDto) {
        return this.reportsService.getKpi(filterDto);
    }
};
exports.ReportsController = ReportsController;
__decorate([
    (0, common_1.Get)('funnel'),
    (0, permissions_decorator_1.RequirePermissions)('reports:read'),
    (0, swagger_1.ApiOperation)({ summary: 'Get aggregated sales funnel report' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Funnel report returned' }),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [report_filter_dto_1.ReportFilterDto]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "getFunnel", null);
__decorate([
    (0, common_1.Get)('overdues'),
    (0, permissions_decorator_1.RequirePermissions)('reports:read'),
    (0, swagger_1.ApiOperation)({ summary: 'Get overdue task report grouped by managers' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Overdue report returned' }),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [report_filter_dto_1.ReportFilterDto]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "getOverdues", null);
__decorate([
    (0, common_1.Get)('kpi'),
    (0, permissions_decorator_1.RequirePermissions)('reports:read'),
    (0, swagger_1.ApiOperation)({ summary: 'Get manager KPI report' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'KPI report returned' }),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [report_filter_dto_1.ReportFilterDto]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "getKpi", null);
exports.ReportsController = ReportsController = __decorate([
    (0, swagger_1.ApiTags)('Reports'),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard, permissions_guard_1.PermissionsGuard),
    (0, common_1.Controller)('reports'),
    __metadata("design:paramtypes", [reports_service_1.ReportsService])
], ReportsController);
//# sourceMappingURL=reports.controller.js.map