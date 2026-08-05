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
exports.OrdersController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const current_user_decorator_1 = require("../../common/decorators/current-user.decorator");
const permissions_decorator_1 = require("../../common/decorators/permissions.decorator");
const permissions_guard_1 = require("../../common/guards/permissions.guard");
const jwt_auth_guard_1 = require("../auth/guards/jwt-auth.guard");
const confirm_payment_dto_1 = require("./dto/confirm-payment.dto");
const create_delivery_dto_1 = require("./dto/create-delivery.dto");
const create_order_from_deal_dto_1 = require("./dto/create-order-from-deal.dto");
const create_payment_dto_1 = require("./dto/create-payment.dto");
const filter_order_dto_1 = require("./dto/filter-order.dto");
const orders_service_1 = require("./orders.service");
let OrdersController = class OrdersController {
    ordersService;
    constructor(ordersService) {
        this.ordersService = ordersService;
    }
    createFromDeal(dto, user) {
        return this.ordersService.createFromDeal(dto, user.id);
    }
    findAll(filterDto) {
        return this.ordersService.findAll(filterDto);
    }
    findOne(id) {
        return this.ordersService.findOne(id);
    }
    addPayment(id, dto, user) {
        return this.ordersService.addPayment({ ...dto, orderId: id }, user.id);
    }
    confirmPayment(paymentId, dto, user) {
        return this.ordersService.confirmPayment(paymentId, dto, user.id);
    }
    createDelivery(id, dto) {
        return this.ordersService.createDelivery({ ...dto, orderId: id });
    }
};
exports.OrdersController = OrdersController;
__decorate([
    (0, common_1.Post)('from-deal'),
    (0, permissions_decorator_1.RequirePermissions)('orders:create'),
    (0, swagger_1.ApiOperation)({ summary: 'Create order from won deal' }),
    (0, swagger_1.ApiResponse)({ status: 201, description: 'Order created' }),
    (0, swagger_1.ApiResponse)({ status: 400, description: 'Deal is not won or has no items' }),
    (0, swagger_1.ApiResponse)({ status: 409, description: 'Order already exists for deal' }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_order_from_deal_dto_1.CreateOrderFromDealDto, Object]),
    __metadata("design:returntype", void 0)
], OrdersController.prototype, "createFromDeal", null);
__decorate([
    (0, common_1.Get)(),
    (0, permissions_decorator_1.RequirePermissions)('orders:read'),
    (0, swagger_1.ApiOperation)({ summary: 'List orders with status and payment filters' }),
    (0, swagger_1.ApiQuery)({ name: 'status', required: false }),
    (0, swagger_1.ApiQuery)({ name: 'paymentStatus', required: false }),
    (0, swagger_1.ApiQuery)({ name: 'dealId', required: false }),
    (0, swagger_1.ApiQuery)({ name: 'page', required: false, type: Number }),
    (0, swagger_1.ApiQuery)({ name: 'limit', required: false, type: Number }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Order list returned' }),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [filter_order_dto_1.FilterOrderDto]),
    __metadata("design:returntype", void 0)
], OrdersController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, permissions_decorator_1.RequirePermissions)('orders:read'),
    (0, swagger_1.ApiOperation)({
        summary: 'Get order card with items, payments and deliveries',
    }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Order card returned' }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Order not found' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], OrdersController.prototype, "findOne", null);
__decorate([
    (0, common_1.Post)(':id/payments'),
    (0, permissions_decorator_1.RequirePermissions)('payments:create'),
    (0, swagger_1.ApiOperation)({ summary: 'Register pending payment for order' }),
    (0, swagger_1.ApiResponse)({ status: 201, description: 'Payment registered' }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Order not found' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, create_payment_dto_1.CreatePaymentDto, Object]),
    __metadata("design:returntype", void 0)
], OrdersController.prototype, "addPayment", null);
__decorate([
    (0, common_1.Patch)('payments/:paymentId/confirm'),
    (0, permissions_decorator_1.RequirePermissions)('payments:confirm'),
    (0, swagger_1.ApiOperation)({
        summary: 'Confirm or reject payment and recalculate balance',
    }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Payment status applied' }),
    (0, swagger_1.ApiResponse)({ status: 400, description: 'Invalid payment status' }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Payment not found' }),
    __param(0, (0, common_1.Param)('paymentId', common_1.ParseUUIDPipe)),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, confirm_payment_dto_1.ConfirmPaymentDto, Object]),
    __metadata("design:returntype", void 0)
], OrdersController.prototype, "confirmPayment", null);
__decorate([
    (0, common_1.Post)(':id/deliveries'),
    (0, permissions_decorator_1.RequirePermissions)('deliveries:create'),
    (0, swagger_1.ApiOperation)({ summary: 'Create and execute order delivery' }),
    (0, swagger_1.ApiResponse)({
        status: 201,
        description: 'Delivery created and stock written off',
    }),
    (0, swagger_1.ApiResponse)({
        status: 400,
        description: 'Insufficient stock or invalid quantity',
    }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Order or order item not found' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, create_delivery_dto_1.CreateDeliveryDto]),
    __metadata("design:returntype", void 0)
], OrdersController.prototype, "createDelivery", null);
exports.OrdersController = OrdersController = __decorate([
    (0, swagger_1.ApiTags)('Orders'),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard, permissions_guard_1.PermissionsGuard),
    (0, common_1.Controller)('orders'),
    __metadata("design:paramtypes", [orders_service_1.OrdersService])
], OrdersController);
//# sourceMappingURL=orders.controller.js.map