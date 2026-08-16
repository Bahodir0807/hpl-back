import { ForbiddenException } from '@nestjs/common';
import { RoleName, TaskStatus } from '@prisma/client';
import type { CurrentUser } from '../../common/interfaces/current-user.interface';
import { TasksService } from './tasks.service';

describe('TasksService authorization', () => {
  const prisma = {
    task: {
      findUnique: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    lead: { findFirst: jest.fn() },
    deal: { findFirst: jest.fn() },
    client: { findFirst: jest.fn() },
    order: { findFirst: jest.fn() },
    $transaction: jest.fn(),
  };
  const notificationService = { sendEmail: jest.fn() };

  const owner: CurrentUser = {
    id: 'owner-id',
    email: 'owner@test.com',
    teamId: null,
    managerId: null,
    roles: [RoleName.MANAGER],
    permissions: ['tasks:read', 'tasks:update', 'tasks:delete'],
  };

  const stranger: CurrentUser = {
    ...owner,
    id: 'stranger-id',
    email: 'stranger@test.com',
  };

  const privileged: CurrentUser = {
    id: 'head-id',
    email: 'head@test.com',
    teamId: null,
    managerId: null,
    roles: [RoleName.HEAD],
    permissions: [
      'tasks:read',
      'tasks:read_all',
      'tasks:update',
      'tasks:delete',
    ],
  };

  const ownedTask = {
    id: 'task-id',
    assigneeId: owner.id,
    createdById: owner.id,
    status: TaskStatus.PENDING,
    dueDate: new Date('2026-08-17T10:00:00.000Z'),
  };

  let service: TasksService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TasksService(prisma as never, notificationService as never);
    prisma.task.findUnique.mockResolvedValue(ownedTask);
    prisma.task.update.mockResolvedValue(ownedTask);
    prisma.$transaction.mockImplementation(
      (fn: (tx: typeof prisma) => unknown) => fn(prisma),
    );
  });

  it('rejects complete when the caller cannot access the task', async () => {
    await expect(
      service.complete('task-id', { result: 'done' }, stranger),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows the assignee to complete their task', async () => {
    await service.complete('task-id', { result: 'done' }, owner);

    expect(prisma.task.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'task-id' },
      }),
    );
  });

  it('allows a privileged role with tasks:read_all to cancel another user task', async () => {
    await service.cancel('task-id', privileged);

    expect(prisma.task.update).toHaveBeenCalled();
  });

  it('rejects cancel when the caller has no object access', async () => {
    await expect(service.cancel('task-id', stranger)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
