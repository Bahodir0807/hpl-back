import { Task, TaskComputedStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CompleteTaskDto } from './dto/complete-task.dto';
import { CreateTaskDto } from './dto/create-task.dto';
import { FilterTaskDto } from './dto/filter-task.dto';
import { RescheduleTaskDto } from './dto/reschedule-task.dto';
type TaskWithRuntimeStatus = Task & {
    computedStatus: TaskComputedStatus;
};
type TaskListResult = {
    items: TaskWithRuntimeStatus[];
    total: number;
    page: number;
    limit: number;
};
type MyDayResult = {
    today: TaskWithRuntimeStatus[];
    overdue: TaskWithRuntimeStatus[];
    critical: TaskWithRuntimeStatus[];
};
export declare class TasksService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    create(dto: CreateTaskDto, createdById: string): Promise<Task>;
    findAll(filterDto: FilterTaskDto, currentUserId: string, permissions: string[]): Promise<TaskListResult>;
    findOne(id: string): Promise<{
        computedStatus: import("@prisma/client").$Enums.TaskComputedStatus;
        notifications: {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            userId: string;
            relatedType: string | null;
            relatedId: string | null;
            type: string;
            title: string;
            taskId: string | null;
            message: string | null;
            isRead: boolean;
            readAt: Date | null;
        }[];
        assignee: {
            id: string;
            email: string;
            firstName: string;
            lastName: string;
            managerId: string | null;
        };
        createdBy: {
            id: string;
            email: string;
            firstName: string;
            lastName: string;
        };
        rescheduleHistory: ({
            author: {
                id: string;
                email: string;
                firstName: string;
                lastName: string;
            };
        } & {
            id: string;
            createdAt: Date;
            authorId: string;
            reason: string;
            newDueDate: Date;
            taskId: string;
            oldDueDate: Date;
        })[];
        id: string;
        description: string | null;
        createdAt: Date;
        updatedAt: Date;
        result: string | null;
        status: import("@prisma/client").$Enums.TaskStatus;
        relatedType: string;
        relatedId: string;
        type: import("@prisma/client").$Enums.TaskType;
        title: string;
        priority: import("@prisma/client").$Enums.TaskPriority;
        dueDate: Date;
        originalDueDate: Date;
        completedAt: Date | null;
        rescheduleCount: number;
        assigneeId: string;
        createdById: string;
    }>;
    getMyDay(currentUserId: string): Promise<MyDayResult>;
    complete(id: string, dto: CompleteTaskDto, currentUserId: string): Promise<Task>;
    reschedule(id: string, dto: RescheduleTaskDto, currentUserId: string): Promise<Task>;
    cancel(id: string): Promise<Task>;
    escalateCriticalOverdues(): Promise<number>;
    private buildTaskWhere;
    private syncComputedStatusAndNotifications;
    private createCriticalOverdueNotificationIfNeeded;
    private ensureTaskExists;
}
export {};
