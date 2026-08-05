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
exports.DealsController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const current_user_decorator_1 = require("../../common/decorators/current-user.decorator");
const permissions_decorator_1 = require("../../common/decorators/permissions.decorator");
const permissions_guard_1 = require("../../common/guards/permissions.guard");
const purchase_price_interceptor_1 = require("../../common/interceptors/purchase-price.interceptor");
const jwt_auth_guard_1 = require("../auth/guards/jwt-auth.guard");
const change_stage_dto_1 = require("./dto/change-stage.dto");
const create_deal_dto_1 = require("./dto/create-deal.dto");
const create_offer_dto_1 = require("./dto/create-offer.dto");
const filter_deal_dto_1 = require("./dto/filter-deal.dto");
const set_deal_items_dto_1 = require("./dto/set-deal-items.dto");
const update_deal_dto_1 = require("./dto/update-deal.dto");
const deals_service_1 = require("./deals.service");
let DealsController = class DealsController {
    dealsService;
    constructor(dealsService) {
        this.dealsService = dealsService;
    }
    create(dto, user) {
        return this.dealsService.create(dto, user.id);
    }
    findAll(filterDto, user) {
        return this.dealsService.findAll(filterDto, user.id, user.permissions);
    }
    findOne(id) {
        return this.dealsService.findOne(id);
    }
    update(id, dto) {
        return this.dealsService.update(id, dto);
    }
    changeStage(id, dto, user) {
        return this.dealsService.changeStage(id, dto, user.id, user.permissions);
    }
    setItems(id, dto) {
        return this.dealsService.setItems(id, dto);
    }
    addOffer(id, dto) {
        return this.dealsService.addOffer(id, dto);
    }
    approveOffer(id, offerId) {
        return this.dealsService.approveOffer(id, offerId);
    }
    softDelete(id) {
        return this.dealsService.softDelete(id);
    }
};
exports.DealsController = DealsController;
__decorate([
    (0, common_1.Post)(),
    (0, permissions_decorator_1.RequirePermissions)('deals:create'),
    (0, swagger_1.ApiOperation)({ summary: 'Create deal with initial items and first task' }),
    (0, swagger_1.ApiResponse)({ status: 201, description: 'Deal created' }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_deal_dto_1.CreateDealDto, Object]),
    __metadata("design:returntype", void 0)
], DealsController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(),
    (0, permissions_decorator_1.RequirePermissions)('deals:read'),
    (0, swagger_1.ApiOperation)({ summary: 'List deals for kanban or table view' }),
    (0, swagger_1.ApiQuery)({ name: 'stage', required: false }),
    (0, swagger_1.ApiQuery)({ name: 'clientId', required: false }),
    (0, swagger_1.ApiQuery)({ name: 'ownerId', required: false }),
    (0, swagger_1.ApiQuery)({ name: 'projectObjectId', required: false }),
    (0, swagger_1.ApiQuery)({ name: 'search', required: false }),
    (0, swagger_1.ApiQuery)({ name: 'page', required: false, type: Number }),
    (0, swagger_1.ApiQuery)({ name: 'limit', required: false, type: Number }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Deal list returned' }),
    __param(0, (0, common_1.Query)()),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [filter_deal_dto_1.FilterDealDto, Object]),
    __metadata("design:returntype", void 0)
], DealsController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, permissions_decorator_1.RequirePermissions)('deals:read'),
    (0, swagger_1.ApiOperation)({ summary: 'Get deal card with all details' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Deal card returned' }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Deal not found' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], DealsController.prototype, "findOne", null);
__decorate([
    (0, common_1.Patch)(':id'),
    (0, permissions_decorator_1.RequirePermissions)('deals:update'),
    (0, swagger_1.ApiOperation)({ summary: 'Update deal fields' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Deal updated' }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Deal not found' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, update_deal_dto_1.UpdateDealDto]),
    __metadata("design:returntype", void 0)
], DealsController.prototype, "update", null);
__decorate([
    (0, common_1.Post)(':id/stage'),
    (0, permissions_decorator_1.RequirePermissions)('deals:update'),
    (0, swagger_1.ApiOperation)({ summary: 'Move deal to another pipeline stage' }),
    (0, swagger_1.ApiResponse)({ status: 201, description: 'Deal stage changed' }),
    (0, swagger_1.ApiResponse)({ status: 400, description: 'Stage requirements are not met' }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Deal not found' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, change_stage_dto_1.ChangeStageDto, Object]),
    __metadata("design:returntype", void 0)
], DealsController.prototype, "changeStage", null);
__decorate([
    (0, common_1.Post)(':id/items'),
    (0, permissions_decorator_1.RequirePermissions)('deals:update'),
    (0, swagger_1.ApiOperation)({ summary: 'Add or update deal items and recalculate totals' }),
    (0, swagger_1.ApiResponse)({ status: 201, description: 'Deal items updated' }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Deal or product not found' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, set_deal_items_dto_1.SetDealItemsDto]),
    __metadata("design:returntype", void 0)
], DealsController.prototype, "setItems", null);
__decorate([
    (0, common_1.Post)(':id/offers'),
    (0, permissions_decorator_1.RequirePermissions)('deals:create_offer'),
    (0, swagger_1.ApiOperation)({ summary: 'Create new commercial offer version' }),
    (0, swagger_1.ApiResponse)({ status: 201, description: 'Commercial offer created' }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Deal not found' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, create_offer_dto_1.CreateOfferDto]),
    __metadata("design:returntype", void 0)
], DealsController.prototype, "addOffer", null);
__decorate([
    (0, common_1.Patch)(':id/offers/:offerId/approve'),
    (0, permissions_decorator_1.RequirePermissions)('deals:approve_offer'),
    (0, swagger_1.ApiOperation)({ summary: 'Approve commercial offer' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Commercial offer approved' }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Deal offer not found' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, common_1.Param)('offerId', common_1.ParseUUIDPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], DealsController.prototype, "approveOffer", null);
__decorate([
    (0, common_1.Delete)(':id'),
    (0, permissions_decorator_1.RequirePermissions)('deals:delete'),
    (0, swagger_1.ApiOperation)({ summary: 'Soft delete deal' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Deal soft deleted' }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Deal not found' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], DealsController.prototype, "softDelete", null);
exports.DealsController = DealsController = __decorate([
    (0, swagger_1.ApiTags)('Deals'),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard, permissions_guard_1.PermissionsGuard),
    (0, common_1.UseInterceptors)(purchase_price_interceptor_1.PurchasePriceInterceptor),
    (0, common_1.Controller)('deals'),
    __metadata("design:paramtypes", [deals_service_1.DealsService])
], DealsController);
//# sourceMappingURL=deals.controller.js.map