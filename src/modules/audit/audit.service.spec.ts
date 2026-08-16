import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import type { CurrentUser } from '../../common/interfaces/current-user.interface';
import { AuditService } from './audit.service';

describe('AuditService authorization', () => {
  const prisma = {
    lead: { findFirst: jest.fn() },
    activity: { findMany: jest.fn() },
  };

  const manager: CurrentUser = {
    id: 'manager-id',
    email: 'manager@test.com',
    teamId: null,
    managerId: null,
    roles: [RoleName.MANAGER],
    permissions: ['audit:read'],
  };

  let service: AuditService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AuditService(prisma as never);
  });

  it('rejects timeline access for a lead the caller does not own', async () => {
    prisma.lead.findFirst.mockResolvedValue({ ownerId: 'other-manager' });

    await expect(
      service.getTimeline('Lead', 'lead-id', manager),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns the timeline for an owned lead', async () => {
    prisma.lead.findFirst.mockResolvedValue({ ownerId: manager.id });
    prisma.activity.findMany.mockResolvedValue([{ id: 'activity-1' }]);

    await expect(
      service.getTimeline('Lead', 'lead-id', manager),
    ).resolves.toEqual([{ id: 'activity-1' }]);
  });

  it('returns 404 for an unknown related type instead of leaking a timeline', async () => {
    await expect(
      service.getTimeline('Unknown', 'id', manager),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
