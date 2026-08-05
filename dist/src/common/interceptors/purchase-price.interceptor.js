"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PurchasePriceInterceptor = void 0;
const common_1 = require("@nestjs/common");
const rxjs_1 = require("rxjs");
const PURCHASE_PRICE_PERMISSION = 'products:read_purchase_price';
let PurchasePriceInterceptor = class PurchasePriceInterceptor {
    intercept(context, next) {
        const request = context.switchToHttp().getRequest();
        const permissions = request.user?.permissions ?? [];
        if (permissions.includes(PURCHASE_PRICE_PERMISSION)) {
            return next.handle();
        }
        return next
            .handle()
            .pipe((0, rxjs_1.map)((data) => this.sanitizeUnknown(data)));
    }
    sanitizeUnknown(value) {
        if (Array.isArray(value)) {
            return value
                .filter((item) => !this.isPurchasePriceObject(item))
                .map((item) => this.sanitizeUnknown(item));
        }
        if (!this.isJsonObject(value)) {
            return value;
        }
        const sanitized = {};
        for (const [key, nestedValue] of Object.entries(value)) {
            if (key === 'purchasePriceSnapshot' || key === 'margin') {
                continue;
            }
            sanitized[key] = this.sanitizeUnknown(nestedValue);
        }
        return sanitized;
    }
    isPurchasePriceObject(value) {
        return this.isJsonObject(value) && value.type === 'PURCHASE';
    }
    isJsonObject(value) {
        return typeof value === 'object' && value !== null && !Array.isArray(value);
    }
};
exports.PurchasePriceInterceptor = PurchasePriceInterceptor;
exports.PurchasePriceInterceptor = PurchasePriceInterceptor = __decorate([
    (0, common_1.Injectable)()
], PurchasePriceInterceptor);
//# sourceMappingURL=purchase-price.interceptor.js.map