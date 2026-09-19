import {
  BadRequestException,
  ForbiddenException,
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
import type { CurrentUser } from '../../common/interfaces/current-user.interface';
import { NotificationService } from '../notifications/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { CompleteTaskDto } from './dto/complete-task.dto';
import { CreateTaskDto } from './dto/create-task.dto';
import { FilterTaskDto } from './dto/filter-task.dto';
import { RescheduleTaskDto } from './dto/reschedule-task.dto';
import { calculateComputedStatus } from './utils/task-status-calculator';
import { canAccessLeadRecord } from '../leads/engineering/engineering-access';

const READ_ALL_TASKS_PERMISSION = 'tasks:read_all';
const CRITICAL_OVERDUE_NOTIFICATION_TYPE = 'TASK_CRITICAL_OVERDUE';

const taskListInclude = Prisma.validator<Prisma.TaskInclude>()({
  assignee: {
    select: { id: true, firstName: true, lastName: true, email: true },
  },
});

type TaskListItem = Prisma.TaskGetPayload<{
  include: typeof taskListInclude;
}>;

type TaskWithRuntimeStatus = TaskListItem & {
  computedStatus: TaskComputedStatus;
};

type MyDayTask = Task & {
  computedStatus: TaskComputedStatus;
};

type TaskListResult = {
  items: TaskWithRuntimeStatus[];
  total: number;
  page: number;
  limit: number;
};

type MyDayResult = {
  today: MyDayTask[];
  overdue: MyDayTask[];
  critical: MyDayTask[];
};

type TaskWithAssigneeManager = Task & {
  assignee: {
    managerId: string | null;
  };
};

type EscalatedTask = {
  managerId: string;
  taskTitle: string;
  dueDate: Date;
};

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
  ) {}

  async create(dto: CreateTaskDto, user: CurrentUser): Promise<Task> {
    await this.assertRelatedRecordAccess(dto.relatedType, dto.relatedId, user);

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
        createdById: user.id,
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

    // computedStatus зависит от "сейчас", поэтому колонку надо освежить
    // батчем ДО запроса — иначе фильтр по computedStatus в БД даст устаревшие строки
    await this.syncOpenTaskStatuses(where.assigneeId);

    const whereWithComputedStatus: Prisma.TaskWhereInput = {
      ...where,
      computedStatus: filterDto.computedStatus,
    };

    const [tasks, total] = await this.prisma.$transaction([
      this.prisma.task.findMany({
        where: whereWithComputedStatus,
        include: taskListInclude,
        orderBy: { dueDate: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.task.count({ where: whereWithComputedStatus }),
    ]);

    return {
      items: tasks,
      total,
      page,
      limit,
    };
  }

  async findOne(id: string, currentUserId: string, permissions: string[]) {
    const task = await this.prisma.task.findUnique({
      where: { id },
      include: {
        assignee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
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
          where: { userId: currentUserId },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!task) {
      throw new NotFoundException('Task not found');
    }

    this.assertTaskAccess(task, currentUserId, permissions);

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

    const { freshStatuses } = await this.persistComputedStatuses(tasks);

    const enrichedTasks = tasks.map((task) => {
      const { assignee: _assignee, ...taskWithoutAssignee } = task;
      void _assignee;

      return {
        ...taskWithoutAssignee,
        computedStatus:
          freshStatuses.get(task.id) ??
          calculateComputedStatus(task.dueDate, task.status),
      };
    });

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
    user: CurrentUser,
  ): Promise<Task> {
    const result = dto.result.trim();

    if (!result) {
      throw new BadRequestException('result is required to complete task');
    }

    const task = await this.ensureTaskExists(id);
    this.assertTaskAccess(task, user.id, user.permissions);

    if (dto.createNextTask) {
      await this.assertRelatedRecordAccess(
        dto.createNextTask.relatedType,
        dto.createNextTask.relatedId,
        user,
      );
    }

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
            createdById: user.id,
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
    user: CurrentUser,
  ): Promise<Task> {
    const reason = dto.reason.trim();

    if (!reason) {
      throw new BadRequestException('reason is required to reschedule task');
    }

    const task = await this.ensureTaskExists(id);
    this.assertTaskAccess(task, user.id, user.permissions);
    const computedStatus = calculateComputedStatus(dto.newDueDate, task.status);

    return this.prisma.$transaction(async (tx) => {
      await tx.taskRescheduleHistory.create({
        data: {
          taskId: id,
          oldDueDate: task.dueDate,
          newDueDate: dto.newDueDate,
          reason,
          authorId: user.id,
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

  async cancel(id: string, user: CurrentUser): Promise<Task> {
    const task = await this.ensureTaskExists(id);
    this.assertTaskAccess(task, user.id, user.permissions);

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

    const { createdNotifications, escalated } =
      await this.persistComputedStatuses(tasks);

    await this.sendEscalationEmails(escalated);

    return createdNotifications;
  }

  // Fire-and-forget: SMTP-ошибки не должны влиять на эскалацию
  private async sendEscalationEmails(
    escalated: EscalatedTask[],
  ): Promise<void> {
    if (escalated.length === 0) {
      return;
    }

    const managerIds = [...new Set(escalated.map((entry) => entry.managerId))];
    const managers = await this.prisma.user.findMany({
      where: { id: { in: managerIds }, isActive: true },
      select: { id: true, email: true, firstName: true, lastName: true },
    });
    const emailByManagerId = new Map(
      managers.map((manager) => [manager.id, manager.email]),
    );

    for (const entry of escalated) {
      const email = emailByManagerId.get(entry.managerId);

      if (!email) {
        continue;
      }

      this.notificationService.sendEmail({
        to: email,
        subject: 'Критическая просрочка задачи',
        text: `Задача "${entry.taskTitle}" просрочена более чем на 24 часа (дедлайн: ${entry.dueDate.toISOString()}). Требуется вмешательство руководителя.`,
      });
    }
  }

  private buildTaskWhere(
    filterDto: FilterTaskDto,
    currentUserId: string,
    permissions: string[],
  ): Prisma.TaskWhereInput {
    const canReadAllTasks = permissions.includes(READ_ALL_TASKS_PERMISSION);

    return {
      assigneeId: canReadAllTasks ? filterDto.assigneeId : currentUserId,
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

  // Освежает computedStatus всех открытых задач в скоупе и батчем создаёт
  // нотификации о критическом просроче — O(1) запросов вместо O(3 × N задач)
  private async syncOpenTaskStatuses(
    assigneeScope: Prisma.TaskWhereInput['assigneeId'],
  ): Promise<void> {
    const openTasks = await this.prisma.task.findMany({
      where: {
        assigneeId: assigneeScope,
        status: {
          notIn: [TaskStatus.COMPLETED, TaskStatus.CANCELLED],
        },
      },
      include: {
        assignee: {
          select: { managerId: true },
        },
      },
    });

    await this.persistComputedStatuses(openTasks);
  }

  private async persistComputedStatuses(
    tasks: TaskWithAssigneeManager[],
  ): Promise<{
    createdNotifications: number;
    freshStatuses: Map<string, TaskComputedStatus>;
    escalated: EscalatedTask[];
  }> {
    const freshStatuses = new Map<string, TaskComputedStatus>();
    const statusBuckets = new Map<TaskComputedStatus, string[]>();
    const criticalTasks: TaskWithAssigneeManager[] = [];

    for (const task of tasks) {
      const computedStatus = calculateComputedStatus(task.dueDate, task.status);
      freshStatuses.set(task.id, computedStatus);

      if (computedStatus !== task.computedStatus) {
        const bucket = statusBuckets.get(computedStatus) ?? [];
        bucket.push(task.id);
        statusBuckets.set(computedStatus, bucket);
      }

      if (
        computedStatus === TaskComputedStatus.CRITICAL_OVERDUE &&
        task.assignee.managerId
      ) {
        criticalTasks.push(task);
      }
    }

    const writes: Prisma.PrismaPromise<unknown>[] = Array.from(
      statusBuckets,
      ([computedStatus, ids]) =>
        this.prisma.task.updateMany({
          where: { id: { in: ids } },
          data: { computedStatus },
        }),
    );

    let createdNotifications = 0;
    const escalated: EscalatedTask[] = [];

    if (criticalTasks.length > 0) {
      // Уникального констрейнта (taskId, userId, type) нет,
      // поэтому дедупликация — через предварительный findMany
      const existing = await this.prisma.notification.findMany({
        where: {
          type: CRITICAL_OVERDUE_NOTIFICATION_TYPE,
          taskId: { in: criticalTasks.map((task) => task.id) },
        },
        select: { taskId: true, userId: true },
      });
      const existingKeys = new Set(
        existing.map((entry) => `${entry.taskId}:${entry.userId}`),
      );
      const notifications = criticalTasks
        .filter(
          (task) => !existingKeys.has(`${task.id}:${task.assignee.managerId}`),
        )
        .map((task) => ({
          userId: task.assignee.managerId as string,
          taskId: task.id,
          type: CRITICAL_OVERDUE_NOTIFICATION_TYPE,
          title: 'Critical task overdue',
          message: `Task is critically overdue: ${task.title}`,
          relatedType: task.relatedType,
          relatedId: task.relatedId,
        }));

      if (notifications.length > 0) {
        writes.push(
          this.prisma.notification.createMany({ data: notifications }),
        );
        createdNotifications = notifications.length;

        for (const task of criticalTasks) {
          const managerId = task.assignee.managerId;

          if (managerId && !existingKeys.has(`${task.id}:${managerId}`)) {
            escalated.push({
              managerId,
              taskTitle: task.title,
              dueDate: task.dueDate,
            });
          }
        }
      }
    }

    if (writes.length > 0) {
      await this.prisma.$transaction(writes);
    }

    return { createdNotifications, freshStatuses, escalated };
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

  private async assertRelatedRecordAccess(
    relatedType: string,
    relatedId: string,
    user: CurrentUser,
  ): Promise<void> {
    switch (relatedType) {
      case 'Lead': {
        const lead = await this.prisma.lead.findFirst({
          where: { id: relatedId, deletedAt: null },
          select: { id: true, ownerId: true },
        });

        if (!lead) {
          throw new NotFoundException('Related lead not found');
        }

        const allowed = await canAccessLeadRecord(
          this.prisma,
          lead,
          user.id,
          user.permissions,
        );
        if (allowed) {
          return;
        }

        throw new ForbiddenException('Access to related lead is forbidden');
      }
      case 'Deal': {
        const deal = await this.prisma.deal.findFirst({
          where: { id: relatedId, deletedAt: null },
          select: { ownerId: true },
        });

        if (!deal) {
          throw new NotFoundException('Related deal not found');
        }

        if (
          user.permissions.includes('deals:read_all') ||
          deal.ownerId === user.id
        ) {
          return;
        }

        throw new ForbiddenException('Access to related deal is forbidden');
      }
      case 'Client': {
        const client = await this.prisma.client.findFirst({
          where: { id: relatedId, deletedAt: null },
          select: { ownerId: true },
        });

        if (!client) {
          throw new NotFoundException('Related client not found');
        }

        if (
          user.permissions.includes('clients:read_all') ||
          client.ownerId === user.id
        ) {
          return;
        }

        throw new ForbiddenException('Access to related client is forbidden');
      }
      case 'Order': {
        const order = await this.prisma.order.findFirst({
          where: { id: relatedId, deletedAt: null },
          select: { deal: { select: { ownerId: true } } },
        });

        if (!order) {
          throw new NotFoundException('Related order not found');
        }

        if (
          user.permissions.includes('deals:read_all') ||
          order.deal.ownerId === user.id
        ) {
          return;
        }

        throw new ForbiddenException('Access to related order is forbidden');
      }
      default:
        return;
    }
  }

  private assertTaskAccess(
    task: Pick<Task, 'assigneeId' | 'createdById'>,
    currentUserId: string,
    permissions: string[],
  ): void {
    if (permissions.includes(READ_ALL_TASKS_PERMISSION)) {
      return;
    }

    if (
      task.assigneeId === currentUserId ||
      task.createdById === currentUserId
    ) {
      return;
    }

    throw new ForbiddenException('Access to this task is forbidden');
  }

  private async ensureTaskExists(id: string): Promise<Task> {
    const task = await this.prisma.task.findUnique({ where: { id } });

    if (!task) {
      throw new NotFoundException('Task not found');
    }

    return task;
  }
}
