import { ForbiddenException } from '@nestjs/common';
import { DealStage, LossReason, RoleName } from '@prisma/client';
import { DealLossService } from './deal-loss.service';

describe('DealLossService', () => {
  const prisma = {
    deal: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      updateMany: jest.fn(),
    },
    dealStageHistory: { create: jest.fn() },
    activity: { create: jest.fn() },
    auditLog: { create: jest.fn() },
    user: { findMany: jest.fn() },
    task: { findMany: jest.fn(), create: jest.fn() },
    $transaction: jest.fn(),
  };
  const policy = {
    canReadDeal: jest.fn(),
    getPermissions: jest.fn(),
  };
  const manager = {
    id: 'manager-id',
    email: 'manager@example.com',
    teamId: null,
    managerId: null,
    roles: [RoleName.MANAGER],
    permissions: ['deals:update'],
  };
  const deal = {
    id: 'deal-id',
    title: 'HPL Deal',
    ownerId: manager.id,
    stage: DealStage.NEGOTIATION,
    lostAt: null,
    deletedAt: null,
  };
  let service: DealLossService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new DealLossService(prisma as never, policy as never);
    prisma.deal.findFirst.mockResolvedValue(deal);
    prisma.deal.updateMany.mockResolvedValue({ count: 1 });
    prisma.deal.findUniqueOrThrow.mockResolvedValue({
      ...deal,
      stage: DealStage.LOST,
    });
    prisma.$transaction.mockImplementation(
      (fn: (tx: typeof prisma) => unknown) => fn(prisma),
    );
    policy.canReadDeal.mockReturnValue(true);
    policy.getPermissions.mockReturnValue({ canChangeStage: true });
    prisma.user.findMany.mockResolvedValue([{ id: 'head-id' }]);
    prisma.task.findMany.mockResolvedValue([]);
    prisma.task.create.mockResolvedValue({ id: 'task-id' });
  });

  it('stores PRICE with server actor/time and creates a HEAD recovery task', async () => {
    await service.lose('deal-id', { reason: LossReason.PRICE }, manager);

    expect(prisma.deal.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lostReasonCode: LossReason.PRICE,
          lostById: manager.id,
          lostAt: expect.any(Date),
        }),
      }),
    );
    expect(prisma.task.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ assigneeId: 'head-id' }),
      }),
    );
  });

  it('stores COMPETITOR without recovery tasks', async () => {
    await service.lose(
      'deal-id',
      { reason: LossReason.COMPETITOR, comment: 'Alternative selected' },
      manager,
    );

    expect(prisma.deal.updateMany).toHaveBeenCalled();
    expect(prisma.task.create).not.toHaveBeenCalled();
  });

  it('requires comment for OTHER', async () => {
    await expect(
      service.lose(
        'deal-id',
        { reason: LossReason.OTHER, comment: ' ' },
        manager,
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('denies a foreign Manager', async () => {
    policy.canReadDeal.mockReturnValue(false);
    await expect(
      service.lose('deal-id', { reason: LossReason.PRICE }, manager),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('is idempotent after a structured loss and creates no duplicate task or audit', async () => {
    prisma.deal.findFirst.mockResolvedValue({
      ...deal,
      stage: DealStage.LOST,
      lostAt: new Date(),
    });

    await service.lose('deal-id', { reason: LossReason.PRICE }, manager);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.task.create).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });
});
