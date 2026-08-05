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
exports.TasksController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const current_user_decorator_1 = require("../../common/decorators/current-user.decorator");
const permissions_decorator_1 = require("../../common/decorators/permissions.decorator");
const permissions_guard_1 = require("../../common/guards/permissions.guard");
const jwt_auth_guard_1 = require("../auth/guards/jwt-auth.guard");
const complete_task_dto_1 = require("./dto/complete-task.dto");
const create_task_dto_1 = require("./dto/create-task.dto");
const filter_task_dto_1 = require("./dto/filter-task.dto");
const reschedule_task_dto_1 = require("./dto/reschedule-task.dto");
const tasks_service_1 = require("./tasks.service");
let TasksController = class TasksController {
    tasksService;
    constructor(tasksService) {
        this.tasksService = tasksService;
    }
    create(dto, user) {
        return this.tasksService.create(dto, user.id);
    }
    findAll(filterDto, user) {
        return this.tasksService.findAll(filterDto, user.id, user.permissions);
    }
    myDay(user) {
        return this.tasksService.getMyDay(user.id);
    }
    findOne(id) {
        return this.tasksService.findOne(id);
    }
    complete(id, dto, user) {
        return this.tasksService.complete(id, dto, user.id);
    }
    completePatch(id, dto, user) {
        return this.tasksService.complete(id, dto, user.id);
    }
    reschedule(id, dto, user) {
        return this.tasksService.reschedule(id, dto, user.id);
    }
    cancel(id) {
        return this.tasksService.cancel(id);
    }
};
exports.TasksController = TasksController;
__decorate([
    (0, common_1.Post)(),
    (0, permissions_decorator_1.RequirePermissions)('tasks:create'),
    (0, swagger_1.ApiOperation)({ summary: 'Create task' }),
    (0, swagger_1.ApiResponse)({ status: 201, description: 'Task created' }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_task_dto_1.CreateTaskDto, Object]),
    __metadata("design:returntype", void 0)
], TasksController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(),
    (0, permissions_decorator_1.RequirePermissions)('tasks:read'),
    (0, swagger_1.ApiOperation)({ summary: 'List tasks with filters and pagination' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Task list returned' }),
    __param(0, (0, common_1.Query)()),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [filter_task_dto_1.FilterTaskDto, Object]),
    __metadata("design:returntype", void 0)
], TasksController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)('my-day'),
    (0, permissions_decorator_1.RequirePermissions)('tasks:read'),
    (0, swagger_1.ApiOperation)({ summary: 'Get current user task dashboard for today' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'My day task dashboard returned' }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], TasksController.prototype, "myDay", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, permissions_decorator_1.RequirePermissions)('tasks:read'),
    (0, swagger_1.ApiOperation)({ summary: 'Get task card with reschedule history' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Task card returned' }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Task not found' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], TasksController.prototype, "findOne", null);
__decorate([
    (0, common_1.Post)(':id/complete'),
    (0, permissions_decorator_1.RequirePermissions)('tasks:update'),
    (0, swagger_1.ApiOperation)({ summary: 'Complete task with result' }),
    (0, swagger_1.ApiResponse)({ status: 201, description: 'Task completed' }),
    (0, swagger_1.ApiResponse)({ status: 400, description: 'Result is required' }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Task not found' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, complete_task_dto_1.CompleteTaskDto, Object]),
    __metadata("design:returntype", void 0)
], TasksController.prototype, "complete", null);
__decorate([
    (0, common_1.Patch)(':id/complete'),
    (0, permissions_decorator_1.RequirePermissions)('tasks:update'),
    (0, swagger_1.ApiOperation)({ summary: 'Complete task with result' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Task completed' }),
    (0, swagger_1.ApiResponse)({ status: 400, description: 'Result is required' }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Task not found' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, complete_task_dto_1.CompleteTaskDto, Object]),
    __metadata("design:returntype", void 0)
], TasksController.prototype, "completePatch", null);
__decorate([
    (0, common_1.Post)(':id/reschedule'),
    (0, permissions_decorator_1.RequirePermissions)('tasks:update'),
    (0, swagger_1.ApiOperation)({ summary: 'Reschedule task with reason' }),
    (0, swagger_1.ApiResponse)({ status: 201, description: 'Task rescheduled' }),
    (0, swagger_1.ApiResponse)({ status: 400, description: 'Reason is required' }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Task not found' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, reschedule_task_dto_1.RescheduleTaskDto, Object]),
    __metadata("design:returntype", void 0)
], TasksController.prototype, "reschedule", null);
__decorate([
    (0, common_1.Delete)(':id'),
    (0, permissions_decorator_1.RequirePermissions)('tasks:delete'),
    (0, swagger_1.ApiOperation)({ summary: 'Cancel task' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Task cancelled' }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Task not found' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseUUIDPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], TasksController.prototype, "cancel", null);
exports.TasksController = TasksController = __decorate([
    (0, swagger_1.ApiTags)('Tasks'),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard, permissions_guard_1.PermissionsGuard),
    (0, common_1.Controller)('tasks'),
    __metadata("design:paramtypes", [tasks_service_1.TasksService])
], TasksController);
//# sourceMappingURL=tasks.controller.js.map