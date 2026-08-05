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
var TasksCronService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.TasksCronService = void 0;
const common_1 = require("@nestjs/common");
const schedule_1 = require("@nestjs/schedule");
const tasks_service_1 = require("./tasks.service");
let TasksCronService = TasksCronService_1 = class TasksCronService {
    tasksService;
    logger = new common_1.Logger(TasksCronService_1.name);
    constructor(tasksService) {
        this.tasksService = tasksService;
    }
    async escalateCriticalOverdues() {
        const createdCount = await this.tasksService.escalateCriticalOverdues();
        if (createdCount > 0) {
            this.logger.log(`Created ${createdCount} critical overdue notifications`);
        }
    }
};
exports.TasksCronService = TasksCronService;
__decorate([
    (0, schedule_1.Cron)(schedule_1.CronExpression.EVERY_10_MINUTES),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], TasksCronService.prototype, "escalateCriticalOverdues", null);
exports.TasksCronService = TasksCronService = TasksCronService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [tasks_service_1.TasksService])
], TasksCronService);
//# sourceMappingURL=tasks-cron.service.js.map