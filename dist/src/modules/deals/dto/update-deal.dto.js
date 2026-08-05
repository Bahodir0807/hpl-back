"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UpdateDealDto = void 0;
const swagger_1 = require("@nestjs/swagger");
const create_deal_dto_1 = require("./create-deal.dto");
class UpdateDealDto extends (0, swagger_1.PartialType)(create_deal_dto_1.CreateDealDto) {
}
exports.UpdateDealDto = UpdateDealDto;
//# sourceMappingURL=update-deal.dto.js.map