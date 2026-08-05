import { TaskComputedStatus, TaskStatus } from '@prisma/client';
export declare function calculateComputedStatus(dueDate: Date, status: TaskStatus, warningHours?: number, criticalHours?: number): TaskComputedStatus;
