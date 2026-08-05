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
exports.ClientsController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const current_user_decorator_1 = require("../../common/decorators/current-user.decorator");
const permissions_decorator_1 = require("../../common/decorators/permissions.decorator");
const permissions_guard_1 = require("../../common/guards/permissions.guard");
const jwt_auth_guard_1 = require("../auth/guards/jwt-auth.guard");
const check_duplicates_dto_1 = require("./dto/check-duplicates.dto");
const create_client_dto_1 = require("./dto/create-client.dto");
const create_contact_dto_1 = require("./dto/create-contact.dto");
const create_project_object_dto_1 = require("./dto/create-project-object.dto");
const filter_client_dto_1 = require("./dto/filter-client.dto");
const update_client_dto_1 = require("./dto/update-client.dto");
const clients_service_1 = require("./clients.service");
let ClientsController = class ClientsController {
    clientsService;
    constructor(clientsService) {
        this.clientsService = clientsService;
    }
    checkDuplicates(dto) {
        return this.clientsService.checkDuplicates(dto);
    }
    create(dto, user) {
        return this.clientsService.create(dto, user.id);
    }
    findAll(filterDto, user) {
        return this.clientsService.findAll(filterDto, user.id, user.permissions);
    }
    findOne(id) {
        return this.clientsService.findOne(id);
    }
    update(id, dto) {
        return this.clientsService.update(id, dto);
    }
    addContact(id, dto) {
        return this.clientsService.addContact(id, dto);
    }
    addObject(id, dto) {
        return this.clientsService.addObject(id, dto);
    }
    softDelete(id) {
        return this.clientsService.softDelete(id);
    }
};
exports.ClientsController = ClientsController;
__decorate([
    (0, common_1.Post)('check-duplicates'),
    (0, permissions_decorator_1.RequirePermissions)('clients:read'),
    (0, swagger_1.ApiOperation)({ summary: 'Check client data for duplicates' }),
    (0, swagger_1.ApiResponse)({ status: 201, description: 'Potential duplicates returned' }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [check_duplicates_dto_1.CheckDuplicatesDto]),
    __metadata("design:returntype", void 0)
], ClientsController.prototype, "checkDuplicates", null);
__decorate([
    (0, common_1.Post)(),
    (0, permissions_decorator_1.RequirePermissions)('clients:create'),
    (0, swagger_1.ApiOperation)({ summary: 'Create client and primary contacts' }),
    (0, swagger_1.ApiResponse)({ status: 201, description: 'Client created' }),
    (0, swagger_1.ApiResponse)({ status: 409, description: 'Exact duplicate detected' }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_client_dto_1.CreateClientDto, Object]),
    __metadata("design:returntype", void 0)
], ClientsController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(),
    (0, permissions_decorator_1.RequirePermissions)('clients:read'),
    (0, swagger_1.ApiOperation)({ summary: 'List clients with filters and pagination' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Client list returned' }),
    __param(0, (0, common_1.Query)()),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [filter_client_dto_1.FilterClientDto, Object]),
    __metadata("design:returntype", void 0)
], ClientsController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, permissions_decorator_1.RequirePermissions)('clients:read'),
    (0, swagger_1.ApiOperation)({ summary: 'Get client card with related records' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Client card returned' }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Client not found' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], ClientsController.prototype, "findOne", null);
__decorate([
    (0, common_1.Patch)(':id'),
    (0, permissions_decorator_1.RequirePermissions)('clients:update'),
    (0, swagger_1.ApiOperation)({ summary: 'Update client' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Client updated' }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Client not found' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, update_client_dto_1.UpdateClientDto]),
    __metadata("design:returntype", void 0)
], ClientsController.prototype, "update", null);
__decorate([
    (0, common_1.Post)(':id/contacts'),
    (0, permissions_decorator_1.RequirePermissions)('clients:update'),
    (0, swagger_1.ApiOperation)({ summary: 'Add contact to client' }),
    (0, swagger_1.ApiResponse)({ status: 201, description: 'Contact added' }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Client not found' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, create_contact_dto_1.CreateContactDto]),
    __metadata("design:returntype", void 0)
], ClientsController.prototype, "addContact", null);
__decorate([
    (0, common_1.Post)(':id/objects'),
    (0, permissions_decorator_1.RequirePermissions)('clients:update'),
    (0, swagger_1.ApiOperation)({ summary: 'Add project object to client' }),
    (0, swagger_1.ApiResponse)({ status: 201, description: 'Project object added' }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Client not found' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, create_project_object_dto_1.CreateProjectObjectDto]),
    __metadata("design:returntype", void 0)
], ClientsController.prototype, "addObject", null);
__decorate([
    (0, common_1.Delete)(':id'),
    (0, permissions_decorator_1.RequirePermissions)('clients:delete'),
    (0, swagger_1.ApiOperation)({ summary: 'Soft delete client' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Client soft deleted' }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Client not found' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], ClientsController.prototype, "softDelete", null);
exports.ClientsController = ClientsController = __decorate([
    (0, swagger_1.ApiTags)('Clients'),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard, permissions_guard_1.PermissionsGuard),
    (0, common_1.Controller)('clients'),
    __metadata("design:paramtypes", [clients_service_1.ClientsService])
], ClientsController);
//# sourceMappingURL=clients.controller.js.map