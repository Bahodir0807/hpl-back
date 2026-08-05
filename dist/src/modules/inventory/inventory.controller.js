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
exports.InventoryController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const permissions_decorator_1 = require("../../common/decorators/permissions.decorator");
const permissions_guard_1 = require("../../common/guards/permissions.guard");
const jwt_auth_guard_1 = require("../auth/guards/jwt-auth.guard");
const create_expected_receipt_dto_1 = require("./dto/create-expected-receipt.dto");
const filter_expected_receipt_dto_1 = require("./dto/filter-expected-receipt.dto");
const filter_stock_balance_dto_1 = require("./dto/filter-stock-balance.dto");
const receive_expected_receipt_dto_1 = require("./dto/receive-expected-receipt.dto");
const inventory_service_1 = require("./inventory.service");
let InventoryController = class InventoryController {
    inventoryService;
    constructor(inventoryService) {
        this.inventoryService = inventoryService;
    }
    listBalances(filterDto) {
        return this.inventoryService.listBalances(filterDto);
    }
    getExpectedReceipts(filterDto) {
        return this.inventoryService.getExpectedReceipts(filterDto);
    }
    createExpectedReceipt(dto) {
        return this.inventoryService.createExpectedReceipt(dto);
    }
    processReceipt(id, dto) {
        return this.inventoryService.processReceipt(id, dto);
    }
};
exports.InventoryController = InventoryController;
__decorate([
    (0, common_1.Get)('balances'),
    (0, permissions_decorator_1.RequirePermissions)('inventory:read'),
    (0, swagger_1.ApiOperation)({ summary: 'List stock balances and reservations' }),
    (0, swagger_1.ApiQuery)({ name: 'productId', required: false }),
    (0, swagger_1.ApiQuery)({ name: 'page', required: false, type: Number }),
    (0, swagger_1.ApiQuery)({ name: 'limit', required: false, type: Number }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Stock balance list returned' }),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [filter_stock_balance_dto_1.FilterStockBalanceDto]),
    __metadata("design:returntype", void 0)
], InventoryController.prototype, "listBalances", null);
__decorate([
    (0, common_1.Get)('expected-receipts'),
    (0, permissions_decorator_1.RequirePermissions)('inventory:read'),
    (0, swagger_1.ApiOperation)({ summary: 'List expected supplier receipts' }),
    (0, swagger_1.ApiQuery)({ name: 'supplierId', required: false }),
    (0, swagger_1.ApiQuery)({ name: 'status', required: false }),
    (0, swagger_1.ApiQuery)({ name: 'dateFrom', required: false }),
    (0, swagger_1.ApiQuery)({ name: 'dateTo', required: false }),
    (0, swagger_1.ApiQuery)({ name: 'page', required: false, type: Number }),
    (0, swagger_1.ApiQuery)({ name: 'limit', required: false, type: Number }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Expected receipt list returned' }),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [filter_expected_receipt_dto_1.FilterExpectedReceiptDto]),
    __metadata("design:returntype", void 0)
], InventoryController.prototype, "getExpectedReceipts", null);
__decorate([
    (0, common_1.Post)('expected-receipts'),
    (0, permissions_decorator_1.RequirePermissions)('inventory:manage'),
    (0, swagger_1.ApiOperation)({ summary: 'Plan expected supplier receipt' }),
    (0, swagger_1.ApiResponse)({ status: 201, description: 'Expected receipt created' }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_expected_receipt_dto_1.CreateExpectedReceiptDto]),
    __metadata("design:returntype", void 0)
], InventoryController.prototype, "createExpectedReceipt", null);
__decorate([
    (0, common_1.Post)('expected-receipts/:id/receive'),
    (0, permissions_decorator_1.RequirePermissions)('inventory:manage'),
    (0, swagger_1.ApiOperation)({ summary: 'Receive expected goods to stock' }),
    (0, swagger_1.ApiResponse)({ status: 201, description: 'Expected receipt processed' }),
    (0, swagger_1.ApiResponse)({
        status: 400,
        description: 'Received quantity exceeds expected quantity',
    }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Expected receipt not found' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, receive_expected_receipt_dto_1.ReceiveExpectedReceiptDto]),
    __metadata("design:returntype", void 0)
], InventoryController.prototype, "processReceipt", null);
exports.InventoryController = InventoryController = __decorate([
    (0, swagger_1.ApiTags)('Inventory'),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard, permissions_guard_1.PermissionsGuard),
    (0, common_1.Controller)('inventory'),
    __metadata("design:paramtypes", [inventory_service_1.InventoryService])
], InventoryController);
//# sourceMappingURL=inventory.controller.js.map