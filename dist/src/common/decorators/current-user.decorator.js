"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CurrentUser = exports.CurrentUserDecorator = void 0;
const common_1 = require("@nestjs/common");
exports.CurrentUserDecorator = (0, common_1.createParamDecorator)((data, ctx) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;
    if (!user) {
        return undefined;
    }
    return data ? user[data] : user;
});
exports.CurrentUser = exports.CurrentUserDecorator;
//# sourceMappingURL=current-user.decorator.js.map