"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RequirePermissions = exports.REQUIRED_PERMISSIONS_KEY = void 0;
const common_1 = require("@nestjs/common");
exports.REQUIRED_PERMISSIONS_KEY = 'requiredPermissions';
const RequirePermissions = (...permissions) => (0, common_1.SetMetadata)(exports.REQUIRED_PERMISSIONS_KEY, permissions);
exports.RequirePermissions = RequirePermissions;
//# sourceMappingURL=permissions.decorator.js.map