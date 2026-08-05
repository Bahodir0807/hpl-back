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
Object.defineProperty(exports, "__esModule", { value: true });
exports.TasksService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const prisma_service_1 = require("../prisma/prisma.service");
const task_status_calculator_1 = require("./utils/task-status-calculator");
const READ_ALL_TASKS_PERMISSION = 'tasks:read_all';
const CRITICAL_OVERDUE_NOTIFICATION_TYPE = 'TASK_CRITICAL_OVERDUE';
let TasksService = class TasksService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async create(dto, createdById) {
        const computedStatus = (0, task_status_calculator_1.calculateComputedStatus)(dto.dueDate, client_1.TaskStatus.PENDING);
        return this.prisma.task.create({
            data: {
                title: dto.title,
                description: dto.description,
                type: dto.type,
                priority: dto.priority,
                dueDate: dto.dueDate,
                originalDueDate: dto.dueDate,
                assigneeId: dto.assigneeId,
                createdById,
                relatedType: dto.relatedType,
                relatedId: dto.relatedId,
                computedStatus,
            },
        });
    }
    async findAll(filterDto, currentUserId, permissions) {
        const page = filterDto.page ?? 1;
        const limit = filterDto.limit ?? 20;
        const where = this.buildTaskWhere(filterDto, currentUserId, permissions);
        const tasks = await this.prisma.task.findMany({
            where,
            include: {
                assignee: {
                    select: { managerId: true },
                },
            },
            orderBy: { dueDate: 'asc' },
            skip: (page - 1) * limit,
            take: limit,
        });
        const enrichedTasks = await Promise.all(tasks.map((task) => this.syncComputedStatusAndNotifications(task)));
        const filteredItems = filterDto.computedStatus
            ? enrichedTasks.filter((task) => task.computedStatus === filterDto.computedStatus)
            : enrichedTasks;
        return {
            items: filteredItems,
            total: filteredItems.length,
            page,
            limit,
        };
    }
    async findOne(id) {
        const task = await this.prisma.task.findUnique({
            where: { id },
            include: {
                assignee: {
                    select: {
                        id: true,
                        email: true,
                        firstName: true,
                        lastName: true,
                        managerId: true,
                    },
                },
                createdBy: {
                    select: {
                        id: true,
                        email: true,
                        firstName: true,
                        lastName: true,
                    },
                },
                rescheduleHistory: {
                    include: {
                        author: {
                            select: {
                                id: true,
                                email: true,
                                firstName: true,
                                lastName: true,
                            },
                        },
                    },
                    orderBy: { createdAt: 'desc' },
                },
                notifications: {
                    orderBy: { createdAt: 'desc' },
                },
            },
        });
        if (!task) {
            throw new common_1.NotFoundException('Task not found');
        }
        const computedStatus = (0, task_status_calculator_1.calculateComputedStatus)(task.dueDate, task.status);
        if (computedStatus !== task.computedStatus) {
            await this.prisma.task.update({
                where: { id },
                data: { computedStatus },
            });
        }
        if (computedStatus === client_1.TaskComputedStatus.CRITICAL_OVERDUE) {
            await this.createCriticalOverdueNotificationIfNeeded({
                taskId: task.id,
                managerId: task.assignee.managerId,
                title: task.title,
                relatedType: task.relatedType,
                relatedId: task.relatedId,
            });
        }
        return {
            ...task,
            computedStatus,
        };
    }
    async getMyDay(currentUserId) {
        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const startOfTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
        const tasks = await this.prisma.task.findMany({
            where: {
                assigneeId: currentUserId,
                status: {
                    notIn: [client_1.TaskStatus.COMPLETED, client_1.TaskStatus.CANCELLED],
                },
                OR: [
                    {
                        dueDate: {
                            gte: startOfToday,
                            lt: startOfTomorrow,
                        },
                    },
                    {
                        dueDate: {
                            lt: now,
                        },
                    },
                ],
            },
            include: {
                assignee: {
                    select: { managerId: true },
                },
            },
            orderBy: { dueDate: 'asc' },
        });
        const enrichedTasks = await Promise.all(tasks.map((task) => this.syncComputedStatusAndNotifications(task)));
        return {
            today: enrichedTasks.filter((task) => task.dueDate >= startOfToday && task.dueDate < startOfTomorrow),
            overdue: enrichedTasks.filter((task) => task.computedStatus === client_1.TaskComputedStatus.OVERDUE),
            critical: enrichedTasks.filter((task) => task.computedStatus === client_1.TaskComputedStatus.CRITICAL_OVERDUE),
        };
    }
    async complete(id, dto, currentUserId) {
        const result = dto.result.trim();
        if (!result) {
            throw new common_1.BadRequestException('result is required to complete task');
        }
        await this.ensureTaskExists(id);
        return this.prisma.$transaction(async (tx) => {
            const completedTask = await tx.task.update({
                where: { id },
                data: {
                    status: client_1.TaskStatus.COMPLETED,
                    computedStatus: client_1.TaskComputedStatus.ON_TIME,
                    result,
                    completedAt: new Date(),
                },
            });
            if (dto.createNextTask) {
                await tx.task.create({
                    data: {
                        title: dto.createNextTask.title,
                        description: dto.createNextTask.description,
                        type: dto.createNextTask.type,
                        priority: dto.createNextTask.priority,
                        dueDate: dto.createNextTask.dueDate,
                        originalDueDate: dto.createNextTask.dueDate,
                        assigneeId: dto.createNextTask.assigneeId,
                        createdById: currentUserId,
                        relatedType: dto.createNextTask.relatedType,
                        relatedId: dto.createNextTask.relatedId,
                        computedStatus: (0, task_status_calculator_1.calculateComputedStatus)(dto.createNextTask.dueDate, client_1.TaskStatus.PENDING),
                    },
                });
            }
            return completedTask;
        });
    }
    async reschedule(id, dto, currentUserId) {
        const reason = dto.reason.trim();
        if (!reason) {
            throw new common_1.BadRequestException('reason is required to reschedule task');
        }
        const task = await this.ensureTaskExists(id);
        const computedStatus = (0, task_status_calculator_1.calculateComputedStatus)(dto.newDueDate, task.status);
        return this.prisma.$transaction(async (tx) => {
            await tx.taskRescheduleHistory.create({
                data: {
                    taskId: id,
                    oldDueDate: task.dueDate,
                    newDueDate: dto.newDueDate,
                    reason,
                    authorId: currentUserId,
                },
            });
            return tx.task.update({
                where: { id },
                data: {
                    dueDate: dto.newDueDate,
                    computedStatus,
                    rescheduleCount: { increment: 1 },
                },
            });
        });
    }
    async cancel(id) {
        await this.ensureTaskExists(id);
        return this.prisma.task.update({
            where: { id },
            data: {
                status: client_1.TaskStatus.CANCELLED,
                computedStatus: client_1.TaskComputedStatus.ON_TIME,
            },
        });
    }
    async escalateCriticalOverdues() {
        const criticalBoundary = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const tasks = await this.prisma.task.findMany({
            where: {
                status: {
                    notIn: [client_1.TaskStatus.COMPLETED, client_1.TaskStatus.CANCELLED],
                },
                dueDate: {
                    lt: criticalBoundary,
                },
            },
            include: {
                assignee: {
                    select: { managerId: true },
                },
            },
        });
        let createdCount = 0;
        for (const task of tasks) {
            if (task.computedStatus !== client_1.TaskComputedStatus.CRITICAL_OVERDUE) {
                await this.prisma.task.update({
                    where: { id: task.id },
                    data: { computedStatus: client_1.TaskComputedStatus.CRITICAL_OVERDUE },
                });
            }
            const notification = await this.createCriticalOverdueNotificationIfNeeded({
                taskId: task.id,
                managerId: task.assignee.managerId,
                title: task.title,
                relatedType: task.relatedType,
                relatedId: task.relatedId,
            });
            if (notification) {
                createdCount += 1;
            }
        }
        return createdCount;
    }
    buildTaskWhere(filterDto, currentUserId, permissions) {
        const canReadAllTasks = permissions.includes(READ_ALL_TASKS_PERMISSION);
        return {
            assigneeId: canReadAllTasks
                ? filterDto.assigneeId
                : (filterDto.assigneeId ?? currentUserId),
            createdById: filterDto.createdById,
            relatedType: filterDto.relatedType,
            relatedId: filterDto.relatedId,
            status: filterDto.status,
            priority: filterDto.priority,
            dueDate: {
                gte: filterDto.dateFrom,
                lte: filterDto.dateTo,
            },
        };
    }
    async syncComputedStatusAndNotifications(task) {
        const computedStatus = (0, task_status_calculator_1.calculateComputedStatus)(task.dueDate, task.status);
        if (computedStatus !== task.computedStatus) {
            await this.prisma.task.update({
                where: { id: task.id },
                data: { computedStatus },
            });
        }
        if (computedStatus === client_1.TaskComputedStatus.CRITICAL_OVERDUE) {
            await this.createCriticalOverdueNotificationIfNeeded({
                taskId: task.id,
                managerId: task.assignee.managerId,
                title: task.title,
                relatedType: task.relatedType,
                relatedId: task.relatedId,
            });
        }
        const { assignee: _assignee, ...taskWithoutAssignee } = task;
        void _assignee;
        return {
            ...taskWithoutAssignee,
            computedStatus,
        };
    }
    async createCriticalOverdueNotificationIfNeeded(input) {
        if (!input.managerId) {
            return null;
        }
        const existingNotification = await this.prisma.notification.findFirst({
            where: {
                taskId: input.taskId,
                userId: input.managerId,
                type: CRITICAL_OVERDUE_NOTIFICATION_TYPE,
            },
            select: { id: true },
        });
        if (existingNotification) {
            return null;
        }
        return this.prisma.notification.create({
            data: {
                userId: input.managerId,
                taskId: input.taskId,
                type: CRITICAL_OVERDUE_NOTIFICATION_TYPE,
                title: 'Critical task overdue',
                message: `Task is critically overdue: ${input.title}`,
                relatedType: input.relatedType,
                relatedId: input.relatedId,
            },
        });
    }
    async ensureTaskExists(id) {
        const task = await this.prisma.task.findUnique({ where: { id } });
        if (!task) {
            throw new common_1.NotFoundException('Task not found');
        }
        return task;
    }
};
exports.TasksService = TasksService;
exports.TasksService = TasksService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], TasksService);
//# sourceMappingURL=tasks.service.js.map