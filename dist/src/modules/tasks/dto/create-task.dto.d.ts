import { TaskPriority, TaskType } from '@prisma/client';
export declare class CreateTaskDto {
    title: string;
    description?: string;
    type: TaskType;
    priority?: TaskPriority;
    dueDate: Date;
    assigneeId: string;
    relatedType: string;
    relatedId: string;
}
