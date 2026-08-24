import { HttpStatus } from '@nestjs/common';
import { LeadStatus, RoleName } from '@prisma/client';
import type { CurrentUser } from '../../common/interfaces/current-user.interface';
import { LeadManagerCommercialNoteService } from './lead-manager-commercial-note.service';
import {
  MANAGER_COMMERCIAL_HANDOFF_NOTIFICATION_TYPE,
  MANAGER_COMMERCIAL_HANDOFF_TITLE,
} from './lead.constants';

describe('LeadManagerCommercialNoteService', () => {
  const manager: CurrentUser = {
    id: 'manager-id',
    email: 'manager@test.com',
    teamId: null,
    managerId: null,
    roles: [RoleName.MANAGER],
    permissions: [
      'leads:read',
      'leads:update',
      'leads:qualify',
      'quotes:client_accept',
    ],
  };

  const head: CurrentUser = {
    id: 'head-id',
    email: 'head@test.com',
    teamId: null,
    managerId: null,
    roles: [RoleName.HEAD],
    permissions: [
      'leads:read',
      'leads:read_all',
      'leads:update',
      'leads:qualify',
      'leads:commercial_qualify',
      'quotes:approve',
    ],
  };

  const director: CurrentUser = {
    id: 'director-id',
    email: 'director@test.com',
    teamId: null,
    managerId: null,
    roles: [RoleName.DIRECTOR],
    permissions: ['leads:read', 'leads:read_all', 'quotes:read_all'],
  };

  const admin: CurrentUser = {
    id: 'admin-id',
    email: 'admin@test.com',
    teamId: null,
    managerId: null,
    roles: [RoleName.ADMIN],
    permissions: ['users:manage', 'admin:queues'],
  };

  const prisma = {
    lead: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    activity: { create: jest.fn() },
    auditLog: { create: jest.fn() },
    user: { findMany: jest.fn() },
    notification: { createMany: jest.fn() },
    panelQuote: { update: jest.fn(), findMany: jest.fn() },
    $transaction: jest.fn(),
  };

  const qualifiedLead = {
    id: 'lead-id',
    title: 'Фасад школы',
    status: LeadStatus.QUALIFIED,
    ownerId: 'manager-id',
    dealId: null,
    deletedAt: null,
    managerCommercialNote: null,
    managerCommercialNoteUpdatedAt: null,
    managerCommercialInputReadyAt: null,
    managerCommercialInputReadyById: null,
    client: { id: 'client-id', name: 'ООО Фасад' },
    projectObject: { id: 'object-id', name: 'Школа №12' },
  };

  let service: LeadManagerCommercialNoteService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new LeadManagerCommercialNoteService(prisma as never);
    prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof prisma) => unknown) => callback(prisma),
    );
    prisma.lead.findFirst.mockResolvedValue(qualifiedLead);
    prisma.lead.update.mockImplementation(
      async ({ data }: { data: object }) => ({
        ...qualifiedLead,
        ...data,
      }),
    );
    prisma.activity.create.mockResolvedValue({});
    prisma.auditLog.create.mockResolvedValue({});
    prisma.user.findMany.mockResolvedValue([{ id: 'head-id' }]);
    prisma.notification.createMany.mockResolvedValue({ count: 1 });
  });

  it('lets MANAGER create the customer note', async () => {
    const result = await service.updateNote(
      'lead-id',
      { commercialNote: 'Пожелания клиента: CIP Tashkent' },
      manager,
    );

    expect(result.commercialNote).toBe('Пожелания клиента: CIP Tashkent');
    expect(prisma.lead.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          managerCommercialNote: 'Пожелания клиента: CIP Tashkent',
        }),
      }),
    );
    expect(prisma.panelQuote.update).not.toHaveBeenCalled();
  });

  it('lets MANAGER update the note in an allowed state', async () => {
    prisma.lead.findFirst.mockResolvedValue({
      ...qualifiedLead,
      managerCommercialNote: 'Draft',
    });

    const result = await service.updateNote(
      'lead-id',
      { commercialNote: 'Updated wishes' },
      manager,
    );

    expect(result.commercialNote).toBe('Updated wishes');
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'LEAD_MANAGER_COMMERCIAL_NOTE_SAVED',
        }),
      }),
    );
  });

  it('forbids HEAD from mutating the Manager note', async () => {
    await expect(
      service.updateNote('lead-id', { commercialNote: 'HEAD note' }, head),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        errorCode: 'MANAGER_COMMERCIAL_NOTE_FORBIDDEN',
        statusCode: HttpStatus.FORBIDDEN,
      }),
    });
    expect(prisma.lead.update).not.toHaveBeenCalled();
  });

  it('returns 403 for a crafted HEAD note update', async () => {
    await expect(
      service.updateNote(
        'lead-id',
        { commercialNote: 'crafted' } as never,
        head,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        statusCode: 403,
        errorCode: 'MANAGER_COMMERCIAL_NOTE_FORBIDDEN',
      }),
    });
  });

  it('lets MANAGER hand off to HEAD', async () => {
    const result = await service.handoffToHead('lead-id', manager);

    expect(result.managerCommercialInputReadyById).toBe('manager-id');
    expect(result.managerCommercialInputReadyAt).toBeInstanceOf(Date);
    expect(prisma.notification.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          userId: 'head-id',
          title: MANAGER_COMMERCIAL_HANDOFF_TITLE,
          type: MANAGER_COMMERCIAL_HANDOFF_NOTIFICATION_TYPE,
          relatedType: 'Lead',
          relatedId: 'lead-id',
          message: expect.stringContaining('ООО Фасад'),
        }),
      ],
    });
    expect(
      prisma.notification.createMany.mock.calls[0][0].data[0].message,
    ).toContain('Школа №12');
  });

  it('forbids HEAD, DIRECTOR and ADMIN-only from triggering handoff', async () => {
    await expect(service.handoffToHead('lead-id', head)).rejects.toMatchObject({
      response: expect.objectContaining({
        errorCode: 'MANAGER_COMMERCIAL_NOTE_FORBIDDEN',
        statusCode: 403,
      }),
    });
    await expect(
      service.handoffToHead('lead-id', director),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        statusCode: 403,
      }),
    });
    await expect(service.handoffToHead('lead-id', admin)).rejects.toMatchObject(
      {
        response: expect.objectContaining({
          statusCode: 403,
        }),
      },
    );
    expect(prisma.notification.createMany).not.toHaveBeenCalled();
  });

  it('does not rewrite existing Quotes when the source note later changes', async () => {
    prisma.lead.findFirst.mockResolvedValue({
      ...qualifiedLead,
      managerCommercialNote: 'Original',
      managerCommercialInputReadyAt: new Date('2026-08-20T10:00:00.000Z'),
    });

    await service.updateNote(
      'lead-id',
      { commercialNote: 'Later change' },
      manager,
    );

    expect(prisma.panelQuote.update).not.toHaveBeenCalled();
    expect(prisma.lead.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          managerCommercialNote: 'Later change',
        }),
      }),
    );
  });

  it('is idempotent when Manager already handed off', async () => {
    const readyAt = new Date('2026-08-20T09:00:00.000Z');
    prisma.lead.findFirst.mockResolvedValue({
      ...qualifiedLead,
      managerCommercialInputReadyAt: readyAt,
      managerCommercialInputReadyById: 'manager-id',
    });

    const result = await service.handoffToHead('lead-id', manager);

    expect(result.managerCommercialInputReadyAt).toEqual(readyAt);
    expect(prisma.lead.update).not.toHaveBeenCalled();
    expect(prisma.notification.createMany).not.toHaveBeenCalled();
  });
});
