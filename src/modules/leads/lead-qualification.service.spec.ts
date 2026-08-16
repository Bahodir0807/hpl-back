import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { HplApplication } from '@prisma/client';
import { UpsertLeadQualificationDto } from './dto/upsert-lead-qualification.dto';
import { LeadQualificationService } from './lead-qualification.service';

describe('LeadQualificationService', () => {
  const prisma = {
    lead: {
      findFirst: jest.fn(),
    },
    leadQualification: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const ownedLead = {
    id: 'lead-a',
    ownerId: 'manager-a',
    deletedAt: null,
  };

  let service: LeadQualificationService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new LeadQualificationService(prisma as never);
  });

  it('allows an owner to read their qualification', async () => {
    prisma.lead.findFirst.mockResolvedValue(ownedLead);
    prisma.leadQualification.findUnique.mockResolvedValue(null);

    await expect(
      service.get('lead-a', 'manager-a', ['leads:read']),
    ).resolves.toEqual({
      leadId: 'lead-a',
      qualification: null,
      requirementPrefill: null,
    });
  });

  it('allows HEAD/privileged leads:read_all to read another manager lead', async () => {
    prisma.lead.findFirst.mockResolvedValue(ownedLead);
    prisma.leadQualification.findUnique.mockResolvedValue(null);

    await expect(
      service.get('lead-a', 'head-id', ['leads:read', 'leads:read_all']),
    ).resolves.toEqual(
      expect.objectContaining({
        leadId: 'lead-a',
        qualification: null,
      }),
    );
  });

  it('denies Manager A reading Manager B qualification', async () => {
    prisma.lead.findFirst.mockResolvedValue({
      ...ownedLead,
      ownerId: 'manager-b',
    });

    await expect(
      service.get('lead-a', 'manager-a', ['leads:read', 'leads:update']),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('denies Manager A updating Manager B qualification', async () => {
    prisma.lead.findFirst.mockResolvedValue({
      ...ownedLead,
      ownerId: 'manager-b',
    });

    await expect(
      service.upsert(
        'lead-a',
        { application: HplApplication.INTERIOR },
        'manager-a',
        ['leads:update'],
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('returns 404 when the lead is missing', async () => {
    prisma.lead.findFirst.mockResolvedValue(null);

    await expect(
      service.get('missing', 'manager-a', ['leads:read']),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects inactive panel types', async () => {
    const tx = {
      panelType: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'pt',
          code: 'interior',
          isActive: false,
        }),
      },
      leadQualification: { findUnique: jest.fn() },
    };

    const dto = Object.assign(new UpsertLeadQualificationDto(), {
      panelTypeId: 'pt',
    });

    await expect(
      service.upsertInTx(
        tx as never,
        'lead-a',
        dto,
        'manager-a',
        'lead_qualification_updated',
      ),
    ).rejects.toThrow('panelTypeId is invalid or inactive');
  });
});
