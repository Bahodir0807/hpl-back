import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Notification,
  Prisma,
  Task,
  TaskComputedStatus,
  TaskStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CompleteTaskDto } from './dto/complete-task.dto';
import { CreateTaskDto } from './dto/create-task.dto';
import { FilterTaskDto } from './dto/filter-task.dto';
import { RescheduleTaskDto } from './dto/reschedule-task.dto';
import { calculateComputedStatus } from './utils/task-status-calculator';

const READ_ALL_TASKS_PERMISSION = 'tasks:read_all';
const CRITICAL_OVERDUE_NOTIFICATION_TYPE = 'TASK_CRITICAL_OVERDUE';

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

type TaskWithAssigneeManager = Task & {
  assignee: {
    managerId: string | null;
  };
};

@Injectable()
export class TasksService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateTaskDto, createdById: string): Promise<Task> {
    const computedStatus = calculateComputedStatus(
      dto.dueDate,
      TaskStatus.PENDING,
    );

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

  async findAll(
    filterDto: FilterTaskDto,
    currentUserId: string,
    permissions: string[],
  ): Promise<TaskListResult> {
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

    const enrichedTasks = await Promise.all(
      tasks.map((task) => this.syncComputedStatusAndNotifications(task)),
    );
    const filteredItems = filterDto.computedStatus
      ? enrichedTasks.filter(
          (task) => task.computedStatus === filterDto.computedStatus,
        )
      : enrichedTasks;

    return {
      items: filteredItems,
      total: filteredItems.length,
      page,
      limit,
    };
  }

  async findOne(id: string) {
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
      throw new NotFoundException('Task not found');
    }

    const computedStatus = calculateComputedStatus(task.dueDate, task.status);

    if (computedStatus !== task.computedStatus) {
      await this.prisma.task.update({
        where: { id },
        data: { computedStatus },
      });
    }

    if (computedStatus === TaskComputedStatus.CRITICAL_OVERDUE) {
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

  async getMyDay(currentUserId: string): Promise<MyDayResult> {
    const now = new Date();
    const startOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const startOfTomorrow = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
    );

    const tasks = await this.prisma.task.findMany({
      where: {
        assigneeId: currentUserId,
        status: {
          notIn: [TaskStatus.COMPLETED, TaskStatus.CANCELLED],
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

    const enrichedTasks = await Promise.all(
      tasks.map((task) => this.syncComputedStatusAndNotifications(task)),
    );

    return {
      today: enrichedTasks.filter(
        (task) =>
          task.dueDate >= startOfToday && task.dueDate < startOfTomorrow,
      ),
      overdue: enrichedTasks.filter(
        (task) => task.computedStatus === TaskComputedStatus.OVERDUE,
      ),
      critical: enrichedTasks.filter(
        (task) => task.computedStatus === TaskComputedStatus.CRITICAL_OVERDUE,
      ),
    };
  }

  async complete(
    id: string,
    dto: CompleteTaskDto,
    currentUserId: string,
  ): Promise<Task> {
    const result = dto.result.trim();

    if (!result) {
      throw new BadRequestException('result is required to complete task');
    }

    await this.ensureTaskExists(id);

    return this.prisma.$transaction(async (tx) => {
      const completedTask = await tx.task.update({
        where: { id },
        data: {
          status: TaskStatus.COMPLETED,
          computedStatus: TaskComputedStatus.ON_TIME,
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
            computedStatus: calculateComputedStatus(
              dto.createNextTask.dueDate,
              TaskStatus.PENDING,
            ),
          },
        });
      }

      return completedTask;
    });
  }

  async reschedule(
    id: string,
    dto: RescheduleTaskDto,
    currentUserId: string,
  ): Promise<Task> {
    const reason = dto.reason.trim();

    if (!reason) {
      throw new BadRequestException('reason is required to reschedule task');
    }

    const task = await this.ensureTaskExists(id);
    const computedStatus = calculateComputedStatus(dto.newDueDate, task.status);

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

  async cancel(id: string): Promise<Task> {
    await this.ensureTaskExists(id);

    return this.prisma.task.update({
      where: { id },
      data: {
        status: TaskStatus.CANCELLED,
        computedStatus: TaskComputedStatus.ON_TIME,
      },
    });
  }

  async escalateCriticalOverdues(): Promise<number> {
    const criticalBoundary = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const tasks = await this.prisma.task.findMany({
      where: {
        status: {
          notIn: [TaskStatus.COMPLETED, TaskStatus.CANCELLED],
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
      if (task.computedStatus !== TaskComputedStatus.CRITICAL_OVERDUE) {
        await this.prisma.task.update({
          where: { id: task.id },
          data: { computedStatus: TaskComputedStatus.CRITICAL_OVERDUE },
        });
      }

      const notification = await this.createCriticalOverdueNotificationIfNeeded(
        {
          taskId: task.id,
          managerId: task.assignee.managerId,
          title: task.title,
          relatedType: task.relatedType,
          relatedId: task.relatedId,
        },
      );

      if (notification) {
        createdCount += 1;
      }
    }

    return createdCount;
  }

  private buildTaskWhere(
    filterDto: FilterTaskDto,
    currentUserId: string,
    permissions: string[],
  ): Prisma.TaskWhereInput {
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

  private async syncComputedStatusAndNotifications(
    task: TaskWithAssigneeManager,
  ): Promise<TaskWithRuntimeStatus> {
    const computedStatus = calculateComputedStatus(task.dueDate, task.status);

    if (computedStatus !== task.computedStatus) {
      await this.prisma.task.update({
        where: { id: task.id },
        data: { computedStatus },
      });
    }

    if (computedStatus === TaskComputedStatus.CRITICAL_OVERDUE) {
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

  private async createCriticalOverdueNotificationIfNeeded(input: {
    taskId: string;
    managerId: string | null;
    title: string;
    relatedType: string;
    relatedId: string;
  }): Promise<Notification | null> {
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

  private async ensureTaskExists(id: string): Promise<Task> {
    const task = await this.prisma.task.findUnique({ where: { id } });

    if (!task) {
      throw new NotFoundException('Task not found');
    }

    return task;
  }
}
