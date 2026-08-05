import { TaskComputedStatus, TaskPriority, TaskStatus } from '@prisma/client';
export declare class FilterTaskDto {
    assigneeId?: string;
    createdById?: string;
    relatedType?: string;
    relatedId?: string;
    status?: TaskStatus;
    computedStatus?: TaskComputedStatus;
    priority?: TaskPriority;
    dateFrom?: Date;
    dateTo?: Date;
    page?: number;
    limit?: number;
}
