/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  EngineeringAssignmentStatus,
  LeadStatus,
  RoleName,
} from '@prisma/client';
import { BusinessException } from '../../../common/exceptions/business.exception';
import type { CurrentUser } from '../../../common/interfaces/current-user.interface';
import { ROLE_PERMISSION_SLUGS } from '../../../auth/rbac/permission-matrix';
import { LeadEngineeringService } from './lead-engineering.service';

function errorCode(error: unknown): string | undefined {
  if (error instanceof BusinessException) {
    const response = error.getResponse();
    if (typeof response === 'object' && response && 'errorCode' in response) {
      return String(response.errorCode);
    }
  }
  return undefined;
}

async function expectBusinessCode(
  promise: Promise<unknown>,
  code: string,
): Promise<void> {
  try {
    await promise;
    throw new Error(`Expected BusinessException ${code}`);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith('Expected BusinessException')
    ) {
      throw error;
    }
    expect(errorCode(error)).toBe(code);
  }
}

describe('LeadEngineeringService', () => {
  const prisma = {
    user: { findMany: jest.fn(), findFirst: jest.fn() },
    lead: { findFirst: jest.fn() },
    leadEngineeringAssignment: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    activity: { findMany: jest.fn(), create: jest.fn() },
    auditLog: { create: jest.fn() },
    notification: { create: jest.fn() },
    task: { findFirst: jest.fn(), create: jest.fn() },
    file: { findMany: jest.fn() },
    $executeRaw: jest.fn(),
    $transaction: jest.fn(),
  };

  const qualificationService = {
    upsert: jest.fn(),
  };

  const manager: CurrentUser = {
    id: 'manager-1',
    email: 'manager@test.com',
    teamId: null,
    managerId: null,
    roles: [RoleName.MANAGER],
    permissions: [...ROLE_PERMISSION_SLUGS[RoleName.MANAGER]],
  };

  const engineer: CurrentUser = {
    id: 'engineer-1',
    email: 'engineer@test.com',
    teamId: null,
    managerId: null,
    roles: [RoleName.ENGINEER],
    permissions: [...ROLE_PERMISSION_SLUGS[RoleName.ENGINEER]],
  };

  const otherEngineer: CurrentUser = {
    id: 'engineer-2',
    email: 'engineer2@test.com',
    teamId: null,
    managerId: null,
    roles: [RoleName.ENGINEER],
    permissions: [...ROLE_PERMISSION_SLUGS[RoleName.ENGINEER]],
  };

  const leadBase = {
    id: 'lead-1',
    title: 'Facade job',
    status: LeadStatus.QUALIFIED,
    ownerId: manager.id,
    clientId: 'client-1',
    dealId: 'deal-1',
    needDescription: 'Need HPL + kit',
    decisionMakerContact: 'Ivan',
    managerCommercialNote: 'secret price',
    client: {
      id: 'client-1',
      name: 'Client',
      phone: '+998',
      email: null,
      contacts: [],
    },
    contact: null,
    projectObject: { id: 'obj-1', name: 'Building', address: 'Tashkent' },
    owner: {
      id: manager.id,
      firstName: 'Elena',
      lastName: 'Kozlova',
      email: manager.email,
    },
    qualification: {
      installationRequired: true,
      ventFacadeKitRequired: false,
    },
  };

  const assignmentView = {
    id: 'assignment-1',
    leadId: 'lead-1',
    engineerId: engineer.id,
    assignedById: manager.id,
    status: EngineeringAssignmentStatus.ACTIVE,
    activeLeadId: 'lead-1',
    returnReason: null,
    assignedAt: new Date('2026-09-19T10:00:00.000Z'),
    returnedAt: null,
    returnedById: null,
    completedAt: null,
    completedById: null,
    supersededAt: null,
    engineer: {
      id: engineer.id,
      firstName: 'Andrey',
      lastName: 'Sokolov',
      email: engineer.email,
    },
    assignedBy: {
      id: manager.id,
      firstName: 'Elena',
      lastName: 'Kozlova',
      email: manager.email,
    },
    returnedBy: null,
    completedBy: null,
    primaryQualificationCompletedAt: null,
    primaryQualificationCompletedById: null,
    primaryQualificationCompletedBy: null,
  };

  let service: LeadEngineeringService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(async (arg: unknown) => {
      if (typeof arg === 'function') {
        return (arg as (tx: typeof prisma) => unknown)(prisma);
      }
      if (Array.isArray(arg)) {
        return Promise.all(arg as Promise<unknown>[]);
      }
      return arg;
    });
    prisma.notification.create.mockResolvedValue({ id: 'n1' });
    prisma.activity.create.mockResolvedValue({ id: 'a1' });
    prisma.auditLog.create.mockResolvedValue({ id: 'l1' });
    prisma.task.findFirst.mockResolvedValue(null);
    prisma.task.create.mockResolvedValue({ id: 'task-1' });
    prisma.$executeRaw.mockResolvedValue(1);
    service = new LeadEngineeringService(
      prisma as never,
      qualificationService as never,
    );
  });

  function mockLead(overrides: Partial<typeof leadBase> = {}) {
    prisma.lead.findFirst.mockResolvedValue({ ...leadBase, ...overrides });
  }

  it('does not restore INSTALLER and keeps ENGINEER in RBAC', () => {
    expect(Object.values(RoleName)).toContain(RoleName.ENGINEER);
    expect(Object.values(RoleName)).not.toContain('INSTALLER');
  });

  it('rejects HPL-only handoff', async () => {
    mockLead({
      qualification: {
        installationRequired: false,
        ventFacadeKitRequired: false,
      },
    });

    await expectBusinessCode(
      service.assign('lead-1', { engineerId: engineer.id }, manager),
      'ENGINEERING_NOT_REQUIRED',
    );
    expect(prisma.leadEngineeringAssignment.create).not.toHaveBeenCalled();
  });

  it.each([
    { installationRequired: false, ventFacadeKitRequired: true },
    { installationRequired: true, ventFacadeKitRequired: false },
    { installationRequired: true, ventFacadeKitRequired: true },
  ])(
    'allows a single assignment when engineer is required %j',
    async (qualification) => {
      mockLead({ qualification });
      prisma.user.findFirst.mockResolvedValue({ id: engineer.id });
      prisma.leadEngineeringAssignment.findFirst.mockResolvedValue(null);
      prisma.leadEngineeringAssignment.create.mockResolvedValue(assignmentView);

      const result = await service.assign(
        'lead-1',
        { engineerId: engineer.id },
        manager,
      );

      expect(result.ownerId).toBe(manager.id);
      expect(result.created).toBe(true);
      expect(prisma.leadEngineeringAssignment.create).toHaveBeenCalledTimes(1);
      expect(prisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: engineer.id,
            relatedType: 'Lead',
            relatedId: 'lead-1',
          }),
        }),
      );
    },
  );

  it('keeps Lead.ownerId unchanged and does not duplicate an active assignment', async () => {
    mockLead();
    prisma.user.findFirst.mockResolvedValue({ id: engineer.id });
    prisma.leadEngineeringAssignment.findFirst.mockResolvedValue(
      assignmentView,
    );

    const result = await service.assign(
      'lead-1',
      { engineerId: engineer.id },
      manager,
    );

    expect(result.ownerId).toBe(manager.id);
    expect(result.created).toBe(false);
    expect(prisma.leadEngineeringAssignment.create).not.toHaveBeenCalled();
    expect(prisma.notification.create).not.toHaveBeenCalled();
  });

  it('replaces the previous engineer and leaves history', async () => {
    mockLead();
    prisma.user.findFirst.mockResolvedValue({ id: otherEngineer.id });
    prisma.leadEngineeringAssignment.findFirst.mockResolvedValue(
      assignmentView,
    );
    prisma.leadEngineeringAssignment.update.mockResolvedValue({
      ...assignmentView,
      status: EngineeringAssignmentStatus.SUPERSEDED,
      activeLeadId: null,
    });
    prisma.leadEngineeringAssignment.create.mockResolvedValue({
      ...assignmentView,
      id: 'assignment-2',
      engineerId: otherEngineer.id,
      engineer: {
        id: otherEngineer.id,
        firstName: 'Ivan',
        lastName: 'Petrov',
        email: otherEngineer.email,
      },
    });

    const result = await service.assign(
      'lead-1',
      { engineerId: otherEngineer.id },
      manager,
    );

    expect(result.ownerId).toBe(manager.id);
    expect(prisma.leadEngineeringAssignment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: EngineeringAssignmentStatus.SUPERSEDED,
          activeLeadId: null,
        }),
      }),
    );
    expect(prisma.leadEngineeringAssignment.create).toHaveBeenCalledTimes(1);
  });

  it('rejects assign for converted or lost leads', async () => {
    mockLead({ status: LeadStatus.LOST });
    await expectBusinessCode(
      service.assign('lead-1', { engineerId: engineer.id }, manager),
      'ENGINEERING_LEAD_NOT_ASSIGNABLE',
    );
  });

  it('rejects a non-ENGINEER assignee', async () => {
    mockLead();
    prisma.user.findFirst.mockResolvedValue(null);
    await expectBusinessCode(
      service.assign('lead-1', { engineerId: 'manager-1' }, manager),
      'ENGINEER_NOT_FOUND',
    );
  });

  it('lets the assigned engineer read the workspace without commercial note', async () => {
    mockLead();
    prisma.leadEngineeringAssignment.findFirst
      .mockResolvedValueOnce(assignmentView)
      .mockResolvedValueOnce(assignmentView);
    prisma.activity.findMany.mockResolvedValue([]);
    prisma.file.findMany.mockResolvedValue([]);

    const workspace = await service.getWorkspace('lead-1', engineer);

    expect(workspace.lead.id).toBe('lead-1');
    expect(workspace.lead).not.toHaveProperty('managerCommercialNote');
    expect(workspace.lead.needDescription).toBe('Need HPL + kit');
  });

  it('denies another engineer access to a foreign lead', async () => {
    mockLead();
    prisma.leadEngineeringAssignment.findFirst.mockResolvedValue(null);

    await expectBusinessCode(
      service.getWorkspace('lead-1', otherEngineer),
      'FORBIDDEN',
    );
  });

  it('returns the lead to the manager without deleting qualification or deal', async () => {
    mockLead();
    prisma.leadEngineeringAssignment.findFirst.mockResolvedValue(
      assignmentView,
    );
    prisma.leadEngineeringAssignment.update.mockResolvedValue({
      ...assignmentView,
      status: EngineeringAssignmentStatus.RETURNED,
      activeLeadId: null,
      returnReason: 'Need object photos',
      returnedById: engineer.id,
    });

    const result = await service.returnToManager(
      'lead-1',
      { reason: 'Need object photos' },
      engineer,
    );

    expect(result.ownerId).toBe(manager.id);
    expect(result.qualificationPreserved).toBe(true);
    expect(result.dealId).toBe('deal-1');
    expect(prisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: manager.id }),
      }),
    );
  });

  it('allows a second handoff after return', async () => {
    mockLead();
    prisma.user.findFirst.mockResolvedValue({ id: engineer.id });
    prisma.leadEngineeringAssignment.findFirst.mockResolvedValue(null);
    prisma.leadEngineeringAssignment.create.mockResolvedValue(assignmentView);

    const result = await service.assign(
      'lead-1',
      { engineerId: engineer.id },
      manager,
    );

    expect(result.created).toBe(true);
    expect(result.ownerId).toBe(manager.id);
  });

  it('completes primary qualification without closing assignment access or creating a Quote', async () => {
    mockLead();
    prisma.leadEngineeringAssignment.findFirst.mockResolvedValue(
      assignmentView,
    );
    prisma.leadEngineeringAssignment.update.mockResolvedValue({
      ...assignmentView,
      primaryQualificationCompletedAt: new Date(),
      primaryQualificationCompletedById: engineer.id,
    });

    const result = await service.complete('lead-1', engineer);

    expect(result.quoteCreated).toBe(false);
    expect(result.priceApproved).toBe(false);
    expect(result.accessRetained).toBe(true);
    expect(result.ownerId).toBe(manager.id);
    expect(prisma.leadEngineeringAssignment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          primaryQualificationCompletedById: engineer.id,
        }),
      }),
    );
    const updateData = prisma.leadEngineeringAssignment.update.mock.calls[0][0]
      .data as Record<string, unknown>;
    expect(updateData.status).toBeUndefined();
    expect(updateData.activeLeadId).toBeUndefined();
    expect(prisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: manager.id }),
      }),
    );
  });

  it('finishes engineering work and drops calculator access without creating a Quote', async () => {
    mockLead();
    prisma.leadEngineeringAssignment.findFirst.mockResolvedValue(
      assignmentView,
    );
    prisma.leadEngineeringAssignment.update.mockResolvedValue({
      ...assignmentView,
      status: EngineeringAssignmentStatus.COMPLETED,
      activeLeadId: null,
      completedById: engineer.id,
    });

    const result = await service.finish('lead-1', engineer);

    expect(result.quoteCreated).toBe(false);
    expect(result.accessRetained).toBe(false);
    expect(result.ownerId).toBe(manager.id);
    expect(prisma.leadEngineeringAssignment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: EngineeringAssignmentStatus.COMPLETED,
          activeLeadId: null,
        }),
      }),
    );
  });

  it('does not roll back a committed assignment when notification fails', async () => {
    mockLead();
    prisma.user.findFirst.mockResolvedValue({ id: engineer.id });
    prisma.leadEngineeringAssignment.findFirst.mockResolvedValue(null);
    prisma.leadEngineeringAssignment.create.mockResolvedValue(assignmentView);
    prisma.notification.create.mockRejectedValue(new Error('smtp down'));

    const result = await service.assign(
      'lead-1',
      { engineerId: engineer.id },
      manager,
    );

    expect(result.created).toBe(true);
    expect(result.ownerId).toBe(manager.id);
  });

  it('denies return/complete to a superseded engineer', async () => {
    mockLead();
    prisma.leadEngineeringAssignment.findFirst.mockResolvedValue(null);

    await expectBusinessCode(
      service.returnToManager('lead-1', { reason: 'late' }, engineer),
      'ENGINEERING_ASSIGNMENT_REQUIRED',
    );
    await expectBusinessCode(
      service.complete('lead-1', engineer),
      'ENGINEERING_ASSIGNMENT_REQUIRED',
    );
    await expectBusinessCode(
      service.finish('lead-1', engineer),
      'ENGINEERING_ASSIGNMENT_REQUIRED',
    );
  });

  it('does not let an engineer assign themselves through the manager endpoint', async () => {
    mockLead();
    await expectBusinessCode(
      service.assign('lead-1', { engineerId: engineer.id }, engineer),
      'ENGINEERING_ASSIGN_FORBIDDEN',
    );
  });
});

describe('engineering permission isolation', () => {
  it.each([
    'quotes:approve',
    'leads:read_all',
    'leads:assign',
    'leads:commercial_qualify',
    'currency_rates:manage',
    'users:manage',
    'products:read_purchase_price',
    'payments:confirm',
    'admin:queues',
  ] as const)('does not give ENGINEER %s', (slug) => {
    expect(ROLE_PERMISSION_SLUGS[RoleName.ENGINEER]).not.toContain(slug);
  });
});
