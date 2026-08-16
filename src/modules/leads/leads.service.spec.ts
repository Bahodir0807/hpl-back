import { ForbiddenException } from '@nestjs/common';
import { LeadStatus } from '@prisma/client';
import { LeadsService } from './leads.service';

describe('LeadsService authorization', () => {
  const prisma = {
    lead: {
      findFirst: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
    },
    leadAssignmentHistory: {
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const ownedLead = {
    id: 'lead-id',
    ownerId: 'owner-id',
    status: LeadStatus.NEW,
    deletedAt: null,
  };

  let service: LeadsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new LeadsService(prisma as never);
    prisma.lead.findFirst.mockResolvedValue(ownedLead);
  });

  it('rejects create-time ownerId assignment without leads:assign', async () => {
    await expect(
      service.create(
        {
          title: 'Foreign lead',
          source: 'web',
          ownerId: 'other-manager',
        },
        'manager-id',
        ['leads:create'],
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects assign when the caller cannot access the lead', async () => {
    await expect(
      service.assign('lead-id', { newOwnerId: 'new-owner' }, 'stranger-id', [
        'leads:assign',
      ]),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows the owner to assign their lead', async () => {
    prisma.lead.findUniqueOrThrow.mockResolvedValue(ownedLead);
    prisma.$transaction.mockImplementation(
      (fn: (tx: typeof prisma) => unknown) => fn(prisma),
    );
    prisma.lead.update.mockResolvedValue({
      ...ownedLead,
      ownerId: 'new-owner',
    });

    await service.assign('lead-id', { newOwnerId: 'new-owner' }, 'owner-id', [
      'leads:assign',
    ]);

    expect(prisma.lead.update).toHaveBeenCalled();
  });

  it('allows a privileged user with leads:read_all to read another manager lead', async () => {
    prisma.lead.findFirst.mockResolvedValue({
      ...ownedLead,
      assignmentHistory: [],
    });

    await expect(
      service.findOne('lead-id', 'head-id', ['leads:read', 'leads:read_all']),
    ).resolves.toEqual(
      expect.objectContaining({
        id: 'lead-id',
      }),
    );
  });
});
