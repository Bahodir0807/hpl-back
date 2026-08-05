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
exports.ReferencesController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const permissions_decorator_1 = require("../../common/decorators/permissions.decorator");
const permissions_guard_1 = require("../../common/guards/permissions.guard");
const jwt_auth_guard_1 = require("../auth/guards/jwt-auth.guard");
const create_brand_dto_1 = require("./dto/create-brand.dto");
const create_product_collection_dto_1 = require("./dto/create-product-collection.dto");
const create_supplier_dto_1 = require("./dto/create-supplier.dto");
const update_brand_dto_1 = require("./dto/update-brand.dto");
const update_product_collection_dto_1 = require("./dto/update-product-collection.dto");
const update_supplier_dto_1 = require("./dto/update-supplier.dto");
const references_service_1 = require("./references.service");
let ReferencesController = class ReferencesController {
    referencesService;
    constructor(referencesService) {
        this.referencesService = referencesService;
    }
    createSupplier(dto) {
        return this.referencesService.createSupplier(dto);
    }
    findSuppliers() {
        return this.referencesService.findSuppliers();
    }
    findSupplier(id) {
        return this.referencesService.findSupplier(id);
    }
    updateSupplier(id, dto) {
        return this.referencesService.updateSupplier(id, dto);
    }
    deleteSupplier(id) {
        return this.referencesService.deleteSupplier(id);
    }
    createBrand(dto) {
        return this.referencesService.createBrand(dto);
    }
    findBrands() {
        return this.referencesService.findBrands();
    }
    findBrand(id) {
        return this.referencesService.findBrand(id);
    }
    updateBrand(id, dto) {
        return this.referencesService.updateBrand(id, dto);
    }
    deleteBrand(id) {
        return this.referencesService.deleteBrand(id);
    }
    createProductCollection(dto) {
        return this.referencesService.createProductCollection(dto);
    }
    findProductCollections(brandId) {
        return this.referencesService.findProductCollections(brandId);
    }
    findProductCollection(id) {
        return this.referencesService.findProductCollection(id);
    }
    updateProductCollection(id, dto) {
        return this.referencesService.updateProductCollection(id, dto);
    }
    deleteProductCollection(id) {
        return this.referencesService.deleteProductCollection(id);
    }
};
exports.ReferencesController = ReferencesController;
__decorate([
    (0, common_1.Post)('suppliers'),
    (0, permissions_decorator_1.RequirePermissions)('references:create'),
    (0, swagger_1.ApiOperation)({ summary: 'Create supplier' }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_supplier_dto_1.CreateSupplierDto]),
    __metadata("design:returntype", void 0)
], ReferencesController.prototype, "createSupplier", null);
__decorate([
    (0, common_1.Get)('suppliers'),
    (0, permissions_decorator_1.RequirePermissions)('references:read'),
    (0, swagger_1.ApiOperation)({ summary: 'List suppliers' }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], ReferencesController.prototype, "findSuppliers", null);
__decorate([
    (0, common_1.Get)('suppliers/:id'),
    (0, permissions_decorator_1.RequirePermissions)('references:read'),
    (0, swagger_1.ApiOperation)({ summary: 'Get supplier' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], ReferencesController.prototype, "findSupplier", null);
__decorate([
    (0, common_1.Patch)('suppliers/:id'),
    (0, permissions_decorator_1.RequirePermissions)('references:update'),
    (0, swagger_1.ApiOperation)({ summary: 'Update supplier' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, update_supplier_dto_1.UpdateSupplierDto]),
    __metadata("design:returntype", void 0)
], ReferencesController.prototype, "updateSupplier", null);
__decorate([
    (0, common_1.Delete)('suppliers/:id'),
    (0, permissions_decorator_1.RequirePermissions)('references:delete'),
    (0, swagger_1.ApiOperation)({ summary: 'Delete supplier' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], ReferencesController.prototype, "deleteSupplier", null);
__decorate([
    (0, common_1.Post)('brands'),
    (0, permissions_decorator_1.RequirePermissions)('references:create'),
    (0, swagger_1.ApiOperation)({ summary: 'Create brand' }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_brand_dto_1.CreateBrandDto]),
    __metadata("design:returntype", void 0)
], ReferencesController.prototype, "createBrand", null);
__decorate([
    (0, common_1.Get)('brands'),
    (0, permissions_decorator_1.RequirePermissions)('references:read'),
    (0, swagger_1.ApiOperation)({ summary: 'List brands' }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], ReferencesController.prototype, "findBrands", null);
__decorate([
    (0, common_1.Get)('brands/:id'),
    (0, permissions_decorator_1.RequirePermissions)('references:read'),
    (0, swagger_1.ApiOperation)({ summary: 'Get brand' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], ReferencesController.prototype, "findBrand", null);
__decorate([
    (0, common_1.Patch)('brands/:id'),
    (0, permissions_decorator_1.RequirePermissions)('references:update'),
    (0, swagger_1.ApiOperation)({ summary: 'Update brand' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, update_brand_dto_1.UpdateBrandDto]),
    __metadata("design:returntype", void 0)
], ReferencesController.prototype, "updateBrand", null);
__decorate([
    (0, common_1.Delete)('brands/:id'),
    (0, permissions_decorator_1.RequirePermissions)('references:delete'),
    (0, swagger_1.ApiOperation)({ summary: 'Delete brand' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], ReferencesController.prototype, "deleteBrand", null);
__decorate([
    (0, common_1.Post)('collections'),
    (0, permissions_decorator_1.RequirePermissions)('references:create'),
    (0, swagger_1.ApiOperation)({ summary: 'Create product collection' }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_product_collection_dto_1.CreateProductCollectionDto]),
    __metadata("design:returntype", void 0)
], ReferencesController.prototype, "createProductCollection", null);
__decorate([
    (0, common_1.Get)('collections'),
    (0, permissions_decorator_1.RequirePermissions)('references:read'),
    (0, swagger_1.ApiOperation)({ summary: 'List product collections' }),
    (0, swagger_1.ApiQuery)({ name: 'brandId', required: false }),
    __param(0, (0, common_1.Query)('brandId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], ReferencesController.prototype, "findProductCollections", null);
__decorate([
    (0, common_1.Get)('collections/:id'),
    (0, permissions_decorator_1.RequirePermissions)('references:read'),
    (0, swagger_1.ApiOperation)({ summary: 'Get product collection' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], ReferencesController.prototype, "findProductCollection", null);
__decorate([
    (0, common_1.Patch)('collections/:id'),
    (0, permissions_decorator_1.RequirePermissions)('references:update'),
    (0, swagger_1.ApiOperation)({ summary: 'Update product collection' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, update_product_collection_dto_1.UpdateProductCollectionDto]),
    __metadata("design:returntype", void 0)
], ReferencesController.prototype, "updateProductCollection", null);
__decorate([
    (0, common_1.Delete)('collections/:id'),
    (0, permissions_decorator_1.RequirePermissions)('references:delete'),
    (0, swagger_1.ApiOperation)({ summary: 'Delete product collection' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], ReferencesController.prototype, "deleteProductCollection", null);
exports.ReferencesController = ReferencesController = __decorate([
    (0, swagger_1.ApiTags)('References'),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard, permissions_guard_1.PermissionsGuard),
    (0, common_1.Controller)('references'),
    __metadata("design:paramtypes", [references_service_1.ReferencesService])
], ReferencesController);
//# sourceMappingURL=references.controller.js.map