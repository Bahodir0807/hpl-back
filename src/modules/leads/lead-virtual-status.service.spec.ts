import { ActivityType, LeadStatus } from '@prisma/client';
import { LeadVirtualStatusService } from './lead-virtual-status.service';

describe('LeadVirtualStatusService', () => {
  let service: LeadVirtualStatusService;

  const prisma = {
    lead: { findFirst: jest.fn() },
    activity: { findMany: jest.fn() },
    telegramLeadMetadata: { findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
    leadCommercialQualification: { findUnique: jest.fn() },
  };

  const configService = {
    get: jest.fn(() => 'lead-pool@hpl.com'),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new LeadVirtualStatusService(
      prisma as never,
      configService as never,
    );
    prisma.user.findUnique.mockResolvedValue({ id: 'pool-user-id' });
  });

  it('returns pending_admin for unassigned telegram lead', async () => {
    prisma.lead.findFirst.mockResolvedValue({
      id: 'lead-id',
      status: LeadStatus.NEW,
      source: 'telegram',
      ownerId: 'pool-user-id',
    });
    prisma.activity.findMany.mockResolvedValue([]);
    prisma.telegramLeadMetadata.findUnique.mockResolvedValue({
      isPendingAssignment: true,
    });

    await expect(service.getStatus('lead-id')).resolves.toBe('pending_admin');
  });

  it('returns calculator_used when calculation activity exists', async () => {
    prisma.lead.findFirst.mockResolvedValue({
      id: 'lead-id',
      status: LeadStatus.IN_PROGRESS,
      source: 'manual',
      ownerId: 'manager-id',
    });
    prisma.activity.findMany.mockResolvedValue([
      { type: ActivityType.CALCULATION, metadata: {} },
    ]);
    prisma.telegramLeadMetadata.findUnique.mockResolvedValue(null);

    await expect(service.getStatus('lead-id')).resolves.toBe('calculator_used');
  });

  it('returns qualified for Stage-1 qualified leads', async () => {
    prisma.lead.findFirst.mockResolvedValue({
      id: 'lead-id',
      status: LeadStatus.QUALIFIED,
      source: 'manual',
      ownerId: 'manager-id',
    });
    prisma.leadCommercialQualification.findUnique.mockResolvedValue(null);
    prisma.activity.findMany.mockResolvedValue([
      { type: ActivityType.CALL, metadata: {} },
    ]);
    prisma.telegramLeadMetadata.findUnique.mockResolvedValue(null);

    await expect(service.getStatus('lead-id')).resolves.toBe('qualified');
  });

  it('returns commercially_qualified after Stage-2 confirmation', async () => {
    prisma.lead.findFirst.mockResolvedValue({
      id: 'lead-id',
      status: LeadStatus.QUALIFIED,
      source: 'manual',
      ownerId: 'manager-id',
    });
    prisma.leadCommercialQualification.findUnique.mockResolvedValue({
      status: 'CONFIRMED',
    });

    await expect(service.getStatus('lead-id')).resolves.toBe(
      'commercially_qualified',
    );
  });
});
