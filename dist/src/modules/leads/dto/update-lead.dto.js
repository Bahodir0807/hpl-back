"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UpdateLeadDto = void 0;
const swagger_1 = require("@nestjs/swagger");
const create_lead_dto_1 = require("./create-lead.dto");
class UpdateLeadDto extends (0, swagger_1.PartialType)(create_lead_dto_1.CreateLeadDto) {
}
exports.UpdateLeadDto = UpdateLeadDto;
//# sourceMappingURL=update-lead.dto.js.map