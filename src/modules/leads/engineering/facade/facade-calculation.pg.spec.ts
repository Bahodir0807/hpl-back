import { Prisma, PrismaClient, RoleName } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { ROLE_PERMISSION_SLUGS } from '../../../../auth/rbac/permission-matrix';
import type { CurrentUser } from '../../../../common/interfaces/current-user.interface';
import { seedFacadeSubsystemCatalog } from '../../../../../prisma/seed/facade-subsystem';
import { FacadeCalculationService } from './facade-calculation.service';
import {
  BASE_FACADE_CONFIG_CODE,
  EXPECTED_QTY_FOR_1000_M2,
} from './facade-norms';

const TEST_URL =
  process.env.FACADE_TEST_DATABASE_URL ??
  'postgresql://crm:crm@localhost:5432/crm_stage2';

const runPg = process.env.FACADE_PG === '1';

const describePg = runPg ? describe : describe.skip;

describePg('FacadeCalculationService PostgreSQL persistence', () => {
  let prisma: PrismaClient;
  let service: FacadeCalculationService;

  beforeAll(async () => {
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: TEST_URL }),
    });
    await prisma.$connect();
    service = new FacadeCalculationService(prisma as never);
    await seedFacadeSubsystemCatalog(prisma);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('persists 18 snapshot lines and does not create Quote or Deal', async () => {
    const suffix = Date.now().toString();
    const manager = await prisma.user.create({
      data: {
        email: `facade-manager-${suffix}@hpl.test`,
        passwordHash: 'x',
        firstName: 'Mgr',
        lastName: 'Test',
      },
    });
    const engineer = await prisma.user.create({
      data: {
        email: `facade-engineer-${suffix}@hpl.test`,
        passwordHash: 'x',
        firstName: 'Eng',
        lastName: 'Test',
      },
    });
    const lead = await prisma.lead.create({
      data: {
        title: `Facade PG ${suffix}`,
        source: 'stage2-pg',
        ownerId: manager.id,
        qualification: {
          create: {
            ventFacadeKitRequired: true,
            installationRequired: true,
            requiredAreaM2: new Prisma.Decimal('80'),
          },
        },
      },
    });
    const assignment = await prisma.leadEngineeringAssignment.create({
      data: {
        leadId: lead.id,
        engineerId: engineer.id,
        assignedById: manager.id,
        status: 'ACTIVE',
        activeLeadId: lead.id,
      },
    });

    const quotesBefore = await prisma.panelQuote.count();
    const dealsBefore = await prisma.deal.count();

    const user: CurrentUser = {
      id: engineer.id,
      email: engineer.email,
      teamId: null,
      managerId: null,
      roles: [RoleName.ENGINEER],
      permissions: [...ROLE_PERMISSION_SLUGS[RoleName.ENGINEER]],
    };

    await service.calculate(
      lead.id,
      {
        configCode: BASE_FACADE_CONFIG_CODE,
        claddingAreaM2: '1000',
        areaSource: 'ENGINEER_ENTERED',
      },
      user,
    );

    const saved = await prisma.facadeSubsystemCalculation.findUniqueOrThrow({
      where: { leadId: lead.id },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });

    expect(saved.items).toHaveLength(18);
    expect(saved.assignmentId).toBe(assignment.id);
    for (const item of saved.items) {
      expect(item.calculatedQty?.toFixed()).toBe(
        EXPECTED_QTY_FOR_1000_M2[item.materialCode],
      );
      expect(item.finalQty.toFixed()).toBe(
        EXPECTED_QTY_FOR_1000_M2[item.materialCode],
      );
    }

    await service.saveDraft(
      lead.id,
      {
        expectedRevision: saved.revision,
        items: [
          {
            id: saved.items[0].id,
            finalQty: '1100',
            note: 'узлы',
          },
        ],
      },
      user,
    );

    const reopened = await prisma.facadeSubsystemCalculation.findUniqueOrThrow({
      where: { leadId: lead.id },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
    expect(reopened.items[0].calculatedQty?.toFixed()).toBe('1060');
    expect(reopened.items[0].finalQty.toFixed()).toBe('1100');
    expect(reopened.items[0].isManual).toBe(true);
    expect(await prisma.panelQuote.count()).toBe(quotesBefore);
    expect(await prisma.deal.count()).toBe(dealsBefore);
  });
});
