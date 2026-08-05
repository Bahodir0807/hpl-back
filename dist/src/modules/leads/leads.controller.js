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
exports.LeadsController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const current_user_decorator_1 = require("../../common/decorators/current-user.decorator");
const permissions_decorator_1 = require("../../common/decorators/permissions.decorator");
const permissions_guard_1 = require("../../common/guards/permissions.guard");
const jwt_auth_guard_1 = require("../auth/guards/jwt-auth.guard");
const assign_lead_dto_1 = require("./dto/assign-lead.dto");
const create_lead_dto_1 = require("./dto/create-lead.dto");
const disqualify_lead_dto_1 = require("./dto/disqualify-lead.dto");
const filter_lead_dto_1 = require("./dto/filter-lead.dto");
const qualify_lead_dto_1 = require("./dto/qualify-lead.dto");
const update_lead_dto_1 = require("./dto/update-lead.dto");
const leads_service_1 = require("./leads.service");
let LeadsController = class LeadsController {
    leadsService;
    constructor(leadsService) {
        this.leadsService = leadsService;
    }
    create(dto, user) {
        return this.leadsService.create(dto, user.id);
    }
    findAll(filterDto, user) {
        return this.leadsService.findAll(filterDto, user.id, user.permissions);
    }
    findOne(id) {
        return this.leadsService.findOne(id);
    }
    update(id, dto) {
        return this.leadsService.update(id, dto);
    }
    qualify(id, dto, user) {
        return this.leadsService.qualify(id, dto, user.id);
    }
    disqualify(id, dto) {
        return this.leadsService.disqualify(id, dto);
    }
    assign(id, dto, user) {
        return this.leadsService.assign(id, dto, user.id);
    }
    softDelete(id) {
        return this.leadsService.softDelete(id);
    }
};
exports.LeadsController = LeadsController;
__decorate([
    (0, common_1.Post)(),
    (0, permissions_decorator_1.RequirePermissions)('leads:create'),
    (0, swagger_1.ApiOperation)({ summary: 'Create lead and first-contact task' }),
    (0, swagger_1.ApiResponse)({ status: 201, description: 'Lead created' }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_lead_dto_1.CreateLeadDto, Object]),
    __metadata("design:returntype", void 0)
], LeadsController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(),
    (0, permissions_decorator_1.RequirePermissions)('leads:read'),
    (0, swagger_1.ApiOperation)({ summary: 'List leads with filters and pagination' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Lead list returned' }),
    __param(0, (0, common_1.Query)()),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [filter_lead_dto_1.FilterLeadDto, Object]),
    __metadata("design:returntype", void 0)
], LeadsController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, permissions_decorator_1.RequirePermissions)('leads:read'),
    (0, swagger_1.ApiOperation)({ summary: 'Get lead card with assignment history' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Lead card returned' }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Lead not found' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], LeadsController.prototype, "findOne", null);
__decorate([
    (0, common_1.Patch)(':id'),
    (0, permissions_decorator_1.RequirePermissions)('leads:update'),
    (0, swagger_1.ApiOperation)({ summary: 'Update lead fields' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Lead updated' }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Lead not found' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, update_lead_dto_1.UpdateLeadDto]),
    __metadata("design:returntype", void 0)
], LeadsController.prototype, "update", null);
__decorate([
    (0, common_1.Post)(':id/qualify'),
    (0, permissions_decorator_1.RequirePermissions)('leads:qualify'),
    (0, swagger_1.ApiOperation)({ summary: 'Qualify and convert lead to deal' }),
    (0, swagger_1.ApiResponse)({ status: 201, description: 'Lead converted to deal' }),
    (0, swagger_1.ApiResponse)({ status: 400, description: 'Qualification fields missing' }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Lead not found' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, qualify_lead_dto_1.QualifyLeadDto, Object]),
    __metadata("design:returntype", void 0)
], LeadsController.prototype, "qualify", null);
__decorate([
    (0, common_1.Post)(':id/disqualify'),
    (0, permissions_decorator_1.RequirePermissions)('leads:update'),
    (0, swagger_1.ApiOperation)({ summary: 'Disqualify lead with reason' }),
    (0, swagger_1.ApiResponse)({ status: 201, description: 'Lead disqualified' }),
    (0, swagger_1.ApiResponse)({ status: 400, description: 'Reason is required' }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Lead not found' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, disqualify_lead_dto_1.DisqualifyLeadDto]),
    __metadata("design:returntype", void 0)
], LeadsController.prototype, "disqualify", null);
__decorate([
    (0, common_1.Post)(':id/assign'),
    (0, permissions_decorator_1.RequirePermissions)('leads:assign'),
    (0, swagger_1.ApiOperation)({ summary: 'Assign lead owner' }),
    (0, swagger_1.ApiResponse)({ status: 201, description: 'Lead owner changed' }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Lead not found' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, assign_lead_dto_1.AssignLeadDto, Object]),
    __metadata("design:returntype", void 0)
], LeadsController.prototype, "assign", null);
__decorate([
    (0, common_1.Delete)(':id'),
    (0, permissions_decorator_1.RequirePermissions)('leads:delete'),
    (0, swagger_1.ApiOperation)({ summary: 'Soft delete lead' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Lead soft deleted' }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Lead not found' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], LeadsController.prototype, "softDelete", null);
exports.LeadsController = LeadsController = __decorate([
    (0, swagger_1.ApiTags)('Leads'),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard, permissions_guard_1.PermissionsGuard),
    (0, common_1.Controller)('leads'),
    __metadata("design:paramtypes", [leads_service_1.LeadsService])
], LeadsController);
//# sourceMappingURL=leads.controller.js.map