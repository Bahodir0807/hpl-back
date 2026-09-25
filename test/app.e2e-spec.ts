import './jest-e2e.env';
import { createHash } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import {
  ActivityType,
  ClientSegment,
  ClientType,
  DealStage,
  FulfillmentSource,
  OrderStatus,
  PaymentRecordStatus,
  PaymentStatus,
  SupplierOrderStatus,
  Prisma,
  ProductPriceType,
  ProductStatus,
  RoleName,
  StockReservationStatus,
  TaskPriority,
  TaskStatus,
  TaskType,
} from '@prisma/client';
import { hash } from 'bcryptjs';
import JSZip from 'jszip';
import request, { Response } from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { TestIntegrationsModule } from './../src/integrations/test/test-integrations.module';
import { seedPanels, seedFixtureCnyUsdRate } from './../prisma/seed/panels';
import { seedCalculatorProduct } from './../prisma/seed/calculator-product';
import { seedFacadeSubsystemCatalog } from './../prisma/seed/facade-subsystem';
import { synchronizeRbac } from './../src/auth/rbac/synchronize-rbac';
import {
  ROLE_PERMISSION_SLUGS,
  TARGET_ROLE_NAMES,
} from './../src/auth/rbac/permission-matrix';
import { IdempotencyService } from './../src/integrations/telegram/services/idempotency.service';
import { TelegramAdminHandlerService } from './../src/integrations/telegram/services/telegram-admin-handler.service';
import { TelegramLeadFactory } from './../src/integrations/telegram/services/telegram-lead-factory.service';
import { compactUuid } from './../src/integrations/telegram/telegram.types';
import { InventoryService } from './../src/modules/inventory/inventory.service';
import { SHIPMENT_PAYMENT_NOT_CONFIRMED_MESSAGE } from './../src/modules/orders/services/shipment-payment.policy';
import { PrismaService } from './../src/modules/prisma/prisma.service';
import { TasksCronService } from './../src/modules/tasks/tasks-cron.service';
import { SupplierOrdersService } from './../src/modules/supplier-orders/supplier-orders.service';
import { SUPPLIER_ORDER_REMINDER_TYPE } from './../src/modules/supplier-orders/supplier-order.constants';

type AuthTokens = {
  accessToken: string;
  refreshToken: string;
};

type EntityResponse = {
  id: string;
};

type LeadResponse = EntityResponse & {
  dealId?: string;
  status?: string;
};

type DealResponse = EntityResponse & {
  nextActionAt?: string;
  items?: {
    quantityM2: number;
    totalPrice: string;
  }[];
};

type OrderResponse = EntityResponse & {
  totalAmount: string;
  paidAmount: string;
  remainingAmount: string;
  paymentStatus: PaymentStatus;
};

type DuplicateResponse = {
  client: {
    id: string;
  };
  reasons: string[];
}[];

type TestContext = {
  adminToken: string;
  directorToken: string;
  headToken: string;
  managerToken: string;
  accountantToken: string;
  storekeeperToken: string;
  engineerToken: string;
  headId: string;
  managerId: string;
  accountantId: string;
  directorId: string;
  engineerId: string;
  clientId: string;
  contactId: string;
  projectObjectId: string;
  productId: string;
  sheetArea: number;
  apiKeyToken: string;
  apiKeyLimitedToken: string;
};

const RUN_ID = `${Date.now()}`;
const TEST_PASSWORD = 'Password123!';
// env.schema требует >= 32 символов на JWT-секрет
const ACCESS_SECRET = 'test-access-secret-key-min-32-chars';
const REFRESH_SECRET = 'test-refresh-secret-key-min-32-chars';

jest.setTimeout(120_000);

describe('CRM HPL acceptance criteria (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let prisma: PrismaService;
  let tasksCronService: TasksCronService;
  let supplierOrdersService: SupplierOrdersService;
  let context: TestContext;

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = ACCESS_SECRET;
    process.env.JWT_REFRESH_SECRET = REFRESH_SECRET;
    process.env.SERVICE_ACCOUNT_TOKEN_PEPPER =
      'test-service-account-pepper-min-32-chars';
    process.env.LEAD_POOL_USER_EMAIL = 'lead-pool@hpl.com';
    process.env.SYSTEM_USER_EMAIL = 'system@hpl.com';
    process.env.DATABASE_URL =
      process.env.DATABASE_URL ??
      'postgresql://crm:crm@localhost:5432/crm_test';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule, TestIntegrationsModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: false,
        transform: true,
      }),
    );

    await app.init();

    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    tasksCronService = app.get(TasksCronService);
    supplierOrdersService = app.get(SupplierOrdersService);
    context = await seedAcceptanceData(prisma, server);
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('AT-01 detects duplicates by normalized phone and INN', async () => {
    const response = await request(server)
      .post('/clients/check-duplicates')
      .set(authHeader(context.managerToken))
      .send({
        phone: '+7 (999) 111-22-33',
        inn: `7700${RUN_ID.slice(-6)}`,
      })
      .expect(201);

    const body = bodyAs<DuplicateResponse>(response);
    expect(body.length).toBeGreaterThan(0);
    expect(body[0].client.id).toBe(context.clientId);
    expect(body[0].reasons).toEqual(
      expect.arrayContaining(['MATCH_PHONE', 'MATCH_INN']),
    );
  });

  it('AT-02 creates first-contact task with 2 hour SLA when lead is created', async () => {
    const beforeRequest = Date.now();
    const response = await request(server)
      .post('/leads')
      .set(authHeader(context.managerToken))
      .send({
        title: `SLA lead ${RUN_ID}`,
        source: 'website',
      })
      .expect(201);
    const afterRequest = Date.now();
    const lead = bodyAs<LeadResponse>(response);

    const task = await prisma.task.findFirstOrThrow({
      where: {
        relatedType: 'Lead',
        relatedId: lead.id,
      },
    });
    const expectedMin = beforeRequest + 2 * 60 * 60 * 1000 - 10_000;
    const expectedMax = afterRequest + 2 * 60 * 60 * 1000 + 10_000;

    expect(task.status).toBe(TaskStatus.PENDING);
    expect(task.type).toBe(TaskType.FIRST_CONTACT);
    expect(task.assigneeId).toBe(context.managerId);
    expect(task.dueDate.getTime()).toBeGreaterThanOrEqual(expectedMin);
    expect(task.dueDate.getTime()).toBeLessThanOrEqual(expectedMax);
  });

  it('AT-03 enforces Stage-1 qualification and creates exactly one Deal', async () => {
    const createResponse = await request(server)
      .post('/leads')
      .set(authHeader(context.managerToken))
      .send({
        title: `Qualification lead ${RUN_ID}`,
        source: 'email',
      })
      .expect(201);
    const lead = bodyAs<LeadResponse>(createResponse);

    await request(server)
      .post(`/leads/${lead.id}/qualify`)
      .set(authHeader(context.managerToken))
      .send({
        clientId: context.clientId,
        projectObjectId: context.projectObjectId,
        needDescription: 'HPL panels for lobby',
      })
      .expect(400);

    await request(server)
      .post(`/leads/${lead.id}/qualify`)
      .set(authHeader(context.managerToken))
      .send({
        clientId: context.clientId,
        projectObjectId: context.projectObjectId,
        needDescription: 'HPL panels for lobby',
        decisionMakerContact: 'Chief architect',
      })
      .expect(400);

    const qualifyResponse = await request(server)
      .post(`/leads/${lead.id}/qualify`)
      .set(authHeader(context.managerToken))
      .send({
        clientId: context.clientId,
        projectObjectId: context.projectObjectId,
        needDescription: 'HPL panels for lobby',
        decisionMakerContact: 'Chief architect',
        qualification: await stage1QualificationPayload(prisma, {
          installationRequired: false,
        }),
      })
      .expect(201);
    const qualifiedLead = bodyAs<LeadResponse>(qualifyResponse);

    expect(qualifiedLead.status).toBe('QUALIFIED');
    expect(qualifiedLead.dealId).toBeTruthy();

    const persisted = await prisma.lead.findUniqueOrThrow({
      where: { id: lead.id },
    });
    expect(persisted.status).toBe('QUALIFIED');
    expect(persisted.dealId).toBe(qualifiedLead.dealId);

    const deals = await prisma.deal.findMany({
      where: { title: `Qualification lead ${RUN_ID}` },
    });
    expect(deals).toHaveLength(1);

    const listed = await request(server)
      .get('/leads')
      .query({ status: 'QUALIFIED', search: `Qualification lead ${RUN_ID}` })
      .set(authHeader(context.managerToken))
      .expect(200);
    expect(
      bodyAs<{ items: LeadResponse[] }>(listed).items.some(
        (item) => item.id === lead.id,
      ),
    ).toBe(true);

    const workspace = await request(server)
      .get(`/leads/${lead.id}/workspace`)
      .set(authHeader(context.managerToken))
      .expect(200);
    expect(
      bodyAs<{ lead: { status: string; dealId: string | null } }>(workspace)
        .lead.status,
    ).toBe('QUALIFIED');
  });

  it('BP1 allows a new lead without installationRequired', async () => {
    const response = await request(server)
      .post('/leads')
      .set(authHeader(context.managerToken))
      .send({
        title: `Partial HPL lead ${RUN_ID}`,
        source: 'website',
      })
      .expect(201);
    const lead = bodyAs<LeadResponse>(response);

    const qualification = await request(server)
      .get(`/leads/${lead.id}/qualification`)
      .set(authHeader(context.managerToken))
      .expect(200);

    expect(
      bodyAs<{
        qualification: { installationRequired: boolean | null } | null;
      }>(qualification).qualification,
    ).toBeNull();

    const created = await prisma.lead.findUniqueOrThrow({
      where: { id: lead.id },
      include: { qualification: true },
    });
    expect(created.qualification).toBeNull();
  });

  it('BP1 distinguishes unknown vs NO installation and persists Stage-1 need', async () => {
    const created = await request(server)
      .post('/leads')
      .set(authHeader(context.managerToken))
      .send({
        title: `Stage-1 persist ${RUN_ID}`,
        source: 'email',
      })
      .expect(201);
    const leadId = bodyAs<LeadResponse>(created).id;
    const payload = await stage1QualificationPayload(prisma, {
      installationRequired: true,
      stockOnly: true,
      urgent: true,
      willingToWait: false,
    });

    await request(server)
      .patch(`/leads/${leadId}/qualification`)
      .set(authHeader(context.managerToken))
      .send({ application: 'EXTERIOR_WITH_UV' })
      .expect(200);

    const unknownInstallation = await request(server)
      .get(`/leads/${leadId}/qualification`)
      .set(authHeader(context.managerToken))
      .expect(200);
    expect(
      bodyAs<{ qualification: { installationRequired: boolean | null } }>(
        unknownInstallation,
      ).qualification.installationRequired,
    ).toBeNull();

    await request(server)
      .post(`/leads/${leadId}/qualify`)
      .set(authHeader(context.managerToken))
      .send({
        clientId: context.clientId,
        projectObjectId: context.projectObjectId,
        needDescription: 'HPL for facade',
        decisionMakerContact: 'Chief architect',
      })
      .expect(400);

    const saved = await request(server)
      .patch(`/leads/${leadId}/qualification`)
      .set(authHeader(context.managerToken))
      .send(payload)
      .expect(200);
    const savedBody = bodyAs<{
      application: string;
      thicknessMm: number;
      colorCode: string;
      requiredAreaM2: string;
      installationRequired: boolean;
      stockOnly: boolean;
      urgent: boolean;
      willingToWait: boolean;
      customerRequirements: string;
    }>(saved);

    expect(savedBody.application).toBe('EXTERIOR_WITH_UV');
    expect(savedBody.thicknessMm).toBe('10');
    expect(savedBody.colorCode).toBe('W100');
    expect(Number(savedBody.requiredAreaM2)).toBe(15.5);
    expect(savedBody.installationRequired).toBe(true);
    expect(savedBody.stockOnly).toBe(true);
    expect(savedBody.urgent).toBe(true);
    expect(savedBody.willingToWait).toBe(false);
    expect(savedBody.customerRequirements).toContain('in stock');

    const activity = await prisma.activity.findFirst({
      where: {
        relatedType: 'Lead',
        relatedId: leadId,
        authorId: context.managerId,
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(activity?.content).toContain('Stage-1 HPL qualification');

    const noInstallLead = await request(server)
      .post('/leads')
      .set(authHeader(context.managerToken))
      .send({
        title: `No install ${RUN_ID}`,
        source: 'email',
      })
      .expect(201);
    const noInstallId = bodyAs<LeadResponse>(noInstallLead).id;

    await request(server)
      .post(`/leads/${noInstallId}/qualify`)
      .set(authHeader(context.managerToken))
      .send({
        clientId: context.clientId,
        projectObjectId: context.projectObjectId,
        needDescription: 'HPL for lobby',
        decisionMakerContact: 'Chief architect',
        qualification: await stage1QualificationPayload(prisma, {
          installationRequired: false,
        }),
      })
      .expect(201);

    const noInstall = await prisma.leadQualification.findUniqueOrThrow({
      where: { leadId: noInstallId },
    });
    expect(noInstall.installationRequired).toBe(false);

    const noInstallLeadRow = await prisma.lead.findUniqueOrThrow({
      where: { id: noInstallId },
    });
    expect(noInstallLeadRow.status).toBe('QUALIFIED');
    expect(noInstallLeadRow.dealId).toBeTruthy();
  });

  it('BP1 denies foreign manager qualification access and blocks commercial fields', async () => {
    const passwordHash = await hash(TEST_PASSWORD, 12);
    const managerB = await upsertUser(prisma, {
      email: `manager-b-${RUN_ID}@hpl.test`,
      firstName: 'Other',
      lastName: 'Manager',
      passwordHash,
      roleName: RoleName.MANAGER,
      managerId: context.headId,
    });
    const managerBTokens = await login(server, `manager-b-${RUN_ID}@hpl.test`);

    const ownLead = await request(server)
      .post('/leads')
      .set(authHeader(context.managerToken))
      .send({
        title: `Owner qualification ${RUN_ID}`,
        source: 'e2e',
      })
      .expect(201);
    const ownLeadId = bodyAs<LeadResponse>(ownLead).id;

    await request(server)
      .patch(`/leads/${ownLeadId}/qualification`)
      .set(authHeader(context.managerToken))
      .send({
        application: 'INTERIOR',
        thicknessMm: 8,
        colorName: 'Black',
        requiredAreaM2: 10,
        installationRequired: false,
        stockOnly: false,
        urgent: false,
      })
      .expect(200);

    await request(server)
      .get(`/leads/${ownLeadId}/qualification`)
      .set(authHeader(managerBTokens.accessToken))
      .expect(403);

    await request(server)
      .patch(`/leads/${ownLeadId}/qualification`)
      .set(authHeader(managerBTokens.accessToken))
      .send({ installationRequired: true })
      .expect(403);

    await request(server)
      .get(`/leads/${ownLeadId}/qualification`)
      .set(authHeader(context.headToken))
      .expect(200);

    const commercial = await request(server)
      .patch(`/leads/${ownLeadId}/qualification`)
      .set(authHeader(context.managerToken))
      .send({
        application: 'INTERIOR',
        supplierId: managerB.id,
        supplierPrice: 80,
        cnyUsdRate: 0.14,
        sellingCoefficient: 1.8,
        discount: 10,
        finalPrice: 999,
      })
      .expect(400);

    expect(JSON.stringify(commercial.body)).toContain('supplier');

    const afterReject = await prisma.leadQualification.findUniqueOrThrow({
      where: { leadId: ownLeadId },
    });
    expect(afterReject.installationRequired).toBe(false);
    expect(
      Object.prototype.hasOwnProperty.call(afterReject, 'supplierId'),
    ).toBe(false);
  });

  it('BP1 telegram intake does not default installationRequired to false', async () => {
    const leadFactory = app.get(TelegramLeadFactory);
    const lead = await leadFactory.create({
      telegramUserId: `tg-hpl-${RUN_ID}`,
      telegramUsername: 'hpl_user',
      formData: {
        name: 'HPL TG',
        phone: `+99892${RUN_ID.slice(-7)}`,
        message: 'Need panels',
        panelTypePreference: 'exterior',
      },
      updateId: `hpl-tg-${RUN_ID}`,
      rawPayload: {},
    });

    const qualification = await prisma.leadQualification.findUnique({
      where: { leadId: lead.id },
    });

    expect(qualification).not.toBeNull();
    expect(qualification?.application).toBe('EXTERIOR_WITH_UV');
    expect(qualification?.installationRequired).toBeNull();
    expect(qualification?.stockOnly).toBeNull();
    expect(qualification?.urgent).toBeNull();
  });

  it('BP2 allows Stage-1 qualify when installation is required and without commercial fields', async () => {
    const created = await request(server)
      .post('/leads')
      .set(authHeader(context.managerToken))
      .send({
        title: `Install yes ${RUN_ID}`,
        source: 'email',
      })
      .expect(201);
    const leadId = bodyAs<LeadResponse>(created).id;

    const qualifyResponse = await request(server)
      .post(`/leads/${leadId}/qualify`)
      .set(authHeader(context.managerToken))
      .send({
        clientId: context.clientId,
        projectObjectId: context.projectObjectId,
        needDescription: 'Facade HPL with installation',
        decisionMakerContact: 'Chief architect',
        qualification: await stage1QualificationPayload(prisma, {
          installationRequired: true,
        }),
      })
      .expect(201);

    const body = bodyAs<LeadResponse>(qualifyResponse);
    expect(body.status).toBe('QUALIFIED');
    expect(body.dealId).toBeTruthy();

    const deals = await prisma.deal.count({
      where: { title: `Install yes ${RUN_ID}` },
    });
    expect(deals).toBe(1);
  });

  it('BP2 repeated qualify is idempotent and creates one Deal', async () => {
    const created = await request(server)
      .post('/leads')
      .set(authHeader(context.managerToken))
      .send({
        title: `Repeat qualify ${RUN_ID}`,
        source: 'email',
      })
      .expect(201);
    const leadId = bodyAs<LeadResponse>(created).id;
    const payload = {
      clientId: context.clientId,
      projectObjectId: context.projectObjectId,
      needDescription: 'HPL panels for lobby',
      decisionMakerContact: 'Chief architect',
      qualification: await stage1QualificationPayload(prisma, {
        installationRequired: false,
      }),
    };

    const first = await request(server)
      .post(`/leads/${leadId}/qualify`)
      .set(authHeader(context.managerToken))
      .send(payload)
      .expect(201);
    const second = await request(server)
      .post(`/leads/${leadId}/qualify`)
      .set(authHeader(context.managerToken))
      .send(payload)
      .expect(201);

    expect(bodyAs<LeadResponse>(first).status).toBe('QUALIFIED');
    expect(bodyAs<LeadResponse>(second).status).toBe('QUALIFIED');
    expect(bodyAs<LeadResponse>(second).dealId).toBeTruthy();

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    expect(lead.status).toBe('QUALIFIED');
    expect(lead.dealId).toBeTruthy();
    expect(await prisma.deal.count({ where: { title: lead.title } })).toBe(1);

    const stage2Tasks = await prisma.task.findMany({
      where: {
        relatedType: 'Lead',
        relatedId: leadId,
        title: { startsWith: 'Stage 2 commercial qualification:' },
      },
    });
    expect(stage2Tasks).toHaveLength(1);
    expect(stage2Tasks[0]?.assigneeId).toBe(context.headId);
    expect(stage2Tasks[0]?.assigneeId).not.toBe(context.managerId);

    const audits = await prisma.auditLog.findMany({
      where: { action: 'LEAD_QUALIFIED_STAGE1', entityId: leadId },
    });
    expect(audits).toHaveLength(1);
  });

  it('Stage-1 qualify auto-creates one DRAFT CalculationRequest from HPL items', async () => {
    const created = await request(server)
      .post('/leads')
      .set(authHeader(context.managerToken))
      .send({
        title: `Auto request ${RUN_ID}`,
        source: 'email',
      })
      .expect(201);
    const leadId = bodyAs<LeadResponse>(created).id;
    const panelType = await prisma.panelType.findFirstOrThrow({
      where: { code: 'furniture' },
    });
    const panelSize = await prisma.panelSize.findFirstOrThrow({
      where: { widthMm: 1220, heightMm: 2440 },
    });
    const qualification = {
      installationRequired: false,
      customerRequirements: 'Two zones, one incomplete',
      items: [
        {
          application: 'FURNITURE',
          panelTypeId: panelType.id,
          panelSizeId: panelSize.id,
          thicknessMm: 0.8,
          colorCode: 'W100',
          colorName: 'White',
          coating: 'Матовый',
          texture: 'Под камень',
          requiredAreaM2: 12.5,
        },
        {
          application: 'FURNITURE',
          panelTypeId: panelType.id,
          colorName: 'Черный',
          coating: '',
          texture: 'Гладкий',
          requiredAreaM2: 4,
        },
        {
          application: 'FURNITURE',
          panelTypeId: panelType.id,
          thicknessMm: 1.2,
          colorName: 'без точного RAL',
          requiredAreaM2: 7,
        },
      ],
    };

    const qualifyPayload = {
      clientId: context.clientId,
      contactId: context.contactId,
      projectObjectId: context.projectObjectId,
      needDescription: 'HPL furniture for lobby',
      decisionMakerContact: 'Chief architect',
      qualification,
    };
    await request(server)
      .post(`/leads/${leadId}/qualify`)
      .set(authHeader(context.managerToken))
      .send(qualifyPayload)
      .expect(201);

    const afterFirstQualify = await prisma.calculationRequest.findMany({
      where: { leadId, deletedAt: null },
      include: {
        calculations: {
          where: { deletedAt: null },
          include: { items: { orderBy: { sortOrder: 'asc' } } },
        },
      },
    });
    expect(afterFirstQualify).toHaveLength(1);
    expect(afterFirstQualify[0].status).toBe('draft');
    expect(afterFirstQualify[0].submittedById).toBeNull();
    expect(afterFirstQualify[0].submittedAt).toBeNull();
    const initialItems = afterFirstQualify[0].calculations[0]?.items ?? [];
    expect(initialItems).toHaveLength(3);
    expect(initialItems.map((item) => item.sortOrder)).toEqual([0, 1, 2]);
    expect(initialItems[1].panelSizeId).toBeNull();
    expect(initialItems[1].thicknessMm).toBeNull();
    expect(initialItems[1].qualityClassId).toBeNull();
    expect(initialItems[1].requiredAreaM2?.toString()).toBe('4');
    expect(initialItems[1].coating).toBeNull();
    expect(initialItems[1].texture).toBe('Гладкий');
    expect(initialItems[0].coating).toBe('Матовый');
    expect(initialItems[0].texture).toBe('Под камень');
    expect(initialItems[2].colorName).toBe('без точного RAL');

    const tianran = await prisma.supplier.findFirstOrThrow({
      where: { code: 'tianran' },
    });
    const managerOwnedNote =
      'Клиент просит Tianran, не пересобирать позиции после qualify.';
    const firstItem = afterFirstQualify[0].calculations[0]?.items[0];
    const secondItem = afterFirstQualify[0].calculations[0]?.items[1];
    const thirdItem = afterFirstQualify[0].calculations[0]?.items[2];
    await request(server)
      .patch(`/calculations/requests/${afterFirstQualify[0].id}`)
      .set(authHeader(context.managerToken))
      .send({
        notes: managerOwnedNote,
        calculations: [
          {
            title: 'Расчёт №1',
            items: [
              {
                panelTypeId: firstItem?.panelTypeId,
                panelSizeId: firstItem?.panelSizeId,
                thicknessMm: firstItem?.thicknessMm?.toString(),
                requiredAreaM2: '20.5',
                colorName: firstItem?.colorName,
                coating: firstItem?.coating,
                texture: firstItem?.texture,
                supplierId: tianran.id,
                decor: 'Tianran Concrete 7016',
              },
              {
                panelTypeId: secondItem?.panelTypeId,
                requiredAreaM2: secondItem?.requiredAreaM2?.toString(),
                colorName: secondItem?.colorName,
                texture: secondItem?.texture,
              },
              {
                panelTypeId: thirdItem?.panelTypeId,
                thicknessMm: thirdItem?.thicknessMm?.toString(),
                requiredAreaM2: thirdItem?.requiredAreaM2?.toString(),
                colorName: thirdItem?.colorName,
              },
              {
                panelTypeId: firstItem?.panelTypeId,
                requiredAreaM2: '3.25',
                colorName: 'RAL extra',
                decor: 'Extra manager row',
              },
            ],
          },
        ],
      })
      .expect(200);

    await request(server)
      .post(`/leads/${leadId}/qualify`)
      .set(authHeader(context.managerToken))
      .send(qualifyPayload)
      .expect(201);

    const requests = await prisma.calculationRequest.findMany({
      where: { leadId, deletedAt: null },
      include: {
        calculations: {
          where: { deletedAt: null },
          orderBy: { sortOrder: 'asc' },
          include: { items: { orderBy: { sortOrder: 'asc' } } },
        },
      },
    });
    expect(requests).toHaveLength(1);
    expect(requests[0].id).toBe(afterFirstQualify[0].id);
    expect(requests[0].status).toBe('draft');
    expect(requests[0].submittedById).toBeNull();
    expect(requests[0].notes).toBe(managerOwnedNote);
    expect(requests[0].calculations[0]?.items).toHaveLength(4);
    expect(requests[0].calculations[0]?.items[0].supplierId).toBe(tianran.id);
    expect(requests[0].calculations[0]?.items[0].decor).toBe(
      'Tianran Concrete 7016',
    );
    expect(Number(requests[0].calculations[0]?.items[0].requiredAreaM2)).toBe(
      20.5,
    );
    expect(requests[0].calculations[0]?.items[3].decor).toBe(
      'Extra manager row',
    );
    const submittedNotifications = await prisma.notification.findMany({
      where: {
        type: 'calculation_request_submitted',
        relatedId: leadId,
      },
    });
    expect(submittedNotifications).toHaveLength(0);

    const headView = await request(server)
      .get(`/calculations/requests/${requests[0].id}`)
      .set(authHeader(context.headToken))
      .expect(200);
    expect(bodyAs<EntityResponse>(headView).id).toBe(requests[0].id);

    const emptyLead = await request(server)
      .post('/leads')
      .set(authHeader(context.managerToken))
      .send({
        title: `Empty items ${RUN_ID}`,
        source: 'email',
      })
      .expect(201);
    const emptyLeadId = bodyAs<LeadResponse>(emptyLead).id;
    await request(server)
      .post(`/leads/${emptyLeadId}/qualify`)
      .set(authHeader(context.managerToken))
      .send({
        clientId: context.clientId,
        contactId: context.contactId,
        projectObjectId: context.projectObjectId,
        needDescription: 'Need described, HPL later',
        decisionMakerContact: 'Chief architect',
        qualification: {
          installationRequired: false,
          items: [],
        },
      })
      .expect(201);
    const emptyRequests = await prisma.calculationRequest.findMany({
      where: { leadId: emptyLeadId, deletedAt: null },
      include: {
        calculations: {
          where: { deletedAt: null },
          include: { items: true },
        },
      },
    });
    expect(emptyRequests).toHaveLength(1);
    expect(emptyRequests[0].calculations[0]?.items ?? []).toEqual([]);
  });

  it('keeps Need and Manager Note independent and maps coating/texture/Decor', async () => {
    const created = await request(server)
      .post('/leads')
      .set(authHeader(context.managerToken))
      .send({
        title: `Stage2 fields ${RUN_ID}`,
        source: 'email',
      })
      .expect(201);
    const leadId = bodyAs<LeadResponse>(created).id;
    const panelType = await prisma.panelType.findFirstOrThrow({
      where: { code: 'furniture' },
    });
    const panelSize = await prisma.panelSize.findFirstOrThrow({
      where: { widthMm: 1220, heightMm: 2440 },
    });
    const need = 'Фасад бизнес-центра';
    const managerNote = 'Клиент хочет получить предложение до пятницы';

    await request(server)
      .patch(`/leads/${leadId}/manager-commercial-note`)
      .set(authHeader(context.managerToken))
      .send({ commercialNote: managerNote })
      .expect(200);

    const afterNote = bodyAs<{
      needDescription?: string | null;
      managerCommercialNote?: string | null;
    }>(
      await request(server)
        .get(`/leads/${leadId}`)
        .set(authHeader(context.managerToken))
        .expect(200),
    );
    expect(afterNote.managerCommercialNote).toBe(managerNote);
    expect(afterNote.needDescription ?? null).not.toBe(managerNote);

    await request(server)
      .post(`/leads/${leadId}/qualify`)
      .set(authHeader(context.managerToken))
      .send({
        clientId: context.clientId,
        contactId: context.contactId,
        projectObjectId: context.projectObjectId,
        needDescription: need,
        decisionMakerContact: 'Chief architect',
        qualification: {
          installationRequired: false,
          customerRequirements: need,
          items: [
            {
              application: 'FURNITURE',
              panelTypeId: panelType.id,
              panelSizeId: panelSize.id,
              thicknessMm: 0.8,
              colorName: 'Серый',
              coating: 'Матовый',
              texture: 'Под камень',
              requiredAreaM2: 12.5,
            },
            {
              application: 'FURNITURE',
              panelTypeId: panelType.id,
              colorName: 'Черный',
              texture: 'Гладкий',
              requiredAreaM2: 4,
            },
          ],
        },
      })
      .expect(201);

    const afterQualify = bodyAs<{
      needDescription?: string | null;
      managerCommercialNote?: string | null;
      qualification?: {
        customerRequirements?: string | null;
        items?: Array<{
          colorName?: string | null;
          coating?: string | null;
          texture?: string | null;
        }>;
      };
    }>(
      await request(server)
        .get(`/leads/${leadId}`)
        .set(authHeader(context.managerToken))
        .expect(200),
    );
    expect(afterQualify.needDescription).toBe(need);
    expect(afterQualify.managerCommercialNote).toBe(managerNote);
    expect(afterQualify.qualification?.customerRequirements).toBe(need);
    expect(afterQualify.qualification?.items?.[0]).toEqual(
      expect.objectContaining({
        colorName: 'Серый',
        coating: 'Матовый',
        texture: 'Под камень',
      }),
    );
    expect(afterQualify.qualification?.items?.[1]).toEqual(
      expect.objectContaining({
        colorName: 'Черный',
        coating: null,
        texture: 'Гладкий',
      }),
    );

    await request(server)
      .patch(`/leads/${leadId}/manager-commercial-note`)
      .set(authHeader(context.managerToken))
      .send({ commercialNote: 'Нужен выезд замерщика' })
      .expect(200);
    const afterNoteEdit = bodyAs<{
      needDescription?: string | null;
      managerCommercialNote?: string | null;
    }>(
      await request(server)
        .get(`/leads/${leadId}`)
        .set(authHeader(context.managerToken))
        .expect(200),
    );
    expect(afterNoteEdit.needDescription).toBe(need);
    expect(afterNoteEdit.managerCommercialNote).toBe('Нужен выезд замерщика');

    const requests = await prisma.calculationRequest.findMany({
      where: { leadId, deletedAt: null },
      include: {
        calculations: {
          where: { deletedAt: null },
          include: { items: { orderBy: { sortOrder: 'asc' } } },
        },
      },
    });
    expect(requests).toHaveLength(1);
    const requestId = requests[0].id;
    const mapped = requests[0].calculations[0]?.items ?? [];
    expect(mapped[0].colorName).toBe('Серый');
    expect(mapped[0].coating).toBe('Матовый');
    expect(mapped[0].texture).toBe('Под камень');
    expect(mapped[0].decor).toBeNull();
    expect(mapped[1].colorName).toBe('Черный');
    expect(mapped[1].coating).toBeNull();
    expect(mapped[1].texture).toBe('Гладкий');
    expect(mapped[1].panelSizeId).toBeNull();

    const headSaved = await request(server)
      .patch(`/calculations/requests/${requestId}`)
      .set(authHeader(context.managerToken))
      .send({
        calculations: [
          {
            title: 'Расчёт №1',
            items: [
              {
                panelTypeId: mapped[0].panelTypeId,
                panelSizeId: mapped[0].panelSizeId,
                thicknessMm: mapped[0].thicknessMm?.toString(),
                requiredAreaM2: mapped[0].requiredAreaM2?.toString(),
                colorName: mapped[0].colorName,
                coating: 'UV матовый',
                texture: mapped[0].texture,
                decor: 'Concrete Grey 7016',
              },
              {
                panelTypeId: mapped[1].panelTypeId,
                requiredAreaM2: mapped[1].requiredAreaM2?.toString(),
                colorName: mapped[1].colorName,
                texture: mapped[1].texture,
                decor: 'Black Woodgrain X2',
              },
            ],
          },
        ],
      })
      .expect(200);

    const savedItems =
      bodyAs<{
        calculations: Array<{
          items: Array<{
            colorName?: string | null;
            coating?: string | null;
            texture?: string | null;
            decor?: string | null;
            panelSizeId?: string | null;
          }>;
        }>;
      }>(headSaved).calculations[0]?.items ?? [];
    expect(savedItems[0]).toEqual(
      expect.objectContaining({
        colorName: 'Серый',
        coating: 'UV матовый',
        texture: 'Под камень',
        decor: 'Concrete Grey 7016',
      }),
    );
    expect(savedItems[1]).toEqual(
      expect.objectContaining({
        colorName: 'Черный',
        texture: 'Гладкий',
        decor: 'Black Woodgrain X2',
        panelSizeId: null,
      }),
    );

    const reopened = await request(server)
      .get(`/calculations/requests/${requestId}`)
      .set(authHeader(context.headToken))
      .expect(200);
    const reopenedItems =
      bodyAs<{
        calculations: Array<{
          items: Array<{
            colorName?: string | null;
            coating?: string | null;
            decor?: string | null;
          }>;
        }>;
      }>(reopened).calculations[0]?.items ?? [];
    expect(reopenedItems[0].decor).toBe('Concrete Grey 7016');
    expect(reopenedItems[1].decor).toBe('Black Woodgrain X2');
    expect(reopenedItems[0].colorName).toBe('Серый');

    const qualificationAfterDecor = await prisma.leadQualificationItem.findMany(
      {
        where: { qualification: { leadId } },
        orderBy: { sortOrder: 'asc' },
      },
    );
    expect(qualificationAfterDecor[0].colorName).toBe('Серый');
    expect(qualificationAfterDecor[1].colorName).toBe('Черный');
  });

  it('persists manager note and mixed item suppliers into QuoteDraft without a global supplier', async () => {
    const leadResponse = await request(server)
      .post('/leads')
      .set(authHeader(context.managerToken))
      .send({
        title: `Mixed suppliers ${RUN_ID}`,
        source: 'e2e',
        clientId: context.clientId,
      })
      .expect(201);
    const leadId = bodyAs<LeadResponse>(leadResponse).id;
    await qualifyLeadStage1(leadId);
    await confirmLeadStage2(leadId);

    const autoCreated = await prisma.calculationRequest.findMany({
      where: { leadId, deletedAt: null },
    });
    expect(autoCreated).toHaveLength(1);
    expect(autoCreated[0].status).toBe('draft');

    const panelType = await prisma.panelType.findFirstOrThrow({
      where: { code: 'exterior_with_uv' },
    });
    const panelSize = await prisma.panelSize.findFirstOrThrow({
      where: { widthMm: 1220, heightMm: 2440 },
    });
    const polybet = await prisma.supplier.findFirstOrThrow({
      where: { code: 'polybet' },
    });
    const tianran = await prisma.supplier.findFirstOrThrow({
      where: { code: 'tianran' },
    });
    const qualityClass = await prisma.qualityClass.findFirstOrThrow({
      where: { code: 'economy' },
    });
    const managerNote =
      'Клиент хочет жёлтый декор, окончательный цвет согласовать перед заказом.';

    const created = await request(server)
      .patch(`/calculations/requests/${autoCreated[0].id}`)
      .set(authHeader(context.managerToken))
      .send({
        notes: managerNote,
        calculations: [
          {
            title: 'Фасад',
            items: [
              {
                panelTypeId: panelType.id,
                panelSizeId: panelSize.id,
                thicknessMm: 10,
                qualityClassId: qualityClass.id,
                requiredAreaM2: '12.50',
                supplierId: polybet.id,
              },
              {
                panelTypeId: panelType.id,
                panelSizeId: panelSize.id,
                thicknessMm: 8,
                qualityClassId: qualityClass.id,
                requiredAreaM2: '6.25',
                supplierId: tianran.id,
              },
            ],
          },
        ],
      })
      .expect(200);

    const requestId = bodyAs<EntityResponse>(created).id;
    expect(requestId).toBe(autoCreated[0].id);
    const persisted = bodyAs<{
      notes?: string | null;
      calculations: Array<{
        items: Array<{ supplierId?: string | null }>;
      }>;
    }>(created);
    expect(persisted.notes).toBe(managerNote);
    expect(
      persisted.calculations[0]?.items.map((item) => item.supplierId),
    ).toEqual([polybet.id, tianran.id]);

    const reloaded = await request(server)
      .get(`/calculations/requests/${requestId}`)
      .set(authHeader(context.managerToken))
      .expect(200);
    const reloadedBody = bodyAs<{
      notes?: string | null;
      calculations: Array<{
        items: Array<{ supplierId?: string | null }>;
      }>;
    }>(reloaded);
    expect(reloadedBody.notes).toBe(managerNote);
    expect(
      reloadedBody.calculations[0]?.items.map((item) => item.supplierId),
    ).toEqual([polybet.id, tianran.id]);

    await request(server)
      .post(`/calculations/requests/${requestId}/submit`)
      .set(authHeader(context.managerToken))
      .expect(201);

    await request(server)
      .patch(`/calculations/requests/${requestId}`)
      .set(authHeader(context.managerToken))
      .send({ notes: 'Must not mutate SUBMITTED' })
      .expect(409);

    const headView = await request(server)
      .get(`/calculations/requests/${requestId}`)
      .set(authHeader(context.headToken))
      .expect(200);
    const headBody = bodyAs<{
      notes?: string | null;
      calculations: Array<{
        items: Array<{ supplierId?: string | null }>;
      }>;
    }>(headView);
    expect(headBody.notes).toBe(managerNote);
    expect(
      headBody.calculations[0]?.items.map((item) => item.supplierId),
    ).toEqual([polybet.id, tianran.id]);

    const wuya = await prisma.supplier.findFirstOrThrow({
      where: { code: 'wuya' },
    });
    const quoteResponse = await request(server)
      .post(`/calculations/requests/${requestId}/convert-to-quote`)
      .set(authHeader(context.headToken))
      .send({ supplierId: wuya.id })
      .expect(201);
    const quote = bodyAs<{
      id: string;
      internalCommercialNote?: string | null;
      productionDaysFrom?: number | null;
      productionDaysTo?: number | null;
      deliveryDaysFrom?: number | null;
      deliveryDaysTo?: number | null;
      items: Array<{
        supplierCode?: string | null;
        supplierName?: string | null;
      }>;
    }>(quoteResponse);
    expect(quote.internalCommercialNote).toBe(managerNote);
    expect(quote.items).toHaveLength(2);
    expect(quote.items[0]?.supplierCode).toBe('polybet');
    expect(quote.items[1]?.supplierCode).toBe('tianran');
    expect(
      quote.items.map((item) => item.supplierCode),
    ).not.toContain('wuya');
    expect(quote.productionDaysFrom ?? null).toBeNull();
    expect(quote.productionDaysTo ?? null).toBeNull();
    expect(quote.deliveryDaysFrom ?? null).toBeNull();
    expect(quote.deliveryDaysTo ?? null).toBeNull();

    const productionTerm = '15–20 рабочих дней';
    const deliveryTerm = 'Ориентировочно 4 недели после утверждения декора';
    await request(server)
      .patch(`/quotes/${quote.id}/commercial-terms`)
      .set(authHeader(context.headToken))
      .send({
        productionTerms: productionTerm,
        deliveryTerms: deliveryTerm,
        validUntil: new Date(
          Date.now() + 14 * 24 * 60 * 60 * 1000,
        ).toISOString(),
      })
      .expect(200);

    const reloadedQuote = await request(server)
      .get(`/quotes/${quote.id}`)
      .set(authHeader(context.headToken))
      .expect(200);
    const quoteBody = bodyAs<{
      productionTerms?: string | null;
      deliveryTerms?: string | null;
      productionDaysFrom?: number | null;
      productionDaysTo?: number | null;
      deliveryDaysFrom?: number | null;
      deliveryDaysTo?: number | null;
      items: Array<{ supplierCode?: string | null }>;
    }>(reloadedQuote);
    expect(quoteBody.productionTerms).toBe(productionTerm);
    expect(quoteBody.deliveryTerms).toBe(deliveryTerm);
    expect(quoteBody.productionDaysFrom ?? null).toBeNull();
    expect(quoteBody.productionDaysTo ?? null).toBeNull();
    expect(quoteBody.deliveryDaysFrom ?? null).toBeNull();
    expect(quoteBody.deliveryDaysTo ?? null).toBeNull();
    expect(quoteBody.items.map((item) => item.supplierCode)).toEqual([
      'polybet',
      'tianran',
    ]);
  });

  it('BP2 does not assign Stage-2 to an ordinary owner without managerId', async () => {
    const passwordHash = await hash(TEST_PASSWORD, 12);
    await upsertUser(prisma, {
      email: `solo-manager-${RUN_ID}@hpl.test`,
      firstName: 'Solo',
      lastName: 'Manager',
      passwordHash,
      roleName: RoleName.MANAGER,
    });
    const soloTokens = await login(server, `solo-manager-${RUN_ID}@hpl.test`);
    const solo = await prisma.user.findUniqueOrThrow({
      where: { email: `solo-manager-${RUN_ID}@hpl.test` },
      select: { id: true, managerId: true },
    });
    expect(solo.managerId).toBeNull();

    const created = await request(server)
      .post('/leads')
      .set(authHeader(soloTokens.accessToken))
      .send({
        title: `Solo qualify ${RUN_ID}`,
        source: 'email',
      })
      .expect(201);
    const leadId = bodyAs<LeadResponse>(created).id;

    const qualifyResponse = await request(server)
      .post(`/leads/${leadId}/qualify`)
      .set(authHeader(soloTokens.accessToken))
      .send({
        clientId: context.clientId,
        projectObjectId: context.projectObjectId,
        needDescription: 'HPL panels for lobby',
        decisionMakerContact: 'Chief architect',
        qualification: await stage1QualificationPayload(prisma, {
          installationRequired: false,
        }),
      })
      .expect(201);

    expect(bodyAs<LeadResponse>(qualifyResponse).status).toBe('QUALIFIED');
    expect(bodyAs<LeadResponse>(qualifyResponse).dealId).toBeTruthy();

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    expect(lead.status).toBe('QUALIFIED');
    expect(lead.ownerId).toBe(solo.id);

    const stage2Tasks = await prisma.task.findMany({
      where: {
        relatedType: 'Lead',
        relatedId: leadId,
        title: { startsWith: 'Stage 2 commercial qualification:' },
      },
    });
    expect(stage2Tasks).toHaveLength(0);
    expect(stage2Tasks.some((task) => task.assigneeId === solo.id)).toBe(false);

    const ownerNotifications = await prisma.notification.findMany({
      where: {
        userId: solo.id,
        relatedType: 'Lead',
        relatedId: leadId,
      },
    });
    expect(
      ownerNotifications.some(
        (item) => item.title === 'Stage 1 qualification complete',
      ),
    ).toBe(true);
    expect(
      ownerNotifications.some((item) =>
        item.title.includes('Stage 2 commercial qualification'),
      ),
    ).toBe(false);
  });

  it('BP2 parallel qualify creates exactly one Deal', async () => {
    const created = await request(server)
      .post('/leads')
      .set(authHeader(context.managerToken))
      .send({
        title: `Parallel qualify ${RUN_ID}`,
        source: 'email',
      })
      .expect(201);
    const leadId = bodyAs<LeadResponse>(created).id;
    const qualification = await stage1QualificationPayload(prisma, {
      installationRequired: false,
    });

    await request(server)
      .patch(`/leads/${leadId}/qualification`)
      .set(authHeader(context.managerToken))
      .send(qualification)
      .expect(200);

    const payload = {
      clientId: context.clientId,
      projectObjectId: context.projectObjectId,
      needDescription: 'HPL panels for lobby',
      decisionMakerContact: 'Chief architect',
    };

    const [first, second] = await Promise.all([
      request(server)
        .post(`/leads/${leadId}/qualify`)
        .set(authHeader(context.managerToken))
        .send(payload),
      request(server)
        .post(`/leads/${leadId}/qualify`)
        .set(authHeader(context.managerToken))
        .send(payload),
    ]);

    expect([first.status, second.status].sort()).toEqual([201, 201]);

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    expect(lead.status).toBe('QUALIFIED');
    expect(lead.dealId).toBeTruthy();
    expect(await prisma.deal.count({ where: { title: lead.title } })).toBe(1);

    const stage2Tasks = await prisma.task.findMany({
      where: {
        relatedType: 'Lead',
        relatedId: leadId,
        title: { startsWith: 'Stage 2 commercial qualification:' },
      },
    });
    expect(stage2Tasks).toHaveLength(1);
    expect(stage2Tasks[0]?.assigneeId).toBe(context.headId);
    expect(stage2Tasks[0]?.assigneeId).not.toBe(context.managerId);

    const audits = await prisma.auditLog.findMany({
      where: { action: 'LEAD_QUALIFIED_STAGE1', entityId: leadId },
    });
    expect(audits).toHaveLength(1);
  });

  it('BP3 denies MANAGER Stage-2 commercial qualification and allows HEAD', async () => {
    const leadResponse = await request(server)
      .post('/leads')
      .set(authHeader(context.managerToken))
      .send({
        title: `BP3 auth ${RUN_ID}`,
        source: 'e2e',
        clientId: context.clientId,
      })
      .expect(201);
    const leadId = bodyAs<EntityResponse>(leadResponse).id;
    await qualifyLeadStage1(leadId);

    const tianran = await prisma.supplier.findFirstOrThrow({
      where: { code: 'tianran' },
    });
    const premium = await prisma.qualityClass.findFirstOrThrow({
      where: { code: 'premium' },
    });
    const payload = {
      supplierId: tianran.id,
      qualityClassId: premium.id,
      decisionComment: 'Facade premium',
    };

    await request(server)
      .post(`/leads/${leadId}/commercial-qualification`)
      .set(authHeader(context.managerToken))
      .send(payload)
      .expect(403);

    const confirmed = await request(server)
      .post(`/leads/${leadId}/commercial-qualification`)
      .set(authHeader(context.headToken))
      .send(payload)
      .expect(201);

    expect(
      bodyAs<{ status: string; supplierId: string }>(confirmed).status,
    ).toBe('CONFIRMED');

    const foreignLead = await request(server)
      .post('/leads')
      .set(authHeader(context.headToken))
      .send({
        title: `BP3 foreign ${RUN_ID}`,
        source: 'e2e',
        clientId: context.clientId,
        ownerId: context.headId,
      })
      .expect(201);
    await request(server)
      .post(
        `/leads/${bodyAs<EntityResponse>(foreignLead).id}/commercial-qualification`,
      )
      .set(authHeader(context.managerToken))
      .send(payload)
      .expect(403);
  });

  it('BP3 requires Stage-1 QUALIFIED and rejects terminal leads', async () => {
    const tianran = await prisma.supplier.findFirstOrThrow({
      where: { code: 'tianran' },
    });
    const premium = await prisma.qualityClass.findFirstOrThrow({
      where: { code: 'premium' },
    });
    const payload = {
      supplierId: tianran.id,
      qualityClassId: premium.id,
    };

    const newLead = await request(server)
      .post('/leads')
      .set(authHeader(context.managerToken))
      .send({
        title: `BP3 new ${RUN_ID}`,
        source: 'e2e',
        clientId: context.clientId,
      })
      .expect(201);
    const newLeadId = bodyAs<EntityResponse>(newLead).id;

    await request(server)
      .post(`/leads/${newLeadId}/commercial-qualification`)
      .set(authHeader(context.headToken))
      .send(payload)
      .expect(409);

    await qualifyLeadStage1(newLeadId);
    await request(server)
      .post(`/leads/${newLeadId}/commercial-qualification`)
      .set(authHeader(context.headToken))
      .send(payload)
      .expect(201);

    const disqualified = await request(server)
      .post('/leads')
      .set(authHeader(context.managerToken))
      .send({
        title: `BP3 unqualified ${RUN_ID}`,
        source: 'e2e',
        clientId: context.clientId,
      })
      .expect(201);
    const disqualifiedId = bodyAs<EntityResponse>(disqualified).id;
    await request(server)
      .post(`/leads/${disqualifiedId}/disqualify`)
      .set(authHeader(context.managerToken))
      .send({ reason: 'Lost to competitor' })
      .expect(201);
    await request(server)
      .post(`/leads/${disqualifiedId}/commercial-qualification`)
      .set(authHeader(context.headToken))
      .send(payload)
      .expect(409);
  });

  it('BP3 enforces supplier/quality matrix on Stage 2', async () => {
    const leadId = bodyAs<EntityResponse>(
      await request(server)
        .post('/leads')
        .set(authHeader(context.managerToken))
        .send({
          title: `BP3 matrix ${RUN_ID}`,
          source: 'e2e',
          clientId: context.clientId,
        })
        .expect(201),
    ).id;
    await qualifyLeadStage1(leadId);

    const tianran = await prisma.supplier.findFirstOrThrow({
      where: { code: 'tianran' },
    });
    const wuya = await prisma.supplier.findFirstOrThrow({
      where: { code: 'wuya' },
    });
    const polybet = await prisma.supplier.findFirstOrThrow({
      where: { code: 'polybet' },
    });
    const economy = await prisma.qualityClass.findFirstOrThrow({
      where: { code: 'economy' },
    });
    const medium = await prisma.qualityClass.findFirstOrThrow({
      where: { code: 'medium' },
    });
    const premium = await prisma.qualityClass.findFirstOrThrow({
      where: { code: 'premium' },
    });

    const confirm = (supplierId: string, qualityClassId: string) =>
      request(server)
        .post(`/leads/${leadId}/commercial-qualification`)
        .set(authHeader(context.headToken))
        .send({ supplierId, qualityClassId });

    await confirm(tianran.id, economy.id).expect(201);
    await confirm(tianran.id, medium.id).expect(201);
    await confirm(tianran.id, premium.id).expect(201);
    await confirm(wuya.id, economy.id).expect(201);
    await confirm(wuya.id, medium.id).expect(201);
    await confirm(wuya.id, premium.id).expect(201);
    await confirm(polybet.id, economy.id).expect(201);
    await confirm(polybet.id, medium.id).expect(201);
    await confirm(polybet.id, premium.id).expect(201);

    const interiorLeadId = bodyAs<EntityResponse>(
      await request(server)
        .post('/leads')
        .set(authHeader(context.managerToken))
        .send({
          title: `BP3 interior ${RUN_ID}`,
          source: 'e2e',
          clientId: context.clientId,
        })
        .expect(201),
    ).id;
    const interiorType = await prisma.panelType.findFirstOrThrow({
      where: { code: 'interior' },
    });
    const panelSize = await prisma.panelSize.findFirstOrThrow({
      where: { widthMm: 1220, heightMm: 2440 },
    });
    await request(server)
      .post(`/leads/${interiorLeadId}/qualify`)
      .set(authHeader(context.managerToken))
      .send({
        clientId: context.clientId,
        projectObjectId: context.projectObjectId,
        needDescription: 'Interior HPL',
        decisionMakerContact: 'Architect',
        qualification: {
          ...(await stage1QualificationPayload(prisma, {
            installationRequired: false,
          })),
          application: 'INTERIOR',
          panelTypeId: interiorType.id,
          panelSizeId: panelSize.id,
        },
      })
      .expect(201);
    await request(server)
      .post(`/leads/${interiorLeadId}/commercial-qualification`)
      .set(authHeader(context.headToken))
      .send({ supplierId: tianran.id, qualityClassId: economy.id })
      .expect(201);
  });

  it('BP3 gates calculation on Stage 2, derives supplier/quality, and keeps history', async () => {
    const leadId = bodyAs<EntityResponse>(
      await request(server)
        .post('/leads')
        .set(authHeader(context.managerToken))
        .send({
          title: `BP3 calc ${RUN_ID}`,
          source: 'e2e',
          clientId: context.clientId,
        })
        .expect(201),
    ).id;

    const panelType = await prisma.panelType.findFirstOrThrow({
      where: { code: 'exterior_with_uv' },
    });
    const panelSize = await prisma.panelSize.findFirstOrThrow({
      where: { widthMm: 1220, heightMm: 2440 },
    });
    const wuya = await prisma.supplier.findFirstOrThrow({
      where: { code: 'wuya' },
    });
    const tianran = await prisma.supplier.findFirstOrThrow({
      where: { code: 'tianran' },
    });
    const economy = await prisma.qualityClass.findFirstOrThrow({
      where: { code: 'economy' },
    });
    const medium = await prisma.qualityClass.findFirstOrThrow({
      where: { code: 'medium' },
    });
    const polybet = await prisma.supplier.findFirstOrThrow({
      where: { code: 'polybet' },
    });

    const item = {
      panelTypeId: panelType.id,
      panelSizeId: panelSize.id,
      thicknessMm: 10,
      requiredAreaM2: '15.50',
      purchasePricePerM2Cny: '80',
    };

    await qualifyLeadStage1(leadId);
    await request(server)
      .post('/calculations')
      .set(authHeader(context.headToken))
      .send({
        leadId,
        items: [{ ...item, supplierId: wuya.id, qualityClassId: economy.id }],
      })
      .expect(409);

    await confirmLeadStage2(leadId, 'wuya', 'economy');

    const injected = await request(server)
      .post('/calculations')
      .set(authHeader(context.headToken))
      .send({
        leadId,
        items: [
          {
            ...item,
            supplierId: polybet.id,
            qualityClassId: medium.id,
            cnyUsdRate: '999',
            sellingCoefficient: '1',
            supplierPricePerM2: '1',
            discount: '15',
          },
        ],
      })
      .expect(400);
    expect(bodyAs<{ errorCode?: string }>(injected).errorCode).toBe(
      'COMMERCIAL_OVERRIDE_FORBIDDEN',
    );

    const calcA = await request(server)
      .post('/calculations')
      .set(authHeader(context.headToken))
      .send({ leadId, items: [item] })
      .expect(201);
    const calcABody = bodyAs<{
      id: string;
      commercialSupplierId: string;
      items: Array<{ supplierId: string; qualityClassId: string }>;
    }>(calcA);
    expect(calcABody.commercialSupplierId).toBe(wuya.id);
    expect(calcABody.items[0]?.supplierId).toBe(wuya.id);
    expect(calcABody.items[0]?.qualityClassId).toBe(economy.id);

    await request(server)
      .post(`/leads/${leadId}/commercial-qualification`)
      .set(authHeader(context.headToken))
      .send({
        supplierId: tianran.id,
        qualityClassId: medium.id,
        decisionComment: 'Switch to Tianran Medium',
      })
      .expect(201);

    const unchanged = await request(server)
      .get(`/calculations/${calcABody.id}`)
      .set(authHeader(context.headToken))
      .expect(200);
    const unchangedBody = bodyAs<{
      commercialSupplierId: string;
      items: Array<{ supplierId: string; qualityClassId: string }>;
    }>(unchanged);
    expect(unchangedBody.commercialSupplierId).toBe(wuya.id);
    expect(unchangedBody.items[0]?.supplierId).toBe(wuya.id);

    const calcB = await request(server)
      .post('/calculations')
      .set(authHeader(context.headToken))
      .send({ leadId, items: [item] })
      .expect(201);
    const calcBBody = bodyAs<{
      commercialSupplierId: string;
      items: Array<{ supplierId: string; qualityClassId: string }>;
    }>(calcB);
    expect(calcBBody.commercialSupplierId).toBe(tianran.id);
    expect(calcBBody.items[0]?.supplierId).toBe(tianran.id);
    expect(calcBBody.items[0]?.qualityClassId).toBe(medium.id);
  });

  it('BP3 rejects a new quote from a stale calculation after Stage 2 changes', async () => {
    const leadId = bodyAs<EntityResponse>(
      await request(server)
        .post('/leads')
        .set(authHeader(context.managerToken))
        .send({
          title: `BP3 stale quote ${RUN_ID}`,
          source: 'e2e',
          clientId: context.clientId,
        })
        .expect(201),
    ).id;

    const panelType = await prisma.panelType.findFirstOrThrow({
      where: { code: 'exterior_with_uv' },
    });
    const panelSize = await prisma.panelSize.findFirstOrThrow({
      where: { widthMm: 1220, heightMm: 2440 },
    });
    const wuya = await prisma.supplier.findFirstOrThrow({
      where: { code: 'wuya' },
    });
    const tianran = await prisma.supplier.findFirstOrThrow({
      where: { code: 'tianran' },
    });
    const economy = await prisma.qualityClass.findFirstOrThrow({
      where: { code: 'economy' },
    });
    const medium = await prisma.qualityClass.findFirstOrThrow({
      where: { code: 'medium' },
    });
    const item = {
      panelTypeId: panelType.id,
      panelSizeId: panelSize.id,
      thicknessMm: 10,
      requiredAreaM2: '15.50',
      purchasePricePerM2Cny: '80',
    };

    await qualifyLeadStage1(leadId);
    await confirmLeadStage2(leadId, 'wuya', 'economy');

    const calcA = await request(server)
      .post('/calculations')
      .set(authHeader(context.headToken))
      .send({ leadId, items: [item] })
      .expect(201);
    const calcAId = bodyAs<EntityResponse>(calcA).id;

    await request(server)
      .post(`/calculations/${calcAId}/finalize`)
      .set(authHeader(context.headToken))
      .expect(201);

    await confirmLeadStage2(leadId, 'wuya', 'economy');

    const commentOnly = await request(server)
      .post(`/leads/${leadId}/commercial-qualification`)
      .set(authHeader(context.headToken))
      .send({
        supplierId: wuya.id,
        qualityClassId: economy.id,
        decisionComment: 'Comment only, same commercial decision',
      })
      .expect(201);
    expect(
      new Date(
        bodyAs<{ confirmedAt: string }>(commentOnly).confirmedAt,
      ).getTime(),
    ).toBe(
      new Date(
        bodyAs<{ commercialConfirmedAt: string }>(calcA).commercialConfirmedAt,
      ).getTime(),
    );

    const calcAAfterComment = await prisma.calculationSession.findUniqueOrThrow(
      {
        where: { id: calcAId },
        select: {
          commercialSupplierId: true,
          commercialQualityClassId: true,
          commercialConfirmedAt: true,
          totalAmount: true,
        },
      },
    );
    expect(calcAAfterComment.commercialSupplierId).toBe(wuya.id);
    expect(calcAAfterComment.commercialQualityClassId).toBe(economy.id);

    const quoteA = await request(server)
      .post(`/calculations/${calcAId}/convert-to-quote`)
      .set(authHeader(context.headToken))
      .send({ clientComment: 'From current Stage 2 A' })
      .expect(201);
    const quoteABody = bodyAs<{
      id: string;
      status: string;
      totalAmount: string;
      items: Array<{ supplierCode: string; qualityClassCode: string }>;
    }>(quoteA);
    expect(quoteABody.status).toBe('draft');
    expect(quoteABody.items[0]?.supplierCode).toBe('wuya');
    expect(quoteABody.items[0]?.qualityClassCode).toBe('economy');

    await request(server)
      .post(`/leads/${leadId}/commercial-qualification`)
      .set(authHeader(context.headToken))
      .send({
        supplierId: tianran.id,
        qualityClassId: medium.id,
        decisionComment: 'Switch to Tianran Medium',
      })
      .expect(201);

    const historicalCalc = await request(server)
      .get(`/calculations/${calcAId}`)
      .set(authHeader(context.headToken))
      .expect(200);
    expect(
      bodyAs<{ commercialSupplierId: string }>(historicalCalc)
        .commercialSupplierId,
    ).toBe(wuya.id);

    const historicalQuote = await request(server)
      .get(`/quotes/${quoteABody.id}`)
      .set(authHeader(context.headToken))
      .expect(200);
    const historicalQuoteBody = bodyAs<{
      id: string;
      status: string;
      totalAmount: string;
      items: Array<{ supplierCode: string; qualityClassCode: string }>;
    }>(historicalQuote);
    expect(historicalQuoteBody.id).toBe(quoteABody.id);
    expect(historicalQuoteBody.status).toBe('draft');
    expect(historicalQuoteBody.totalAmount).toBe(quoteABody.totalAmount);
    expect(historicalQuoteBody.items[0]?.supplierCode).toBe('wuya');
    expect(historicalQuoteBody.items[0]?.qualityClassCode).toBe('economy');

    const staleExisting = await request(server)
      .post(`/calculations/${calcAId}/convert-to-quote`)
      .set(authHeader(context.headToken))
      .send({ clientComment: 'must not mutate historical quote' })
      .expect(409);
    expect(bodyAs<{ errorCode?: string }>(staleExisting).errorCode).toBe(
      'COMMERCIAL_QUALIFICATION_CHANGED',
    );
    expect(
      await prisma.panelQuote.count({ where: { calculationId: calcAId } }),
    ).toBe(1);

    const staleCalcLead = await request(server)
      .post('/leads')
      .set(authHeader(context.managerToken))
      .send({
        title: `BP3 stale calc no quote ${RUN_ID}`,
        source: 'e2e',
        clientId: context.clientId,
      })
      .expect(201);
    const staleLeadId = bodyAs<EntityResponse>(staleCalcLead).id;
    await qualifyLeadStage1(staleLeadId);
    await confirmLeadStage2(staleLeadId, 'wuya', 'economy');
    const staleCalc = await request(server)
      .post('/calculations')
      .set(authHeader(context.headToken))
      .send({ leadId: staleLeadId, items: [item] })
      .expect(201);
    const staleCalcId = bodyAs<EntityResponse>(staleCalc).id;
    await request(server)
      .post(`/calculations/${staleCalcId}/finalize`)
      .set(authHeader(context.headToken))
      .expect(201);

    await request(server)
      .post(`/leads/${staleLeadId}/commercial-qualification`)
      .set(authHeader(context.headToken))
      .send({
        supplierId: tianran.id,
        qualityClassId: medium.id,
      })
      .expect(201);

    const rejected = await request(server)
      .post(`/calculations/${staleCalcId}/convert-to-quote`)
      .set(authHeader(context.headToken))
      .send({ clientComment: 'must not use superseded calc' })
      .expect(409);
    expect(bodyAs<{ errorCode?: string }>(rejected).errorCode).toBe(
      'COMMERCIAL_QUALIFICATION_CHANGED',
    );
    expect(
      await prisma.panelQuote.count({ where: { calculationId: staleCalcId } }),
    ).toBe(0);

    const calcB = await request(server)
      .post('/calculations')
      .set(authHeader(context.headToken))
      .send({ leadId: staleLeadId, items: [item] })
      .expect(201);
    const calcBId = bodyAs<EntityResponse>(calcB).id;
    await request(server)
      .post(`/calculations/${calcBId}/finalize`)
      .set(authHeader(context.headToken))
      .expect(201);
    const quoteB = await request(server)
      .post(`/calculations/${calcBId}/convert-to-quote`)
      .set(authHeader(context.headToken))
      .send({ clientComment: 'From current Stage 2 B' })
      .expect(201);
    expect(
      bodyAs<{ items: Array<{ supplierCode: string }> }>(quoteB).items[0]
        ?.supplierCode,
    ).toBe('tianran');
  });

  it('BP3 completes the Stage-2 handoff task and notifies the owner', async () => {
    const leadId = bodyAs<EntityResponse>(
      await request(server)
        .post('/leads')
        .set(authHeader(context.managerToken))
        .send({
          title: `BP3 task ${RUN_ID}`,
          source: 'e2e',
          clientId: context.clientId,
        })
        .expect(201),
    ).id;
    await qualifyLeadStage1(leadId);

    const openTask = await prisma.task.findFirstOrThrow({
      where: {
        relatedType: 'Lead',
        relatedId: leadId,
        title: { startsWith: 'Stage 2 commercial qualification:' },
      },
    });
    expect(openTask.status).toBe(TaskStatus.PENDING);
    expect(openTask.assigneeId).toBe(context.headId);

    await confirmLeadStage2(leadId);
    await confirmLeadStage2(leadId);

    const tasks = await prisma.task.findMany({
      where: {
        relatedType: 'Lead',
        relatedId: leadId,
        title: { startsWith: 'Stage 2 commercial qualification:' },
      },
    });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.status).toBe(TaskStatus.COMPLETED);
    expect(tasks[0]?.result).toContain('Stage-2 commercial qualification');

    const ownerNotes = await prisma.notification.findMany({
      where: {
        userId: context.managerId,
        relatedId: leadId,
        type: 'lead_commercially_qualified',
      },
    });
    expect(ownerNotes).toHaveLength(1);
  });

  it('AT-04 syncs deal nextActionAt with nearest open task', async () => {
    const deal = await createDeal(prisma, context);
    const laterDueDate = futureDate(5);
    const nearestDueDate = futureDate(1);

    await prisma.task.createMany({
      data: [
        {
          title: `Later action ${RUN_ID}`,
          type: TaskType.CALL,
          priority: TaskPriority.MEDIUM,
          dueDate: laterDueDate,
          originalDueDate: laterDueDate,
          assigneeId: context.managerId,
          createdById: context.managerId,
          relatedType: 'Deal',
          relatedId: deal.id,
        },
        {
          title: `Nearest action ${RUN_ID}`,
          type: TaskType.CALL,
          priority: TaskPriority.HIGH,
          dueDate: nearestDueDate,
          originalDueDate: nearestDueDate,
          assigneeId: context.managerId,
          createdById: context.managerId,
          relatedType: 'Deal',
          relatedId: deal.id,
        },
      ],
    });

    await request(server)
      .post(`/deals/${deal.id}/stage`)
      .set(authHeader(context.managerToken))
      .send({
        newStage: DealStage.HPL_SELECTION,
        reason: 'Move to selection',
      })
      .expect(201);
    const updatedDeal = await prisma.deal.findUniqueOrThrow({
      where: { id: deal.id },
      select: { nextActionAt: true },
    });

    expect(updatedDeal.nextActionAt?.getTime()).toBe(nearestDueDate.getTime());
  });

  it('AT-05 escalates critical overdue task to assignee manager', async () => {
    const dueDate = new Date(Date.now() - 25 * 60 * 60 * 1000);
    const task = await prisma.task.create({
      data: {
        title: `Critical overdue ${RUN_ID}`,
        type: TaskType.CALL,
        priority: TaskPriority.URGENT,
        dueDate,
        originalDueDate: dueDate,
        assigneeId: context.managerId,
        createdById: context.headId,
        relatedType: 'Client',
        relatedId: context.clientId,
      },
    });

    await tasksCronService.escalateCriticalOverdues();
    const notification = await prisma.notification.findFirst({
      where: {
        taskId: task.id,
        userId: context.headId,
        type: 'TASK_CRITICAL_OVERDUE',
      },
    });

    expect(notification).not.toBeNull();
  });

  it('AT-06 requires reschedule reason and writes reschedule history', async () => {
    const task = await prisma.task.create({
      data: {
        title: `Reschedule discipline ${RUN_ID}`,
        type: TaskType.CALL,
        priority: TaskPriority.MEDIUM,
        dueDate: futureDate(1),
        originalDueDate: futureDate(1),
        assigneeId: context.managerId,
        createdById: context.managerId,
        relatedType: 'Client',
        relatedId: context.clientId,
      },
    });

    await request(server)
      .post(`/tasks/${task.id}/reschedule`)
      .set(authHeader(context.managerToken))
      .send({ newDueDate: futureIso(3) })
      .expect(400);

    const response = await request(server)
      .post(`/tasks/${task.id}/reschedule`)
      .set(authHeader(context.managerToken))
      .send({
        newDueDate: futureIso(3),
        reason: 'Client requested new contact date',
      })
      .expect(201);
    const updatedTask = bodyAs<{ rescheduleCount: number }>(response);
    const historyCount = await prisma.taskRescheduleHistory.count({
      where: { taskId: task.id },
    });

    expect(updatedTask.rescheduleCount).toBe(1);
    expect(historyCount).toBe(1);
  });

  it('AT-07 calculates deal item m2 and total price from product sheet area', async () => {
    const deal = await createDeal(prisma, context);

    const response = await request(server)
      .post(`/deals/${deal.id}/items`)
      .set(authHeader(context.headToken))
      .send({
        items: [
          {
            productId: context.productId,
            quantitySheets: 2,
            quantityM2: 999,
            unitPrice: 100,
            discount: 10,
          },
        ],
      })
      .expect(201);
    const body = bodyAs<DealResponse>(response);
    const item = body.items?.[0];
    const expectedQuantityM2 = context.sheetArea * 2;
    const expectedTotal = expectedQuantityM2 * 100 - 10;

    expect(item).toBeDefined();
    expect(item?.quantityM2).toBeCloseTo(expectedQuantityM2, 5);
    expect(Number(item?.totalPrice)).toBeCloseTo(expectedTotal, 2);
  });

  it('AT-08 creates order only from WON deal and reserves stock', async () => {
    const notWonDeal = await createDeal(prisma, context);

    await request(server)
      .post('/orders/from-deal')
      .set(authHeader(context.managerToken))
      .send({
        dealId: notWonDeal.id,
        deliveryAddress: 'Test warehouse',
      })
      .expect(400);

    const wonDeal = await createDeal(prisma, context, DealStage.WON);

    const response = await request(server)
      .post('/orders/from-deal')
      .set(authHeader(context.managerToken))
      .send({
        dealId: wonDeal.id,
        deliveryAddress: 'Test warehouse',
      })
      .expect(201);
    const order = bodyAs<OrderResponse>(response);
    const reservation = await prisma.stockReservation.findFirst({
      where: { orderId: order.id, productId: context.productId },
    });

    expect(reservation).not.toBeNull();
    expect(reservation?.quantity).toBeCloseTo(context.sheetArea * 2, 5);
  });

  it('requires an authoritative fulfillment source before Order creation', async () => {
    const deal = await createDeal(prisma, context, DealStage.WON);
    await prisma.deal.update({
      where: { id: deal.id },
      data: { fulfillmentSource: null },
    });

    const response = await request(server)
      .post('/orders/from-deal')
      .set(authHeader(context.managerToken))
      .send({ dealId: deal.id })
      .expect(409);

    expect(response.body).toMatchObject({
      errorCode: 'FULFILLMENT_SOURCE_REQUIRED',
    });
    expect(await prisma.order.count({ where: { dealId: deal.id } })).toBe(0);
    expect(
      await prisma.stockReservation.count({
        where: { order: { dealId: deal.id } },
      }),
    ).toBe(0);
  });

  it('creates a supplier client Order without warehouse reservation', async () => {
    const deal = await createDeal(prisma, context, DealStage.WON);
    await prisma.deal.update({
      where: { id: deal.id },
      data: { fulfillmentSource: FulfillmentSource.SUPPLIER_ORDER },
    });

    const response = await request(server)
      .post('/orders/from-deal')
      .set(authHeader(context.managerToken))
      .send({ dealId: deal.id })
      .expect(201);
    const order = bodyAs<OrderResponse>(response);

    expect(order.status).toBe(OrderStatus.PENDING_SUPPLIER);
    expect(
      await prisma.stockReservation.count({ where: { orderId: order.id } }),
    ).toBe(0);
  });

  it('AT-09 recalculates order paid amount, remaining amount and payment status', async () => {
    const wonDeal = await createDeal(prisma, context, DealStage.WON);
    const orderResponse = await request(server)
      .post('/orders/from-deal')
      .set(authHeader(context.managerToken))
      .send({ dealId: wonDeal.id })
      .expect(201);
    const order = bodyAs<OrderResponse>(orderResponse);
    const totalAmount = Number(order.totalAmount);
    const firstAmount = totalAmount / 2;
    const secondAmount = totalAmount - firstAmount;

    const firstPayment = await createPayment(order.id, firstAmount);
    const firstConfirmation = await request(server)
      .patch(`/orders/payments/${firstPayment.id}/confirm`)
      .set(authHeader(context.accountantToken))
      .send({ status: PaymentRecordStatus.CONFIRMED })
      .expect(200);
    const partiallyPaidOrder = bodyAs<OrderResponse>(firstConfirmation);

    expect(Number(partiallyPaidOrder.paidAmount)).toBeCloseTo(firstAmount, 2);
    expect(Number(partiallyPaidOrder.remainingAmount)).toBeCloseTo(
      secondAmount,
      2,
    );
    expect(partiallyPaidOrder.paymentStatus).toBe(PaymentStatus.PARTIALLY_PAID);

    const secondPayment = await createPayment(order.id, secondAmount);
    const secondConfirmation = await request(server)
      .patch(`/orders/payments/${secondPayment.id}/confirm`)
      .set(authHeader(context.accountantToken))
      .send({ status: PaymentRecordStatus.CONFIRMED })
      .expect(200);
    const paidOrder = bodyAs<OrderResponse>(secondConfirmation);

    expect(Number(paidOrder.paidAmount)).toBeCloseTo(totalAmount, 2);
    expect(Number(paidOrder.remainingAmount)).toBe(0);
    expect(paidOrder.paymentStatus).toBe(PaymentStatus.PAID);
  });

  it('AT-14 rejects payment confirmation that exceeds order total', async () => {
    const wonDeal = await createDeal(prisma, context, DealStage.WON);
    const orderResponse = await request(server)
      .post('/orders/from-deal')
      .set(authHeader(context.managerToken))
      .send({ dealId: wonDeal.id })
      .expect(201);
    const order = bodyAs<OrderResponse>(orderResponse);
    const totalAmount = Number(order.totalAmount);

    const firstPayment = await createPayment(order.id, totalAmount - 20);
    await request(server)
      .patch(`/orders/payments/${firstPayment.id}/confirm`)
      .set(authHeader(context.accountantToken))
      .send({ status: PaymentRecordStatus.CONFIRMED })
      .expect(200);

    const secondPayment = await createPayment(order.id, totalAmount / 2);
    await request(server)
      .patch(`/orders/payments/${secondPayment.id}/confirm`)
      .set(authHeader(context.accountantToken))
      .send({ status: PaymentRecordStatus.CONFIRMED })
      .expect(409);

    const orderAfter = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
    });

    expect(Number(orderAfter.paidAmount)).toBeCloseTo(totalAmount - 20, 2);
    expect(orderAfter.paymentStatus).toBe(PaymentStatus.PARTIALLY_PAID);

    const rejectedPayment = await prisma.payment.findUniqueOrThrow({
      where: { id: secondPayment.id },
    });

    expect(rejectedPayment.status).toBe(PaymentRecordStatus.PENDING);
  });

  it('AT-10 requires lead disqualification reason and deal loss reason', async () => {
    const leadResponse = await request(server)
      .post('/leads')
      .set(authHeader(context.managerToken))
      .send({
        title: `Disqualify lead ${RUN_ID}`,
        source: 'phone',
      })
      .expect(201);
    const lead = bodyAs<LeadResponse>(leadResponse);
    const deal = await createDeal(prisma, context);

    await request(server)
      .post(`/leads/${lead.id}/disqualify`)
      .set(authHeader(context.managerToken))
      .send({})
      .expect(400);

    await request(server)
      .post(`/deals/${deal.id}/stage`)
      .set(authHeader(context.managerToken))
      .send({ newStage: DealStage.LOST })
      .expect(400);
  });

  it('AT-11 hides margin and purchase price snapshots from manager without purchase permission', async () => {
    const deal = await createDeal(prisma, context);

    const response = await request(server)
      .get(`/deals/${deal.id}`)
      .set(authHeader(context.managerToken))
      .expect(200);
    const rawBody = JSON.stringify(response.body as unknown);

    expect(rawBody).not.toContain('purchasePriceSnapshot');
    expect(rawBody).not.toContain('margin');
  });

  it('AT-12 allows manager exception only with flag, reason and permission', async () => {
    const deal = await createDeal(prisma, context, DealStage.QUALIFICATION, []);

    await request(server)
      .post(`/deals/${deal.id}/stage`)
      .set(authHeader(context.headToken))
      .send({
        newStage: DealStage.OFFER_PREPARATION,
        reason: 'Manual approval without flag must be rejected',
      })
      .expect(400);

    await request(server)
      .post(`/deals/${deal.id}/stage`)
      .set(authHeader(context.headToken))
      .send({
        newStage: DealStage.OFFER_PREPARATION,
        reason: 'Head approved empty item list exception',
        isException: true,
      })
      .expect(201);

    const history = await prisma.dealStageHistory.findFirstOrThrow({
      where: {
        dealId: deal.id,
        newStage: DealStage.OFFER_PREPARATION,
      },
      orderBy: { createdAt: 'desc' },
    });

    expect(history.isException).toBe(true);
    expect(history.approvedById).toBe(context.headId);
  });

  it('AT-13 writes activity or audit record after stage change and payment confirmation', async () => {
    const deal = await createDeal(prisma, context);

    await request(server)
      .post(`/deals/${deal.id}/stage`)
      .set(authHeader(context.managerToken))
      .send({
        newStage: DealStage.HPL_SELECTION,
        reason: 'Acceptance audit check',
      })
      .expect(201);

    const stageActivity = await prisma.activity.findFirst({
      where: {
        relatedType: 'Deal',
        relatedId: deal.id,
        type: ActivityType.STAGE_CHANGED,
      },
    });
    const stageAudit = await prisma.auditLog.findFirst({
      where: {
        entityType: 'Deal',
        entityId: deal.id,
        action: 'DEAL_STAGE_CHANGED',
      },
    });

    expect(stageActivity ?? stageAudit).not.toBeNull();

    const wonDeal = await createDeal(prisma, context, DealStage.WON);
    const orderResponse = await request(server)
      .post('/orders/from-deal')
      .set(authHeader(context.managerToken))
      .send({ dealId: wonDeal.id })
      .expect(201);
    const order = bodyAs<OrderResponse>(orderResponse);
    const totalAmountValue =
      typeof order.totalAmount === 'number'
        ? order.totalAmount
        : Number(order.totalAmount?.toString?.() ?? 0);
    const payment = await createPayment(order.id, totalAmountValue);

    await request(server)
      .patch(`/orders/payments/${payment.id}/confirm`)
      .set(authHeader(context.accountantToken))
      .send({ status: PaymentRecordStatus.CONFIRMED })
      .expect(200);

    const paymentActivity = await prisma.activity.findFirst({
      where: {
        relatedType: 'Order',
        relatedId: order.id,
        type: ActivityType.PAYMENT_RECEIVED,
      },
    });
    const paymentAudit = await prisma.auditLog.findFirst({
      where: {
        entityType: 'Payment',
        entityId: payment.id,
        action: 'PAYMENT_STATUS_CHANGED',
      },
    });

    expect(paymentActivity ?? paymentAudit).not.toBeNull();
  });

  it('AT-15 cancels order, releases reservation and restores stock balance', async () => {
    const wonDeal = await createDeal(prisma, context, DealStage.WON);
    const orderResponse = await request(server)
      .post('/orders/from-deal')
      .set(authHeader(context.managerToken))
      .send({ dealId: wonDeal.id })
      .expect(201);
    const order = bodyAs<OrderResponse>(orderResponse);

    const balanceBefore = await prisma.stockBalance.findUniqueOrThrow({
      where: { productId: context.productId },
    });

    await request(server)
      .post(`/orders/${order.id}/cancel`)
      .set(authHeader(context.managerToken))
      .expect(200);

    const orderAfter = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
    });
    const reservation = await prisma.stockReservation.findFirstOrThrow({
      where: { orderId: order.id, productId: context.productId },
    });
    const balanceAfter = await prisma.stockBalance.findUniqueOrThrow({
      where: { productId: context.productId },
    });

    const reservedQuantity = context.sheetArea * 2;
    expect(orderAfter.status).toBe(OrderStatus.CANCELLED);
    expect(reservation.status).toBe(StockReservationStatus.RELEASED);
    expect(reservation.expiresAt).not.toBeNull();
    expect(balanceAfter.reserved).toBeCloseTo(
      balanceBefore.reserved - reservedQuantity,
      5,
    );
    expect(balanceAfter.available).toBeCloseTo(
      balanceBefore.available + reservedQuantity,
      5,
    );
    expect(balanceAfter.version).toBeGreaterThan(balanceBefore.version);

    // Повторная отмена — 409 (заказ уже в терминальном статусе)
    await request(server)
      .post(`/orders/${order.id}/cancel`)
      .set(authHeader(context.managerToken))
      .expect(409);
  });

  it('AT-16 rejects payment confirmation and delivery for cancelled order', async () => {
    const wonDeal = await createDeal(prisma, context, DealStage.WON);
    const orderResponse = await request(server)
      .post('/orders/from-deal')
      .set(authHeader(context.managerToken))
      .send({ dealId: wonDeal.id })
      .expect(201);
    const order = bodyAs<OrderResponse>(orderResponse);
    const payment = await createPayment(order.id, 10);

    await request(server)
      .post(`/orders/${order.id}/cancel`)
      .set(authHeader(context.managerToken))
      .expect(200);

    await request(server)
      .patch(`/orders/payments/${payment.id}/confirm`)
      .set(authHeader(context.accountantToken))
      .send({ status: PaymentRecordStatus.CONFIRMED })
      .expect(409);

    const orderItem = await prisma.orderItem.findFirstOrThrow({
      where: { orderId: order.id },
    });

    await request(server)
      .post(`/orders/${order.id}/deliveries`)
      .set(authHeader(context.managerToken))
      .send({
        orderId: order.id,
        deliveryDate: new Date().toISOString(),
        items: [{ orderItemId: orderItem.id, quantity: 1 }],
      })
      .expect(409);
  });

  it('P0-A denies delivery when order is UNPAID', async () => {
    const order = await createWonOrder();
    const orderItem = await prisma.orderItem.findFirstOrThrow({
      where: { orderId: order.id },
    });
    const balanceBefore = await prisma.stockBalance.findUniqueOrThrow({
      where: { productId: context.productId },
    });

    const response = await request(server)
      .post(`/orders/${order.id}/deliveries`)
      .set(authHeader(context.managerToken))
      .send(deliveryPayload(order.id, orderItem.id, orderItem.quantity))
      .expect(409);

    expect(response.body).toEqual(
      expect.objectContaining({
        message: SHIPMENT_PAYMENT_NOT_CONFIRMED_MESSAGE,
      }),
    );

    const deliveries = await prisma.delivery.count({
      where: { orderId: order.id },
    });
    const balanceAfter = await prisma.stockBalance.findUniqueOrThrow({
      where: { productId: context.productId },
    });
    expect(deliveries).toBe(0);
    expect(balanceAfter.onHand).toBe(balanceBefore.onHand);
    expect(balanceAfter.reserved).toBe(balanceBefore.reserved);
  });

  it('P0-A denies delivery when order is PARTIALLY_PAID', async () => {
    const order = await createWonOrder();
    const half = Number(order.totalAmount) / 2;
    const payment = await createPayment(order.id, half);
    await request(server)
      .patch(`/orders/payments/${payment.id}/confirm`)
      .set(authHeader(context.accountantToken))
      .send({ status: PaymentRecordStatus.CONFIRMED })
      .expect(200);

    const paid = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
    });
    expect(paid.paymentStatus).toBe(PaymentStatus.PARTIALLY_PAID);

    const orderItem = await prisma.orderItem.findFirstOrThrow({
      where: { orderId: order.id },
    });

    await request(server)
      .post(`/orders/${order.id}/deliveries`)
      .set(authHeader(context.managerToken))
      .send(deliveryPayload(order.id, orderItem.id, orderItem.quantity))
      .expect(409);

    expect(await prisma.delivery.count({ where: { orderId: order.id } })).toBe(
      0,
    );
  });

  it('P0-A allows delivery when order is PAID', async () => {
    const order = await createWonOrder();
    await payOrderInFull(order.id, order.totalAmount);
    const orderItem = await prisma.orderItem.findFirstOrThrow({
      where: { orderId: order.id },
    });

    await request(server)
      .post(`/orders/${order.id}/deliveries`)
      .set(authHeader(context.managerToken))
      .send(deliveryPayload(order.id, orderItem.id, orderItem.quantity))
      .expect(201);

    const delivered = await prisma.orderItem.findFirstOrThrow({
      where: { id: orderItem.id },
    });
    expect(delivered.deliveredQuantity).toBeCloseTo(orderItem.quantity, 5);
  });

  it('P0-B denies supplier-order SHIPPED when client order is UNPAID', async () => {
    const order = await createWonOrder();
    const supplier = await prisma.supplier.findUniqueOrThrow({
      where: { code: `QA-SUP-${RUN_ID}` },
    });
    const supplierOrder = await prisma.supplierOrder.create({
      data: {
        dealId: order.dealId,
        supplierId: supplier.id,
        status: SupplierOrderStatus.DRAFT,
      },
    });

    await request(server)
      .patch(`/supplier-orders/${supplierOrder.id}/status`)
      .set(authHeader(context.managerToken))
      .send({ status: SupplierOrderStatus.SHIPPED })
      .expect(403);

    await request(server)
      .post(`/supplier-orders/${supplierOrder.id}/confirm-ready`)
      .set(authHeader(context.headToken))
      .expect(200);

    const response = await request(server)
      .patch(`/supplier-orders/${supplierOrder.id}/status`)
      .set(authHeader(context.headToken))
      .send({ status: SupplierOrderStatus.SHIPPED })
      .expect(409);

    expect(response.body).toEqual(
      expect.objectContaining({
        message: SHIPMENT_PAYMENT_NOT_CONFIRMED_MESSAGE,
      }),
    );

    const unchanged = await prisma.supplierOrder.findUniqueOrThrow({
      where: { id: supplierOrder.id },
    });
    expect(unchanged.status).toBe(SupplierOrderStatus.READY_FOR_SHIPMENT);
  });

  it('P0-C does not write off stock for unpaid orders via inventory receive', async () => {
    const order = await createWonOrder();
    const balanceBefore = await prisma.stockBalance.findUniqueOrThrow({
      where: { productId: context.productId },
    });
    const supplier = await prisma.supplier.findUniqueOrThrow({
      where: { code: `QA-SUP-${RUN_ID}` },
    });

    const receiptResponse = await request(server)
      .post('/inventory/expected-receipts')
      .set(authHeader(context.headToken))
      .send({
        supplierId: supplier.id,
        expectedDate: new Date().toISOString(),
        items: [{ productId: context.productId, quantity: 10 }],
      })
      .expect(201);
    const receipt = bodyAs<EntityResponse & { items: EntityResponse[] }>(
      receiptResponse,
    );

    await request(server)
      .post(`/inventory/expected-receipts/${receipt.id}/receive`)
      .set(authHeader(context.storekeeperToken))
      .send({
        items: [{ itemId: receipt.items[0].id, receivedQuantity: 10 }],
      })
      .expect(201);

    const balanceAfter = await prisma.stockBalance.findUniqueOrThrow({
      where: { productId: context.productId },
    });
    expect(balanceAfter.onHand).toBeGreaterThan(balanceBefore.onHand);
    expect(await prisma.delivery.count({ where: { orderId: order.id } })).toBe(
      0,
    );
    const unpaid = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
    });
    expect(unpaid.paymentStatus).toBe(PaymentStatus.UNPAID);
  });

  it('P0-A rejects concurrent full deliveries without duplicate shipment or negative stock', async () => {
    const order = await createWonOrder();
    await payOrderInFull(order.id, order.totalAmount);
    const orderItem = await prisma.orderItem.findFirstOrThrow({
      where: { orderId: order.id },
    });
    const balanceBefore = await prisma.stockBalance.findUniqueOrThrow({
      where: { productId: context.productId },
    });

    const payload = deliveryPayload(order.id, orderItem.id, orderItem.quantity);
    const results = await Promise.all([
      request(server)
        .post(`/orders/${order.id}/deliveries`)
        .set(authHeader(context.managerToken))
        .send(payload),
      request(server)
        .post(`/orders/${order.id}/deliveries`)
        .set(authHeader(context.managerToken))
        .send(payload),
    ]);

    const statuses = results.map((result) => result.status);
    expect(statuses.filter((status) => status === 201)).toHaveLength(1);
    expect(
      statuses.filter((status) => status === 400 || status === 409),
    ).toHaveLength(1);

    const deliveredItem = await prisma.orderItem.findFirstOrThrow({
      where: { id: orderItem.id },
    });
    expect(deliveredItem.deliveredQuantity).toBeLessThanOrEqual(
      orderItem.quantity,
    );
    expect(deliveredItem.deliveredQuantity).toBeCloseTo(orderItem.quantity, 5);

    const deliveryCount = await prisma.delivery.count({
      where: { orderId: order.id },
    });
    expect(deliveryCount).toBe(1);

    const balanceAfter = await prisma.stockBalance.findUniqueOrThrow({
      where: { productId: context.productId },
    });
    expect(balanceAfter.onHand).toBeGreaterThanOrEqual(0);
    expect(balanceAfter.onHand).toBeCloseTo(
      balanceBefore.onHand - orderItem.quantity,
      5,
    );
  });

  it('P0-A keeps shipment side effects off when payment confirmation fails', async () => {
    const order = await createWonOrder();
    const balanceBefore = await prisma.stockBalance.findUniqueOrThrow({
      where: { productId: context.productId },
    });
    const overpay = await createPayment(
      order.id,
      Number(order.totalAmount) + 50,
    );

    await request(server)
      .patch(`/orders/payments/${overpay.id}/confirm`)
      .set(authHeader(context.accountantToken))
      .send({ status: PaymentRecordStatus.CONFIRMED })
      .expect(409);

    const stillUnpaid = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
    });
    expect(stillUnpaid.paymentStatus).toBe(PaymentStatus.UNPAID);

    const orderItem = await prisma.orderItem.findFirstOrThrow({
      where: { orderId: order.id },
    });
    await request(server)
      .post(`/orders/${order.id}/deliveries`)
      .set(authHeader(context.managerToken))
      .send(deliveryPayload(order.id, orderItem.id, orderItem.quantity))
      .expect(409);

    expect(await prisma.delivery.count({ where: { orderId: order.id } })).toBe(
      0,
    );
    const balanceAfter = await prisma.stockBalance.findUniqueOrThrow({
      where: { productId: context.productId },
    });
    expect(balanceAfter.onHand).toBe(balanceBefore.onHand);
    expect(balanceAfter.reserved).toBe(balanceBefore.reserved);
  });

  it('AT-17 releases expired reservation and returns order to WAITING_STOCK', async () => {
    const wonDeal = await createDeal(prisma, context, DealStage.WON);
    const orderResponse = await request(server)
      .post('/orders/from-deal')
      .set(authHeader(context.managerToken))
      .send({ dealId: wonDeal.id })
      .expect(201);
    const order = bodyAs<OrderResponse>(orderResponse);

    const balanceBefore = await prisma.stockBalance.findUniqueOrThrow({
      where: { productId: context.productId },
    });

    // Эмулируем истечение TTL: переносим expiresAt в прошлое
    await prisma.stockReservation.updateMany({
      where: { orderId: order.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const inventoryService = app.get(InventoryService);
    const releasedCount = await inventoryService.releaseExpiredReservations();

    expect(releasedCount).toBeGreaterThan(0);

    const orderAfter = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
    });
    const reservation = await prisma.stockReservation.findFirstOrThrow({
      where: { orderId: order.id, productId: context.productId },
    });
    const balanceAfter = await prisma.stockBalance.findUniqueOrThrow({
      where: { productId: context.productId },
    });

    const reservedQuantity = context.sheetArea * 2;
    expect(orderAfter.status).toBe(OrderStatus.WAITING_STOCK);
    expect(reservation.status).toBe(StockReservationStatus.RELEASED);
    expect(balanceAfter.reserved).toBeCloseTo(
      balanceBefore.reserved - reservedQuantity,
      5,
    );
    expect(balanceAfter.available).toBeCloseTo(
      balanceBefore.available + reservedQuantity,
      5,
    );
  });

  it('AT-18 re-reserves WAITING_STOCK order when receipt arrives (FIFO)', async () => {
    const brand = await prisma.brand.findUniqueOrThrow({
      where: { code: `QA-BRAND-${RUN_ID}` },
    });
    const collection = await prisma.productCollection.findFirstOrThrow({
      where: { brandId: brand.id, name: `QA Collection ${RUN_ID}` },
    });
    const supplier = await prisma.supplier.findUniqueOrThrow({
      where: { code: `QA-SUP-${RUN_ID}` },
    });

    // Отдельный продукт без остатка: заказ обязан уйти в WAITING_STOCK
    const product = await prisma.product.create({
      data: {
        sku: `QA-HPL-WAIT-${RUN_ID}`,
        name: `QA HPL Waiting Panel ${RUN_ID}`,
        brandId: brand.id,
        collectionId: collection.id,
        supplierId: supplier.id,
        decorCode: `QA-WAIT-${RUN_ID}`,
        colorName: 'Black',
        surface: 'Matte',
        thickness: 12,
        length: 3050,
        width: 1300,
        sheetArea: context.sheetArea,
        unit: 'm2',
        status: ProductStatus.ACTIVE,
      },
    });

    const wonDeal = await createDeal(prisma, context, DealStage.WON, [
      {
        product: { connect: { id: product.id } },
        quantitySheets: 2,
        quantityM2: context.sheetArea * 2,
        unitPrice: new Prisma.Decimal(100),
        discount: new Prisma.Decimal(0),
        totalPrice: new Prisma.Decimal(context.sheetArea * 2 * 100),
        purchasePriceSnapshot: new Prisma.Decimal(60),
      },
    ]);

    const orderResponse = await request(server)
      .post('/orders/from-deal')
      .set(authHeader(context.managerToken))
      .send({ dealId: wonDeal.id })
      .expect(201);
    const order = bodyAs<OrderResponse>(orderResponse);

    const waitingOrder = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
    });
    expect(waitingOrder.status).toBe(OrderStatus.WAITING_STOCK);

    const receiptResponse = await request(server)
      .post('/inventory/expected-receipts')
      .set(authHeader(context.headToken))
      .send({
        supplierId: supplier.id,
        expectedDate: futureIso(1),
        items: [{ productId: product.id, quantity: 10 }],
      })
      .expect(201);
    const receipt = bodyAs<EntityResponse & { items: EntityResponse[] }>(
      receiptResponse,
    );

    await request(server)
      .post(`/inventory/expected-receipts/${receipt.id}/receive`)
      .set(authHeader(context.storekeeperToken))
      .send({
        items: [{ itemId: receipt.items[0].id, receivedQuantity: 10 }],
      })
      .expect(201);

    const orderAfter = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
    });
    const reservation = await prisma.stockReservation.findFirstOrThrow({
      where: { orderId: order.id, productId: product.id },
    });
    const balance = await prisma.stockBalance.findUniqueOrThrow({
      where: { productId: product.id },
    });

    expect(orderAfter.status).toBe(OrderStatus.WAITING_PAYMENT);
    expect(reservation.status).toBe(StockReservationStatus.ACTIVE);
    expect(reservation.expiresAt).not.toBeNull();
    expect(balance.reserved).toBeCloseTo(context.sheetArea * 2, 5);
    expect(balance.available).toBeCloseTo(10 - context.sheetArea * 2, 5);
  });

  it('AT-19 enforces deal stage matrix and terminal override permission', async () => {
    // Недопустимый переход (skip стадии) без исключения → 400
    const deal = await createDeal(prisma, context, DealStage.QUALIFICATION);

    await request(server)
      .post(`/deals/${deal.id}/stage`)
      .set(authHeader(context.managerToken))
      .send({ newStage: DealStage.NEGOTIATION, reason: 'Skip stages' })
      .expect(400);

    // Выход из терминальной WON без deals:override_terminal → 403
    const wonDeal = await createDeal(prisma, context, DealStage.WON);

    await request(server)
      .post(`/deals/${wonDeal.id}/stage`)
      .set(authHeader(context.managerToken))
      .send({ newStage: DealStage.QUALIFICATION, reason: 'Manager reopen' })
      .expect(403);

    // Выход из терминальной без причины → 400 даже для head
    await request(server)
      .post(`/deals/${wonDeal.id}/stage`)
      .set(authHeader(context.headToken))
      .send({ newStage: DealStage.QUALIFICATION })
      .expect(400);

    // Руководитель с deals:override_terminal + причина → 201, флаг исключения
    await request(server)
      .post(`/deals/${wonDeal.id}/stage`)
      .set(authHeader(context.headToken))
      .send({
        newStage: DealStage.QUALIFICATION,
        reason: 'Client returned after contract restart',
      })
      .expect(201);

    const history = await prisma.dealStageHistory.findFirstOrThrow({
      where: {
        dealId: wonDeal.id,
        oldStage: DealStage.WON,
        newStage: DealStage.QUALIFICATION,
      },
    });

    expect(history.isException).toBe(true);
    expect(history.changedById).toBe(context.headId);
  });

  it('AT-20 enforces payment FSM: only PENDING can be processed once', async () => {
    const wonDeal = await createDeal(prisma, context, DealStage.WON);
    const orderResponse = await request(server)
      .post('/orders/from-deal')
      .set(authHeader(context.managerToken))
      .send({ dealId: wonDeal.id })
      .expect(201);
    const order = bodyAs<OrderResponse>(orderResponse);
    const payment = await createPayment(order.id, 100);

    await request(server)
      .patch(`/orders/payments/${payment.id}/confirm`)
      .set(authHeader(context.headToken))
      .send({ status: PaymentRecordStatus.CONFIRMED })
      .expect(403);

    await request(server)
      .patch(`/orders/payments/${payment.id}/confirm`)
      .set(authHeader(context.accountantToken))
      .send({ status: PaymentRecordStatus.CONFIRMED })
      .expect(200);

    // Повторный confirm уже обработанного платежа → 409
    await request(server)
      .patch(`/orders/payments/${payment.id}/confirm`)
      .set(authHeader(context.accountantToken))
      .send({ status: PaymentRecordStatus.CONFIRMED })
      .expect(409);

    // CONFIRMED → REJECTED задним числом запрещён → 409
    await request(server)
      .patch(`/orders/payments/${payment.id}/confirm`)
      .set(authHeader(context.accountantToken))
      .send({ status: PaymentRecordStatus.REJECTED })
      .expect(409);

    const paymentAfter = await prisma.payment.findUniqueOrThrow({
      where: { id: payment.id },
    });
    expect(paymentAfter.status).toBe(PaymentRecordStatus.CONFIRMED);
  });

  it('AT-21 writes audit records for stock reserve, release and order cancel', async () => {
    const wonDeal = await createDeal(prisma, context, DealStage.WON);
    const orderResponse = await request(server)
      .post('/orders/from-deal')
      .set(authHeader(context.managerToken))
      .send({ dealId: wonDeal.id })
      .expect(201);
    const order = bodyAs<OrderResponse>(orderResponse);

    const reserveAudit = await prisma.auditLog.findFirst({
      where: {
        action: 'STOCK_RESERVED',
        entityType: 'StockBalance',
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(reserveAudit).not.toBeNull();

    await request(server)
      .post(`/orders/${order.id}/cancel`)
      .set(authHeader(context.managerToken))
      .expect(200);

    const cancelAudit = await prisma.auditLog.findFirst({
      where: {
        action: 'ORDER_CANCELLED',
        entityType: 'Order',
        entityId: order.id,
      },
    });
    const releaseAudit = await prisma.auditLog.findFirst({
      where: {
        action: 'STOCK_RELEASED',
        entityType: 'StockBalance',
      },
      orderBy: { createdAt: 'desc' },
    });

    expect(cancelAudit).not.toBeNull();
    expect(releaseAudit).not.toBeNull();
  });

  it('AT-22 paginates tasks by computedStatus with correct total', async () => {
    const past = new Date(Date.now() - 60 * 60 * 1000);

    for (let index = 0; index < 3; index++) {
      await prisma.task.create({
        data: {
          title: `Paginated overdue ${RUN_ID} ${index}`,
          type: TaskType.CALL,
          priority: TaskPriority.MEDIUM,
          dueDate: past,
          originalDueDate: past,
          assigneeId: context.managerId,
          createdById: context.managerId,
          relatedType: 'Client',
          relatedId: context.clientId,
        },
      });
    }

    const future = futureDate(5);
    await prisma.task.create({
      data: {
        title: `Paginated future ${RUN_ID}`,
        type: TaskType.CALL,
        priority: TaskPriority.MEDIUM,
        dueDate: future,
        originalDueDate: future,
        assigneeId: context.managerId,
        createdById: context.managerId,
        relatedType: 'Client',
        relatedId: context.clientId,
      },
    });

    const firstPage = await request(server)
      .get('/tasks?computedStatus=OVERDUE&limit=2&page=1')
      .set(authHeader(context.managerToken))
      .expect(200);
    const firstBody = bodyAs<{
      items: { computedStatus: string }[];
      total: number;
      page: number;
      limit: number;
    }>(firstPage);

    expect(firstBody.limit).toBe(2);
    expect(firstBody.page).toBe(1);
    expect(firstBody.items.length).toBe(2);
    // total считается по всем совпадениям, а не по размеру страницы
    expect(firstBody.total).toBeGreaterThanOrEqual(3);
    expect(
      firstBody.items.every((task) => task.computedStatus === 'OVERDUE'),
    ).toBe(true);

    const secondPage = await request(server)
      .get('/tasks?computedStatus=OVERDUE&limit=2&page=2')
      .set(authHeader(context.managerToken))
      .expect(200);
    const secondBody = bodyAs<{ items: unknown[] }>(secondPage);
    expect(secondBody.items.length).toBeGreaterThanOrEqual(1);
  });

  it('AT-23 paginates users list with light select', async () => {
    const response = await request(server)
      .get('/users?page=1&limit=2')
      .set(authHeader(context.headToken))
      .expect(200);
    const body = bodyAs<{
      items: Record<string, unknown>[];
      total: number;
      page: number;
      limit: number;
    }>(response);

    expect(body.items.length).toBe(2);
    expect(body.page).toBe(1);
    expect(body.limit).toBe(2);
    expect(body.total).toBeGreaterThanOrEqual(3);
    expect(body.items[0].passwordHash).toBeUndefined();
    expect(body.items[0].email).toBeDefined();

    const searched = await request(server)
      .get(`/users?search=admin-${RUN_ID}`)
      .set(authHeader(context.headToken))
      .expect(200);
    const searchedBody = bodyAs<{ items: { email: string }[]; total: number }>(
      searched,
    );

    expect(searchedBody.total).toBe(1);
    expect(searchedBody.items[0].email).toBe(`admin-${RUN_ID}@hpl.test`);
  });

  it('AT-24 serves funnel report from in-memory cache within TTL', async () => {
    const rangeQuery = 'dateFrom=2020-01-01&dateTo=2020-01-31';

    const first = await request(server)
      .get(`/reports/funnel?${rangeQuery}`)
      .set(authHeader(context.headToken))
      .expect(200);
    const firstBody = bodyAs<{ totalDeals: number }>(first);

    // Сделка создана уже после первого запроса, но TTL-кэш её не видит.
    // dev.db переиспользуется между прогонами, поэтому сравниваем значения,
    // а не абсолютный ноль.
    await prisma.deal.create({
      data: {
        title: `Cache probe ${RUN_ID}`,
        clientId: context.clientId,
        ownerId: context.headId,
        createdAt: new Date('2020-01-15T00:00:00.000Z'),
      },
    });

    const second = await request(server)
      .get(`/reports/funnel?${rangeQuery}`)
      .set(authHeader(context.headToken))
      .expect(200);
    const secondBody = bodyAs<{ totalDeals: number }>(second);
    expect(secondBody.totalDeals).toBe(firstBody.totalDeals);
  });

  it('AT-25 rotates hashed refresh session and rejects token reuse', async () => {
    const tokens = await login(server, `manager-${RUN_ID}@hpl.test`);

    const refreshed = await request(server)
      .post('/auth/refresh')
      .send({ refreshToken: tokens.refreshToken })
      .expect(201);
    const refreshedTokens = bodyAs<AuthTokens>(refreshed);
    expect(refreshedTokens.accessToken).toBeDefined();
    expect(refreshedTokens.refreshToken).not.toBe(tokens.refreshToken);

    // Старый refresh-токен после ротации невалиден (хеш в сессии заменён)
    await request(server)
      .post('/auth/refresh')
      .send({ refreshToken: tokens.refreshToken })
      .expect(401);

    // Подменённый токен (валидная подпись, чужой jti) → 401
    await request(server)
      .post('/auth/refresh')
      .send({
        refreshToken: `${refreshedTokens.refreshToken.slice(0, -2)}xx`,
      })
      .expect(401);
  });

  it('AT-26 returns unified error format with request id', async () => {
    const response = await request(server)
      .post('/auth/login')
      .set('x-request-id', 'e2e-request-26')
      .send({ email: 'not-an-email' })
      .expect(400);

    expect(response.headers['x-request-id']).toBe('e2e-request-26');

    const body = bodyAs<{
      statusCode: number;
      timestamp: string;
      path: string;
      method: string;
      message: string | string[];
      requestId: string;
    }>(response);

    expect(body.statusCode).toBe(400);
    expect(body.path).toBe('/auth/login');
    expect(body.method).toBe('POST');
    expect(body.requestId).toBe('e2e-request-26');
    expect(body.message).toBeDefined();
  });

  it('AT-27 exposes health check with prisma up', async () => {
    const response = await request(server).get('/health').expect(200);

    const body = bodyAs<{
      status: string;
      details: Record<string, { status: string }>;
    }>(response);

    expect(body.status).toBe('ok');
    expect(body.details.prisma.status).toBe('up');
    expect(response.headers['x-request-id']).toBeDefined();
  });

  it('AT-28 uploads file with mime validation, lists and downloads it', async () => {
    // Минимальный валидный PNG (1x1)
    const pngBuffer = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );

    const uploaded = await request(server)
      .post('/files/upload')
      .set(authHeader(context.managerToken))
      .attach('file', pngBuffer, 'panel-photo.png')
      .field('relatedType', 'CLIENT')
      .field('relatedId', context.clientId)
      .expect(201);
    const uploadedBody = bodyAs<{ id: string; url: string }>(uploaded);
    expect(uploadedBody.url).toBe(`/files/${uploadedBody.id}`);

    const listed = await request(server)
      .get(`/files?relatedType=CLIENT&relatedId=${context.clientId}`)
      .set(authHeader(context.managerToken))
      .expect(200);
    const listedBody =
      bodyAs<Array<{ id: string; originalName: string }>>(listed);
    expect(listedBody.some((entry) => entry.id === uploadedBody.id)).toBe(true);

    const downloaded = await request(server)
      .get(`/files/${uploadedBody.id}/download`)
      .set(authHeader(context.managerToken))
      .expect(200);
    expect(downloaded.headers['content-type']).toBe('image/png');

    // Неподдерживаемый mime → 400
    await request(server)
      .post('/files/upload')
      .set(authHeader(context.managerToken))
      .attach('file', Buffer.from('MZ'), 'evil.exe')
      .field('relatedType', 'CLIENT')
      .field('relatedId', context.clientId)
      .expect(400);

    // Несуществующая сущность → 404
    await request(server)
      .post('/files/upload')
      .set(authHeader(context.managerToken))
      .attach('file', pngBuffer, 'panel-photo.png')
      .field('relatedType', 'CLIENT')
      .field('relatedId', '00000000-0000-0000-0000-000000000000')
      .expect(404);

    // Без токена → 401
    await request(server).get(`/files/${uploadedBody.id}/download`).expect(401);
  });

  it('PR-2 accepts test webhook with valid X-API-Key', async () => {
    const response = await request(server)
      .post('/test/webhook')
      .set('X-API-Key', context.apiKeyToken)
      .expect(200);

    expect(bodyAs<{ status: string }>(response).status).toBe('ok');
  });

  it('PR-2 rejects test webhook without X-API-Key', async () => {
    await request(server).post('/test/webhook').expect(401);
  });

  it('PR-2 rejects test webhook when API key lacks permission', async () => {
    await request(server)
      .post('/test/webhook')
      .set('X-API-Key', context.apiKeyLimitedToken)
      .expect(403);
  });

  it('PR-2 rejects inactive API key with 403', async () => {
    const inactiveToken = `e2e-inactive-${RUN_ID}`;
    const pepper =
      process.env.SERVICE_ACCOUNT_TOKEN_PEPPER ??
      'test-service-account-pepper-min-32-chars';

    await prisma.serviceAccount.create({
      data: {
        name: `inactive-${RUN_ID}`,
        tokenHash: hashApiKeyToken(inactiveToken, pepper),
        permissions: ['leads:create'],
        isActive: false,
      },
    });

    await request(server)
      .post('/test/webhook')
      .set('X-API-Key', inactiveToken)
      .expect(403);
  });

  it('PR-2 protects Bull Dashboard without JWT', async () => {
    const response = await request(server).get('/admin/queues').expect(401);

    expect(response.body).toEqual(
      expect.objectContaining({
        message: 'Missing or invalid Authorization header',
      }),
    );
    expect(response.text).not.toContain('Bull Dashboard');
  });

  it('PR-2 protects Bull Dashboard when JWT lacks admin:queues', async () => {
    await request(server)
      .get('/admin/queues')
      .set(authHeader(context.managerToken))
      .expect(403);
  });

  it('PR-2 allows Bull Dashboard for admin with admin:queues', async () => {
    const response = await request(server)
      .get('/admin/queues')
      .set(authHeader(context.adminToken))
      .expect(200);

    expect(response.text).toContain('Bull Dashboard');
  });

  it('PR-3 accepts telegram webhook and deduplicates update_id', async () => {
    const updateId = Number.parseInt(RUN_ID.slice(-6), 10);
    const payload = {
      update_id: updateId,
      message: {
        message_id: 1,
        from: { id: 999001, username: 'tg_user', first_name: 'Иван' },
        text: JSON.stringify({
          name: 'Иван',
          phone: '+998901234567',
          message: 'Нужны панели',
        }),
      },
    };

    const accepted = await request(server)
      .post('/integrations/telegram/webhook')
      .set('X-API-Key', context.apiKeyToken)
      .send(payload)
      .expect(202);

    expect(bodyAs<{ status: string }>(accepted).status).toBe('accepted');

    const inFlight = await request(server)
      .post('/integrations/telegram/webhook')
      .set('X-API-Key', context.apiKeyToken)
      .send(payload)
      .expect(202);

    expect(bodyAs<{ status: string }>(inFlight).status).toBe('processing');

    const idempotency = app.get(IdempotencyService);
    const event = await idempotency.check('telegram', String(updateId));
    expect(event).not.toBeNull();
    await idempotency.markProcessed(event!.id);

    const duplicate = await request(server)
      .post('/integrations/telegram/webhook')
      .set('X-API-Key', context.apiKeyToken)
      .send(payload)
      .expect(200);

    expect(bodyAs<{ status: string }>(duplicate).status).toBe(
      'already_processed',
    );
  });

  it('PR-3 creates telegram lead on pool user and assigns manager manually', async () => {
    process.env.ADMIN_USER_EMAIL = `admin-${RUN_ID}@hpl.test`;

    const leadFactory = app.get(TelegramLeadFactory);
    const adminHandler = app.get(TelegramAdminHandlerService);
    const poolUser = await prisma.user.findUniqueOrThrow({
      where: { email: 'lead-pool@hpl.com' },
    });

    const lead = await leadFactory.create({
      telegramUserId: `tg-${RUN_ID}`,
      telegramUsername: 'assign_user',
      formData: {
        name: 'Assign Test',
        phone: `+99890${RUN_ID.slice(-7)}`,
        message: 'Manual assign',
      },
      updateId: `manual-${RUN_ID}`,
      rawPayload: { source: 'e2e' },
    });

    const metadata = await prisma.telegramLeadMetadata.findUniqueOrThrow({
      where: { leadId: lead.id },
    });

    expect(lead.ownerId).toBe(poolUser.id);
    expect(lead.source).toBe('telegram');
    expect(metadata.isPendingAssignment).toBe(true);

    await adminHandler.assignManager(lead.id, context.managerId, {
      adminChatId: '1',
      adminMessageId: '100',
      callbackQueryId: 'callback-e2e',
    });

    const assignedLead = await prisma.lead.findUniqueOrThrow({
      where: { id: lead.id },
    });
    const assignedMetadata =
      await prisma.telegramLeadMetadata.findUniqueOrThrow({
        where: { leadId: lead.id },
      });
    const notification = await prisma.notification.findFirst({
      where: {
        userId: context.managerId,
        relatedType: 'Lead',
        relatedId: lead.id,
        type: 'lead_assigned',
      },
    });

    expect(assignedLead.ownerId).toBe(context.managerId);
    expect(assignedMetadata.isPendingAssignment).toBe(false);
    expect(notification).not.toBeNull();
  });

  it('PR-3 handles assign callback payload with compact uuid', async () => {
    const leadFactory = app.get(TelegramLeadFactory);
    const adminHandler = app.get(TelegramAdminHandlerService);
    const managers = await adminHandler.listManagers();
    const managerIndex = managers.findIndex(
      (manager) => manager.id === context.managerId,
    );

    expect(managerIndex).toBeGreaterThanOrEqual(0);

    const lead = await leadFactory.create({
      telegramUserId: `tg-callback-${RUN_ID}`,
      formData: {
        name: 'Callback Test',
        phone: `+99891${RUN_ID.slice(-7)}`,
        message: 'Callback',
      },
      updateId: `callback-${RUN_ID}`,
      rawPayload: {},
    });

    await adminHandler.handleCallbackData(
      `a|${compactUuid(lead.id)}|${managerIndex}`,
      {
        adminChatId: '1',
        adminMessageId: '101',
        callbackQueryId: 'callback-compact',
        actorUserId: String(
          app.get(ConfigService).get('TELEGRAM_ADMIN_USER_ID') ?? '',
        ),
      },
    );

    const updated = await prisma.lead.findUniqueOrThrow({
      where: { id: lead.id },
    });
    expect(updated.ownerId).toBe(context.managerId);
  });

  it('PR-4 returns panel catalog reference data', async () => {
    const types = await request(server)
      .get('/panel-types')
      .set(authHeader(context.managerToken))
      .expect(200);

    const sizes = await request(server)
      .get('/panel-sizes')
      .set(authHeader(context.managerToken))
      .expect(200);

    const pricing = await request(server)
      .get('/panel-pricing/thickness')
      .set(authHeader(context.managerToken))
      .expect(200);

    expect(bodyAs<unknown[]>(types)).toHaveLength(5);
    expect(bodyAs<unknown[]>(sizes)).toHaveLength(24);
    const pricingBody =
      bodyAs<Array<{ currencyCode: string; basePricePerM2?: string }>>(pricing);
    expect(pricingBody.every((item) => item.currencyCode === 'CNY')).toBe(true);
    expect(pricingBody.every((item) => item.basePricePerM2 === undefined)).toBe(
      true,
    );
  });

  it('PR-4 filters supplier quality classes by panel type', async () => {
    const response = await request(server)
      .get('/suppliers/wuya/quality-classes')
      .query({ panelType: 'exterior' })
      .set(authHeader(context.managerToken))
      .expect(200);

    const classes = bodyAs<Array<{ code: string; nameRu: string }>>(response);
    expect(classes.map((item) => item.code).sort()).toEqual([
      'economy',
      'medium',
      'premium',
    ]);
    expect(classes.map((item) => item.nameRu).sort()).toEqual([
      'Медиум',
      'Премиум',
      'Эконом',
    ]);
  });

  it('PR-4 protects panel color creation and supports search', async () => {
    const supplier = await prisma.supplier.findFirstOrThrow({
      where: { code: 'wuya' },
    });
    const colorPayload = {
      supplierId: supplier.id,
      colorCode: `RAL-${RUN_ID.slice(-6)}`,
      colorName: 'Jet Black',
    };

    await request(server).post('/panel-colors').send(colorPayload).expect(401);

    const created = await request(server)
      .post('/panel-colors')
      .set(authHeader(context.managerToken))
      .send(colorPayload)
      .expect(201);

    const color = bodyAs<{
      id: string;
      colorCode: string;
      createdByManagerId: string;
      supplierId: string;
    }>(created);

    expect(color.colorCode).toBe(colorPayload.colorCode);
    expect(color.supplierId).toBe(supplier.id);
    expect(color.createdByManagerId).toBeTruthy();

    const search = await request(server)
      .get('/panel-colors')
      .query({ search: colorPayload.colorCode, supplierId: supplier.id })
      .set(authHeader(context.managerToken))
      .expect(200);

    expect(
      bodyAs<{ items: Array<{ colorCode: string }> }>(search).items.some(
        (item) => item.colorCode === colorPayload.colorCode,
      ),
    ).toBe(true);
  });

  it('P1 lets HEAD create, read, update, finalize and delete legacy calculations', async () => {
    const leadResponse = await request(server)
      .post('/leads')
      .set(authHeader(context.managerToken))
      .send({
        title: `P1 Calc Lead ${RUN_ID}`,
        source: 'e2e',
        clientId: context.clientId,
      })
      .expect(201);

    const leadId = bodyAs<EntityResponse>(leadResponse).id;

    await qualifyLeadStage1(leadId);
    await confirmLeadStage2(leadId);

    const panelType = await prisma.panelType.findFirstOrThrow({
      where: { code: 'exterior_with_uv' },
    });
    const panelSize = await prisma.panelSize.findFirstOrThrow({
      where: { widthMm: 1220, heightMm: 2440 },
    });
    const supplier = await prisma.supplier.findFirstOrThrow({
      where: { code: 'wuya' },
    });
    const qualityClass = await prisma.qualityClass.findFirstOrThrow({
      where: { code: 'economy' },
    });

    const itemPayload = {
      panelTypeId: panelType.id,
      panelSizeId: panelSize.id,
      thicknessMm: 10,
      supplierId: supplier.id,
      qualityClassId: qualityClass.id,
      requiredAreaM2: '15.50',
      purchasePricePerM2Cny: '80',
    };

    const created = await request(server)
      .post('/calculations')
      .set(authHeader(context.headToken))
      .send({
        leadId,
        notes: 'P1 draft',
        items: [itemPayload],
      })
      .expect(201);

    const calculation = bodyAs<{
      id: string;
      status: string;
      totalAmount: string;
      items: Array<{
        sheetsCount: number;
        pricePerM2: string;
        supplierPricePerM2?: string;
        clientPricePerM2: string;
      }>;
    }>(created);

    expect(calculation.status).toBe('draft');
    expect(calculation.items[0]?.sheetsCount).toBe(6);
    expect(calculation.items[0]?.supplierPricePerM2).toBe('80');
    expect(
      new Prisma.Decimal(calculation.items[0]?.clientPricePerM2).gt(0),
    ).toBe(true);
    expect(new Prisma.Decimal(calculation.items[0]?.pricePerM2).gt(0)).toBe(
      true,
    );

    const fetched = await request(server)
      .get(`/calculations/${calculation.id}`)
      .set(authHeader(context.headToken))
      .expect(200);

    expect(bodyAs<{ id: string }>(fetched).id).toBe(calculation.id);

    const updated = await request(server)
      .patch(`/calculations/${calculation.id}`)
      .set(authHeader(context.headToken))
      .send({
        notes: 'Updated draft',
        items: [{ ...itemPayload, requiredAreaM2: '20.00' }],
      })
      .expect(200);

    expect(bodyAs<{ notes: string }>(updated).notes).toBe('Updated draft');

    await request(server)
      .post(`/calculations/${calculation.id}/finalize`)
      .set(authHeader(context.headToken))
      .expect(201);

    await request(server)
      .patch(`/calculations/${calculation.id}`)
      .set(authHeader(context.headToken))
      .send({ notes: 'Should fail' })
      .expect(409);

    await request(server)
      .delete(`/calculations/${calculation.id}`)
      .set(authHeader(context.headToken))
      .expect(200);

    await request(server)
      .get(`/calculations/${calculation.id}`)
      .set(authHeader(context.headToken))
      .expect(404);
  });

  it('P1 returns lead workspace with catalog and blocks foreign lead access', async () => {
    const ownLead = await request(server)
      .post('/leads')
      .set(authHeader(context.managerToken))
      .send({
        title: `Workspace Lead ${RUN_ID}`,
        source: 'e2e',
        clientId: context.clientId,
      })
      .expect(201);

    const ownLeadId = bodyAs<EntityResponse>(ownLead).id;

    const workspace = await request(server)
      .get(`/leads/${ownLeadId}/workspace`)
      .set(authHeader(context.managerToken))
      .expect(200);

    const workspaceBody = bodyAs<{
      lead: { virtualStatus: string };
      catalog: { panelTypes: unknown[]; panelSizes: unknown[] };
      calculations: unknown[];
    }>(workspace);

    expect(workspaceBody.catalog.panelTypes.length).toBe(5);
    expect(workspaceBody.catalog.panelSizes.length).toBe(24);
    expect(workspaceBody.lead.virtualStatus).toBeTruthy();

    const foreignLead = await request(server)
      .post('/leads')
      .set(authHeader(context.headToken))
      .send({
        title: `Foreign Lead ${RUN_ID}`,
        source: 'e2e',
        clientId: context.clientId,
        ownerId: context.headId,
      })
      .expect(201);

    await request(server)
      .get(`/leads/${bodyAs<EntityResponse>(foreignLead).id}/workspace`)
      .set(authHeader(context.managerToken))
      .expect(403);
  });

  it('P2 keeps the HEAD-only legacy calculation conversion compatible', async () => {
    const leadResponse = await request(server)
      .post('/leads')
      .set(authHeader(context.managerToken))
      .send({
        title: `P2 Quote Lead ${RUN_ID}`,
        source: 'e2e',
        clientId: context.clientId,
      })
      .expect(201);

    const leadId = bodyAs<EntityResponse>(leadResponse).id;

    await request(server)
      .post(`/leads/${leadId}/qualify`)
      .set(authHeader(context.managerToken))
      .send({
        clientId: context.clientId,
        projectObjectId: context.projectObjectId,
        needDescription: 'HPL panels for quote conversion',
        decisionMakerContact: 'Chief architect',
        qualification: await stage1QualificationPayload(prisma, {
          installationRequired: false,
        }),
      })
      .expect(201);

    await confirmLeadStage2(leadId);

    const panelType = await prisma.panelType.findFirstOrThrow({
      where: { code: 'exterior_with_uv' },
    });
    const panelSize = await prisma.panelSize.findFirstOrThrow({
      where: { widthMm: 1220, heightMm: 2440 },
    });
    const supplier = await prisma.supplier.findFirstOrThrow({
      where: { code: 'wuya' },
    });
    const qualityClass = await prisma.qualityClass.findFirstOrThrow({
      where: { code: 'economy' },
    });

    const itemPayload = {
      panelTypeId: panelType.id,
      panelSizeId: panelSize.id,
      thicknessMm: 10,
      supplierId: supplier.id,
      qualityClassId: qualityClass.id,
      requiredAreaM2: '15.50',
      purchasePricePerM2Cny: '80',
    };

    const calculation = await request(server)
      .post('/calculations')
      .set(authHeader(context.headToken))
      .send({ leadId, items: [itemPayload] })
      .expect(201);

    const calculationId = bodyAs<EntityResponse>(calculation).id;

    await request(server)
      .post(`/calculations/${calculationId}/finalize`)
      .set(authHeader(context.headToken))
      .expect(201);

    const quoteResponse = await request(server)
      .post(`/calculations/${calculationId}/convert-to-quote`)
      .set(authHeader(context.headToken))
      .send({ clientComment: 'Срок поставки 14 дней' })
      .expect(201);

    const quote = bodyAs<{
      id: string;
      status: string;
      items: Array<{ id: string; panelTypeCode: string; totalPrice: string }>;
    }>(quoteResponse);

    expect(quote.status).toBe('draft');
    expect(quote.items[0]?.panelTypeCode).toBe('exterior_with_uv');

    await request(server)
      .patch(`/quotes/${quote.id}/status`)
      .set(authHeader(context.managerToken))
      .send({ status: 'approved' })
      .expect(403);

    await request(server)
      .patch(`/quotes/${quote.id}/commercial-terms`)
      .set(authHeader(context.headToken))
      .send({
        productionTerms: '15–20 рабочих дней',
        deliveryTerms: '4 недели после согласования декора',
      })
      .expect(200);

    await request(server)
      .patch(`/quotes/${quote.id}/approved-pricing`)
      .set(authHeader(context.headToken))
      .send({
        items: quote.items.map((item) => ({
          id: item.id,
          purchasePricePerM2Cny: '80',
        })),
      })
      .expect(200);

    await request(server)
      .post(`/quotes/${quote.id}/finalize`)
      .set(authHeader(context.headToken))
      .expect(200);

    await request(server)
      .patch(`/quotes/${quote.id}/status`)
      .set(authHeader(context.headToken))
      .send({ status: 'sent' })
      .expect(200);

    await request(server)
      .patch(`/quotes/${quote.id}/status`)
      .set(authHeader(context.managerToken))
      .send({ status: 'approved' })
      .expect(403);

    await request(server)
      .patch(`/quotes/${quote.id}/status`)
      .set(authHeader(context.headToken))
      .send({ status: 'approved' })
      .expect(200);

    const approvalAudit = await prisma.auditLog.findFirst({
      where: {
        action: 'QUOTE_APPROVED',
        entityId: quote.id,
      },
    });
    expect(approvalAudit).toBeTruthy();

    const conversion = await request(server)
      .post(`/quotes/${quote.id}/convert-to-deal`)
      .set(authHeader(context.headToken))
      .expect(201);

    const conversionBody = bodyAs<{
      dealId: string;
      quote: { status: string };
    }>(conversion);

    expect(conversionBody.quote.status).toBe('converted');
    expect(conversionBody.dealId).toBeTruthy();

    const convertedLead = await prisma.lead.findUniqueOrThrow({
      where: { id: leadId },
    });
    expect(convertedLead.status).toBe('CONVERTED');
    expect(convertedLead.dealId).toBe(conversionBody.dealId);

    const deal = await prisma.deal.findUniqueOrThrow({
      where: { id: conversionBody.dealId },
      include: { items: true, offers: true },
    });

    expect(deal.clientId).toBe(context.clientId);
    expect(deal.items.length).toBeGreaterThan(0);
    expect(deal.offers.length).toBeGreaterThan(0);
    expect(deal.offers.every((offer) => offer.isApproved === false)).toBe(true);

    const conversionAudit = await prisma.auditLog.findFirst({
      where: {
        action: 'QUOTE_CONVERTED',
        entityId: quote.id,
      },
    });
    expect(conversionAudit).toBeTruthy();
  });

  it('denies Manager quote approval even when they own the quote', async () => {
    const quoteId = await createSentPanelQuote();

    await request(server)
      .patch(`/quotes/${quoteId}/status`)
      .set(authHeader(context.managerToken))
      .send({ status: 'approved' })
      .expect(403);
  });

  it('does not convert an unapproved quote into an approved offer', async () => {
    const quoteId = await createSentPanelQuote();

    await request(server)
      .post(`/quotes/${quoteId}/convert-to-deal`)
      .set(authHeader(context.headToken))
      .expect(409);

    const quote = await prisma.panelQuote.findUniqueOrThrow({
      where: { id: quoteId },
      select: { dealId: true, status: true },
    });
    expect(quote.dealId).toBeTruthy();
    expect(quote.status).toBe('sent');
  });

  it('enforces Tianran quality matrix and Wuya/Polybet qualities', async () => {
    const leadResponse = await request(server)
      .post('/leads')
      .set(authHeader(context.managerToken))
      .send({
        title: `Quality matrix ${RUN_ID}`,
        source: 'e2e',
        clientId: context.clientId,
      })
      .expect(201);
    const leadId = bodyAs<EntityResponse>(leadResponse).id;

    const interior = await prisma.panelType.findFirstOrThrow({
      where: { code: 'interior' },
    });
    const exterior = await prisma.panelType.findFirstOrThrow({
      where: { code: 'exterior_with_uv' },
    });
    const panelSize = await prisma.panelSize.findFirstOrThrow({
      where: { widthMm: 1220, heightMm: 2440 },
    });
    const tianran = await prisma.supplier.findFirstOrThrow({
      where: { code: 'tianran' },
    });
    const wuya = await prisma.supplier.findFirstOrThrow({
      where: { code: 'wuya' },
    });
    const polybet = await prisma.supplier.findFirstOrThrow({
      where: { code: 'polybet' },
    });
    const economy = await prisma.qualityClass.findFirstOrThrow({
      where: { code: 'economy' },
    });
    const medium = await prisma.qualityClass.findFirstOrThrow({
      where: { code: 'medium' },
    });
    const premium = await prisma.qualityClass.findFirstOrThrow({
      where: { code: 'premium' },
    });

    const preview = (
      supplierId: string,
      panelTypeId: string,
      qualityClassId: string,
    ) =>
      request(server)
        .post('/calculations/preview')
        .set(authHeader(context.headToken))
        .send({
          panelTypeId,
          panelSizeId: panelSize.id,
          thicknessMm: 10,
          supplierId,
          qualityClassId,
          requiredAreaM2: '2.9768',
        });

    const assertMappingAllowed = async (
      supplierId: string,
      panelTypeId: string,
      qualityClassId: string,
    ) => {
      const response = await preview(supplierId, panelTypeId, qualityClassId);
      if (response.status === 400) {
        expect(bodyAs<{ errorCode?: string }>(response).errorCode).not.toBe(
          'INVALID_QUALITY_MAPPING',
        );
        return;
      }
      expect(response.status).toBe(201);
    };

    await assertMappingAllowed(tianran.id, interior.id, economy.id);
    await assertMappingAllowed(tianran.id, exterior.id, economy.id);
    await assertMappingAllowed(tianran.id, exterior.id, medium.id);
    await assertMappingAllowed(tianran.id, exterior.id, premium.id);
    await assertMappingAllowed(wuya.id, exterior.id, economy.id);
    await assertMappingAllowed(wuya.id, exterior.id, premium.id);
    await assertMappingAllowed(polybet.id, exterior.id, premium.id);
    await assertMappingAllowed(polybet.id, exterior.id, economy.id);

    await request(server)
      .post('/calculations')
      .set(authHeader(context.headToken))
      .send({
        leadId,
        items: [
          {
            panelTypeId: exterior.id,
            panelSizeId: panelSize.id,
            thicknessMm: 10,
            supplierId: tianran.id,
            qualityClassId: economy.id,
            requiredAreaM2: '2.9768',
            purchasePricePerM2Cny: '80',
          },
        ],
      })
      .expect(409);
  });

  it('blocks Manager from the commercial preview endpoint', async () => {
    const panelType = await prisma.panelType.findFirstOrThrow({
      where: { code: 'exterior_with_uv' },
    });
    const panelSize = await prisma.panelSize.findFirstOrThrow({
      where: { widthMm: 1220, heightMm: 2440 },
    });
    const supplier = await prisma.supplier.findFirstOrThrow({
      where: { code: 'wuya' },
    });
    const qualityClass = await prisma.qualityClass.findFirstOrThrow({
      where: { code: 'economy' },
    });

    const preview = await request(server)
      .post('/calculations/preview')
      .set(authHeader(context.managerToken))
      .send({
        panelTypeId: panelType.id,
        panelSizeId: panelSize.id,
        thicknessMm: 10,
        supplierId: supplier.id,
        qualityClassId: qualityClass.id,
        requiredAreaM2: '1',
        supplierPricePerM2: '1',
        cnyUsdRate: '999',
        coefficient: '1',
        clientPricePerM2: '1',
      })
      .expect(403);

    expect(
      bodyAs<{ clientPricePerM2?: string }>(preview).clientPricePerM2,
    ).toBeUndefined();
  });

  it('forbids Manager from managing CurrencyRate but allows reading it', async () => {
    await request(server)
      .post('/currency-rates')
      .set(authHeader(context.managerToken))
      .send({ rate: '0.2' })
      .expect(403);

    await request(server)
      .get('/currency-rates/current')
      .set(authHeader(context.managerToken))
      .expect(200);
  });

  it('allows DIRECTOR to set the CNY→USD rate and forbids HEAD manage', async () => {
    await request(server)
      .post('/currency-rates')
      .set(authHeader(context.headToken))
      .send({ rate: '0.11' })
      .expect(403);

    const created = await request(server)
      .post('/currency-rates')
      .set(authHeader(context.directorToken))
      .send({ rate: '0.11' })
      .expect(201);

    expect(bodyAs<{ rate: string }>(created).rate).toBeDefined();

    const current = await request(server)
      .get('/currency-rates/current')
      .set(authHeader(context.headToken))
      .expect(200);

    expect(
      new Prisma.Decimal(bodyAs<{ rate: string }>(current).rate).toString(),
    ).toBe('0.11');

    await request(server)
      .post('/currency-rates')
      .set(authHeader(context.directorToken))
      .send({ rate: '0.1' })
      .expect(201);
  });

  it('BP4 forbids ADMIN and ACCOUNTANT from managing CurrencyRate', async () => {
    await request(server)
      .post('/currency-rates')
      .set(authHeader(context.adminToken))
      .send({ rate: '0.25' })
      .expect(403);
    await request(server)
      .post('/currency-rates')
      .set(authHeader(context.accountantToken))
      .send({ rate: '0.25' })
      .expect(403);
  });

  it('allows HEAD to manage supplier CNY thickness prices and forbids other roles', async () => {
    const panelType = await prisma.panelType.findFirstOrThrow({
      where: { code: 'furniture' },
    });
    const supplier = await prisma.supplier.findFirstOrThrow({
      where: { code: 'wuya' },
    });
    const qualityClass = await prisma.qualityClass.findFirstOrThrow({
      where: { code: 'economy' },
    });
    const payload = {
      panelTypeId: panelType.id,
      supplierId: supplier.id,
      qualityClassId: qualityClass.id,
      thicknessMm: '2.9',
      basePricePerM2: '80',
    };

    await request(server)
      .post('/panel-pricing/thickness')
      .set(authHeader(context.managerToken))
      .send(payload)
      .expect(403);
    await request(server)
      .post('/panel-pricing/thickness')
      .set(authHeader(context.directorToken))
      .send(payload)
      .expect(403);
    await request(server)
      .post('/panel-pricing/thickness')
      .set(authHeader(context.adminToken))
      .send(payload)
      .expect(403);
    await request(server)
      .post('/panel-pricing/thickness')
      .set(authHeader(context.accountantToken))
      .send(payload)
      .expect(403);

    const created = await request(server)
      .post('/panel-pricing/thickness')
      .set(authHeader(context.headToken))
      .send(payload)
      .expect(201);

    const body = bodyAs<{
      basePricePerM2: string;
      currencyCode: string;
      thicknessMm: string;
      supplier: { code: string };
      qualityClass: { code: string };
    }>(created);
    expect(body.currencyCode).toBe('CNY');
    expect(new Prisma.Decimal(body.basePricePerM2).toString()).toBe('80');
    expect(new Prisma.Decimal(body.thicknessMm).toString()).toBe('2.9');
    expect(body.supplier.code).toBe('wuya');
    expect(body.qualityClass.code).toBe('economy');

    const listed = await request(server)
      .get('/panel-pricing/thickness')
      .set(authHeader(context.headToken))
      .expect(200);
    expect(
      bodyAs<Array<{ thicknessMm: string; basePricePerM2?: string }>>(
        listed,
      ).some(
        (row) =>
          new Prisma.Decimal(row.thicknessMm).toString() === '2.9' &&
          row.basePricePerM2 !== undefined,
      ),
    ).toBe(true);
  });

  it('lets HEAD preview furniture quantities without PanelThicknessPricing', async () => {
    const panelType = await prisma.panelType.findFirstOrThrow({
      where: { code: 'furniture' },
    });
    const panelSize = await prisma.panelSize.findFirstOrThrow({
      where: { widthMm: 1525, heightMm: 1830 },
    });
    const supplier = await prisma.supplier.findFirstOrThrow({
      where: { code: 'wuya' },
    });
    const qualityClass = await prisma.qualityClass.findFirstOrThrow({
      where: { code: 'economy' },
    });

    await prisma.panelThicknessPricing.updateMany({
      where: {
        supplierId: supplier.id,
        qualityClassId: qualityClass.id,
        thicknessMm: new Prisma.Decimal('2.9'),
        isActive: true,
      },
      data: { isActive: false, validTo: new Date() },
    });

    const mechanical = await request(server)
      .post('/calculations/preview')
      .set(authHeader(context.headToken))
      .send({
        panelTypeId: panelType.id,
        panelSizeId: panelSize.id,
        thicknessMm: '2.9',
        supplierId: supplier.id,
        qualityClassId: qualityClass.id,
        requiredAreaM2: '1000',
      })
      .expect(201);

    const mechanicalBody = bodyAs<{
      sheetsCount: number;
      areaM2: string;
      total?: string;
      errorCode?: string;
    }>(mechanical);
    expect(mechanicalBody.errorCode).toBeUndefined();
    expect(mechanicalBody.sheetsCount).toBe(359);
    expect(Number(mechanicalBody.areaM2)).toBeCloseTo(1001.8793, 3);
    expect(mechanicalBody.total).toBeUndefined();
  });

  it('lets HEAD price a calculation from a manual CNY purchase price without catalog', async () => {
    const panelType = await prisma.panelType.findFirstOrThrow({
      where: { code: 'furniture' },
    });
    const panelSize = await prisma.panelSize.findFirstOrThrow({
      where: { widthMm: 1525, heightMm: 1830 },
    });
    const supplier = await prisma.supplier.findFirstOrThrow({
      where: { code: 'wuya' },
    });
    const qualityClass = await prisma.qualityClass.findFirstOrThrow({
      where: { code: 'economy' },
    });

    await prisma.panelThicknessPricing.updateMany({
      where: {
        supplierId: supplier.id,
        qualityClassId: qualityClass.id,
        thicknessMm: new Prisma.Decimal('2.9'),
        isActive: true,
      },
      data: { isActive: false, validTo: new Date() },
    });

    const currentRate = await request(server)
      .get('/currency-rates/current')
      .set(authHeader(context.headToken))
      .expect(200);
    const fx = new Prisma.Decimal(bodyAs<{ rate: string }>(currentRate).rate);
    const purchaseCny = new Prisma.Decimal('80');
    const clientPerM2 = purchaseCny.mul(fx).mul(2).toDecimalPlaces(2);
    const sheetArea = new Prisma.Decimal(1525).mul(1830).div(1_000_000);
    const expectedTotal = clientPerM2
      .mul(sheetArea)
      .mul(359)
      .toDecimalPlaces(2);

    const priced = await request(server)
      .post('/calculations/preview')
      .set(authHeader(context.headToken))
      .send({
        panelTypeId: panelType.id,
        panelSizeId: panelSize.id,
        thicknessMm: '2.9',
        supplierId: supplier.id,
        qualityClassId: qualityClass.id,
        requiredAreaM2: '1000',
        purchasePricePerM2Cny: '80',
      })
      .expect(201);

    const pricedBody = bodyAs<{
      sheetsCount: number;
      supplierPricePerM2?: string;
      purchasePricePerM2Cny?: string;
      clientPricePerM2: string;
      total: string;
      cnyUsdRate: string;
      sellingCoefficient: string;
      errorCode?: string;
    }>(priced);
    expect(pricedBody.errorCode).toBeUndefined();
    expect(pricedBody.sheetsCount).toBe(359);
    expect(
      new Prisma.Decimal(pricedBody.supplierPricePerM2 ?? '0').toString(),
    ).toBe('80');
    expect(new Prisma.Decimal(pricedBody.clientPricePerM2).toString()).toBe(
      clientPerM2.toString(),
    );
    expect(new Prisma.Decimal(pricedBody.total).toString()).toBe(
      expectedTotal.toString(),
    );
    expect(new Prisma.Decimal(pricedBody.cnyUsdRate).toString()).toBe(
      fx.toString(),
    );
    expect(new Prisma.Decimal(pricedBody.sellingCoefficient).toString()).toBe(
      '2',
    );
  });

  it('forbids MANAGER from submitting a manual purchase price and still requires catalog pricing', async () => {
    const panelType = await prisma.panelType.findFirstOrThrow({
      where: { code: 'furniture' },
    });
    const panelSize = await prisma.panelSize.findFirstOrThrow({
      where: { widthMm: 1525, heightMm: 1830 },
    });
    const supplier = await prisma.supplier.findFirstOrThrow({
      where: { code: 'wuya' },
    });
    const qualityClass = await prisma.qualityClass.findFirstOrThrow({
      where: { code: 'economy' },
    });

    await prisma.panelThicknessPricing.updateMany({
      where: {
        supplierId: supplier.id,
        qualityClassId: qualityClass.id,
        thicknessMm: new Prisma.Decimal('2.9'),
        isActive: true,
      },
      data: { isActive: false, validTo: new Date() },
    });

    const forbidden = await request(server)
      .post('/calculations/preview')
      .set(authHeader(context.managerToken))
      .send({
        panelTypeId: panelType.id,
        panelSizeId: panelSize.id,
        thicknessMm: '2.9',
        supplierId: supplier.id,
        qualityClassId: qualityClass.id,
        requiredAreaM2: '1000',
        purchasePricePerM2Cny: '80',
      });
    expect(forbidden.status).toBe(403);
    expect(
      bodyAs<{ clientPricePerM2?: string }>(forbidden).clientPricePerM2,
    ).toBeUndefined();

    const missing = await request(server)
      .post('/calculations/preview')
      .set(authHeader(context.managerToken))
      .send({
        panelTypeId: panelType.id,
        panelSizeId: panelSize.id,
        thicknessMm: '2.9',
        supplierId: supplier.id,
        qualityClassId: qualityClass.id,
        requiredAreaM2: '1000',
      });
    expect(missing.status).toBe(403);
  });

  it('rejects zero HEAD purchase price and snapshots manual CNY onto Quote', async () => {
    const furniture = await prisma.panelType.findFirstOrThrow({
      where: { code: 'furniture' },
    });
    const panelSize = await prisma.panelSize.findFirstOrThrow({
      where: { widthMm: 1525, heightMm: 1830 },
    });
    const leadResponse = await request(server)
      .post('/leads')
      .set(authHeader(context.managerToken))
      .send({
        title: `HEAD furniture calc ${RUN_ID}`,
        source: 'e2e',
        clientId: context.clientId,
      })
      .expect(201);
    const leadId = bodyAs<EntityResponse>(leadResponse).id;

    await request(server)
      .post(`/leads/${leadId}/qualify`)
      .set(authHeader(context.managerToken))
      .send({
        clientId: context.clientId,
        contactId: context.contactId,
        projectObjectId: context.projectObjectId,
        needDescription: 'Furniture HPL',
        decisionMakerContact: 'Buyer',
        qualification: {
          ...(await stage1QualificationPayload(prisma, {
            installationRequired: false,
          })),
          application: 'FURNITURE',
          panelTypeId: furniture.id,
          thicknessMm: '2.9',
          panelSizeId: panelSize.id,
          requiredAreaM2: 1000,
        },
      })
      .expect(201);
    await confirmLeadStage2(leadId);

    const zero = await request(server)
      .post('/calculations')
      .set(authHeader(context.headToken))
      .send({
        leadId,
        items: [
          {
            panelTypeId: furniture.id,
            panelSizeId: panelSize.id,
            thicknessMm: '2.9',
            requiredAreaM2: '1000',
            purchasePricePerM2Cny: '0',
          },
        ],
      });
    expect(zero.status).toBe(400);
    expect(bodyAs<{ errorCode?: string }>(zero).errorCode).toBe(
      'INVALID_SUPPLIER_PRICE',
    );

    const created = await request(server)
      .post('/calculations')
      .set(authHeader(context.headToken))
      .send({
        leadId,
        items: [
          {
            panelTypeId: furniture.id,
            panelSizeId: panelSize.id,
            thicknessMm: '2.9',
            requiredAreaM2: '1000',
            purchasePricePerM2Cny: '80',
          },
        ],
      })
      .expect(201);
    const calculationId = bodyAs<EntityResponse>(created).id;
    const stored = await prisma.calculationSession.findUniqueOrThrow({
      where: { id: calculationId },
      include: { items: true },
    });
    expect(stored.items[0]?.supplierPricePerM2.toString()).toBe('80');

    await prisma.panelThicknessPricing.updateMany({
      where: {
        supplierId: stored.items[0].supplierId,
        qualityClassId: stored.items[0].qualityClassId,
        thicknessMm: new Prisma.Decimal('2.9'),
      },
      data: { basePricePerM2: new Prisma.Decimal('90') },
    });

    await request(server)
      .post(`/calculations/${calculationId}/finalize`)
      .set(authHeader(context.headToken))
      .expect(201);

    const quote = await request(server)
      .post(`/calculations/${calculationId}/convert-to-quote`)
      .set(authHeader(context.headToken))
      .send({})
      .expect(201);
    const quoteId = bodyAs<EntityResponse>(quote).id;
    const quoteRow = await prisma.panelQuote.findUniqueOrThrow({
      where: { id: quoteId },
      include: { items: true },
    });
    expect(quoteRow.items[0]?.supplierPricePerM2.toString()).toBe('80');
    expect(quoteRow.cnyUsdRate).toBeNull();
    expect(quoteRow.totalAmount.toString()).toBe(
      stored.totalAmount?.toString(),
    );
  });

  it('BP4 keeps old Calculation snapshots when DIRECTOR changes the rate', async () => {
    const leadResponse = await request(server)
      .post('/leads')
      .set(authHeader(context.managerToken))
      .send({
        title: `FX snapshot lead ${RUN_ID}`,
        source: 'e2e',
        clientId: context.clientId,
      })
      .expect(201);
    const leadId = bodyAs<EntityResponse>(leadResponse).id;
    await qualifyLeadStage1(leadId);
    await confirmLeadStage2(leadId);

    const panelType = await prisma.panelType.findFirstOrThrow({
      where: { code: 'exterior_with_uv' },
    });
    const panelSize = await prisma.panelSize.findFirstOrThrow({
      where: { widthMm: 1220, heightMm: 2440 },
    });
    const item = {
      panelTypeId: panelType.id,
      panelSizeId: panelSize.id,
      thicknessMm: 10,
      requiredAreaM2: '15.50',
      purchasePricePerM2Cny: '80',
    };

    await request(server)
      .post('/currency-rates')
      .set(authHeader(context.directorToken))
      .send({ rate: '0.1' })
      .expect(201);

    const firstCalc = await request(server)
      .post('/calculations')
      .set(authHeader(context.headToken))
      .send({ leadId, items: [item] })
      .expect(201);
    const firstId = bodyAs<EntityResponse>(firstCalc).id;

    await request(server)
      .post('/currency-rates')
      .set(authHeader(context.directorToken))
      .send({ rate: '0.2' })
      .expect(201);

    const stored = await prisma.calculationSession.findUniqueOrThrow({
      where: { id: firstId },
      select: { cnyUsdRate: true },
    });
    expect(stored.cnyUsdRate?.toString()).toBe('0.1');

    const secondCalc = await request(server)
      .post('/calculations')
      .set(authHeader(context.headToken))
      .send({ leadId, items: [item] })
      .expect(201);
    const secondStored = await prisma.calculationSession.findUniqueOrThrow({
      where: { id: bodyAs<EntityResponse>(secondCalc).id },
      select: { cnyUsdRate: true },
    });
    expect(secondStored.cnyUsdRate?.toString()).toBe('0.2');

    await request(server)
      .post('/currency-rates')
      .set(authHeader(context.directorToken))
      .send({ rate: '0.1' })
      .expect(201);
  });

  it('BP4 forbids MANAGER/HEAD/DIRECTOR/ADMIN payment confirmation and allows ACCOUNTANT', async () => {
    const order = await createWonOrder();
    const payment = await createPayment(order.id, Number(order.totalAmount));

    await request(server)
      .patch(`/orders/payments/${payment.id}/confirm`)
      .set(authHeader(context.managerToken))
      .send({ status: PaymentRecordStatus.CONFIRMED })
      .expect(403);
    await request(server)
      .patch(`/orders/payments/${payment.id}/confirm`)
      .set(authHeader(context.headToken))
      .send({ status: PaymentRecordStatus.CONFIRMED })
      .expect(403);
    await request(server)
      .patch(`/orders/payments/${payment.id}/confirm`)
      .set(authHeader(context.directorToken))
      .send({ status: PaymentRecordStatus.CONFIRMED })
      .expect(403);
    await request(server)
      .patch(`/orders/payments/${payment.id}/confirm`)
      .set(authHeader(context.adminToken))
      .send({ status: PaymentRecordStatus.CONFIRMED })
      .expect(403);
    await request(server)
      .patch(`/orders/payments/${payment.id}/confirm`)
      .set(authHeader(context.accountantToken))
      .send({ status: PaymentRecordStatus.CONFIRMED })
      .expect(200);
  });

  it('BP4 forbids DIRECTOR and ADMIN Stage-2 commercial qualification', async () => {
    const leadResponse = await request(server)
      .post('/leads')
      .set(authHeader(context.managerToken))
      .send({
        title: `BP4 stage2 ${RUN_ID}`,
        source: 'e2e',
        clientId: context.clientId,
      })
      .expect(201);
    const leadId = bodyAs<EntityResponse>(leadResponse).id;
    await qualifyLeadStage1(leadId);
    const supplier = await prisma.supplier.findFirstOrThrow({
      where: { code: 'wuya' },
    });
    const qualityClass = await prisma.qualityClass.findFirstOrThrow({
      where: { code: 'economy' },
    });
    const payload = {
      supplierId: supplier.id,
      qualityClassId: qualityClass.id,
      decisionComment: 'BP4',
    };

    await request(server)
      .post(`/leads/${leadId}/commercial-qualification`)
      .set(authHeader(context.directorToken))
      .send(payload)
      .expect(403);
    await request(server)
      .post(`/leads/${leadId}/commercial-qualification`)
      .set(authHeader(context.adminToken))
      .send(payload)
      .expect(403);
    await request(server)
      .post(`/leads/${leadId}/commercial-qualification`)
      .set(authHeader(context.headToken))
      .send(payload)
      .expect(201);
  });

  it('BP4 forbids DIRECTOR and ADMIN quote approval', async () => {
    const quoteId = await createSentPanelQuote();

    await request(server)
      .patch(`/quotes/${quoteId}/status`)
      .set(authHeader(context.directorToken))
      .send({ status: 'approved' })
      .expect(403);
    await request(server)
      .patch(`/quotes/${quoteId}/status`)
      .set(authHeader(context.adminToken))
      .send({ status: 'approved' })
      .expect(403);
    await request(server)
      .patch(`/quotes/${quoteId}/status`)
      .set(authHeader(context.headToken))
      .send({ status: 'approved' })
      .expect(200);
  });

  it('BP4 keeps ADMIN on technical user administration only', async () => {
    const created = await request(server)
      .post('/users')
      .set(authHeader(context.adminToken))
      .send({
        email: `bp4-admin-user-${RUN_ID}@hpl.test`,
        password: TEST_PASSWORD,
        firstName: 'Tech',
        lastName: 'Admin',
        roleNames: [RoleName.ENGINEER],
      })
      .expect(201);
    expect(bodyAs<EntityResponse>(created).id).toBeDefined();

    await request(server)
      .post('/users')
      .set(authHeader(context.directorToken))
      .send({
        email: `bp4-director-user-${RUN_ID}@hpl.test`,
        password: TEST_PASSWORD,
        firstName: 'No',
        lastName: 'Admin',
        roleNames: [RoleName.MANAGER],
      })
      .expect(403);

    await request(server)
      .post('/leads')
      .set(authHeader(context.adminToken))
      .send({ title: `admin lead ${RUN_ID}`, source: 'e2e' })
      .expect(403);
  });

  it('BP4-PE lets ADMIN assign DIRECTOR, HEAD, or ACCOUNTANT', async () => {
    const attempts: RoleName[] = [
      RoleName.DIRECTOR,
      RoleName.ACCOUNTANT,
      RoleName.HEAD,
    ];

    for (const roleName of attempts) {
      const response = await request(server)
        .post('/users')
        .set(authHeader(context.adminToken))
        .send({
          email: `bp4-pe-${roleName.toLowerCase()}-${RUN_ID}@hpl.test`,
          password: TEST_PASSWORD,
          firstName: 'Business',
          lastName: roleName,
          roleNames: [roleName],
        })
        .expect(201);

      expect(bodyAs<EntityResponse>(response).id).toBeDefined();
    }

    const minted = await prisma.user.findMany({
      where: {
        email: {
          in: attempts.map(
            (roleName) => `bp4-pe-${roleName.toLowerCase()}-${RUN_ID}@hpl.test`,
          ),
        },
      },
      include: { roles: { include: { role: { select: { name: true } } } } },
    });
    expect(minted).toHaveLength(3);
    expect(
      minted
        .flatMap((user) => user.roles.map((item) => item.role.name))
        .sort(),
    ).toEqual(
      [RoleName.ACCOUNTANT, RoleName.DIRECTOR, RoleName.HEAD].sort(),
    );
  });

  it('BP4-PE still lets ADMIN create a normal technical/operational user', async () => {
    const created = await request(server)
      .post('/users')
      .set(authHeader(context.adminToken))
      .send({
        email: `bp4-pe-manager-${RUN_ID}@hpl.test`,
        password: TEST_PASSWORD,
        firstName: 'Ops',
        lastName: 'Manager',
        roleNames: [RoleName.MANAGER],
      })
      .expect(201);

    const userId = bodyAs<EntityResponse>(created).id;
    const roles = await prisma.userRole.findMany({
      where: { userId },
      include: { role: { select: { name: true } } },
    });
    expect(roles.map((item) => item.role.name)).toEqual([RoleName.MANAGER]);
  });

  it('BP4-PE has no API to grant protected permissions or rewrite role matrices', async () => {
    const me = await request(server)
      .get('/auth/me')
      .set(authHeader(context.adminToken))
      .expect(200);
    const adminId = bodyAs<{ id: string }>(me).id;

    await request(server)
      .post(`/users/${adminId}/permissions`)
      .set(authHeader(context.adminToken))
      .send({
        slugs: [
          'currency_rates:manage',
          'payments:confirm',
          'quotes:approve',
          'leads:commercial_qualify',
        ],
      })
      .expect(404);

    await request(server)
      .patch(`/users/${adminId}/roles`)
      .set(authHeader(context.adminToken))
      .send({ roleNames: [RoleName.DIRECTOR] })
      .expect(404);

    await request(server)
      .post('/permissions')
      .set(authHeader(context.adminToken))
      .send({ slug: 'currency_rates:manage' })
      .expect(404);

    await request(server)
      .patch(`/roles/${RoleName.DIRECTOR}/permissions`)
      .set(authHeader(context.adminToken))
      .send({ slugs: ['currency_rates:manage'] })
      .expect(404);

    const adminPerms = await prisma.userPermission.findMany({
      where: { userId: adminId },
    });
    expect(adminPerms).toHaveLength(0);
  });

  it('BP4-PE keeps DIRECTOR off the user-create assignment path', async () => {
    for (const roleName of [
      RoleName.DIRECTOR,
      RoleName.HEAD,
      RoleName.ACCOUNTANT,
      RoleName.MANAGER,
    ]) {
      await request(server)
        .post('/users')
        .set(authHeader(context.directorToken))
        .send({
          email: `bp4-pe-dir-${roleName.toLowerCase()}-${RUN_ID}@hpl.test`,
          password: TEST_PASSWORD,
          firstName: 'Director',
          lastName: 'Assign',
          roleNames: [roleName],
        })
        .expect(403);
    }
  });

  it('BP4-PE keeps lead-pool and system users as passive zero-role records', async () => {
    const pool = await prisma.user.findUniqueOrThrow({
      where: { email: 'lead-pool@hpl.com' },
      include: { roles: true, permissions: true },
    });
    const system = await prisma.user.findUniqueOrThrow({
      where: { email: 'system@hpl.com' },
      include: { roles: true, permissions: true },
    });

    expect(pool.roles).toEqual([]);
    expect(pool.permissions).toEqual([]);
    expect(system.roles).toEqual([]);
    expect(system.permissions).toEqual([]);

    const leadFactory = app.get(TelegramLeadFactory);
    const lead = await leadFactory.create({
      telegramUserId: `tg-pe-${RUN_ID}`,
      telegramUsername: 'pe_pool',
      formData: {
        name: 'Pool Passive',
        phone: `+99891${RUN_ID.slice(-7)}`,
        message: 'Privilege-escalation pool check',
      },
      updateId: `pe-pool-${RUN_ID}`,
      rawPayload: { source: 'e2e-pe' },
    });

    expect(lead.ownerId).toBe(pool.id);

    const activity = await prisma.activity.findFirst({
      where: {
        relatedType: 'Lead',
        relatedId: lead.id,
        authorId: system.id,
      },
    });
    expect(activity).not.toBeNull();
  });

  it('BP4-PE denies ADMIN password reset of DIRECTOR, HEAD, and ACCOUNTANT', async () => {
    const hijackPassword = 'HijackPassword123!';
    const targets: { id: string; email: string }[] = [
      {
        id: context.directorId,
        email: `director-${RUN_ID}@hpl.test`,
      },
      {
        id: context.accountantId,
        email: `accountant-${RUN_ID}@hpl.test`,
      },
      {
        id: context.headId,
        email: `head-${RUN_ID}@hpl.test`,
      },
    ];

    for (const target of targets) {
      const before = await prisma.user.findUniqueOrThrow({
        where: { id: target.id },
        select: { passwordHash: true },
      });

      const response = await request(server)
        .patch(`/users/${target.id}/reset-password`)
        .set(authHeader(context.adminToken))
        .send({ newPassword: hijackPassword })
        .expect(403);

      expect(bodyAs<{ errorCode?: string }>(response).errorCode).toBe(
        'PROTECTED_BUSINESS_ACCOUNT',
      );

      const after = await prisma.user.findUniqueOrThrow({
        where: { id: target.id },
        select: { passwordHash: true },
      });
      expect(after.passwordHash).toBe(before.passwordHash);

      await request(server)
        .post('/auth/login')
        .send({ email: target.email, password: TEST_PASSWORD })
        .expect(201);
      await request(server)
        .post('/auth/login')
        .send({ email: target.email, password: hijackPassword })
        .expect(401);
    }
  });

  it('BP4-PE still lets ADMIN reset a MANAGER password', async () => {
    const created = await request(server)
      .post('/users')
      .set(authHeader(context.adminToken))
      .send({
        email: `bp4-pe-mgr-reset-${RUN_ID}@hpl.test`,
        password: TEST_PASSWORD,
        firstName: 'Reset',
        lastName: 'Manager',
        roleNames: [RoleName.MANAGER],
      })
      .expect(201);
    const managerId = bodyAs<EntityResponse>(created).id;
    const newPassword = 'ManagerReset123!';

    await request(server)
      .patch(`/users/${managerId}/reset-password`)
      .set(authHeader(context.adminToken))
      .send({ newPassword })
      .expect(200);

    await request(server)
      .post('/auth/login')
      .send({
        email: `bp4-pe-mgr-reset-${RUN_ID}@hpl.test`,
        password: TEST_PASSWORD,
      })
      .expect(401);
    await request(server)
      .post('/auth/login')
      .send({
        email: `bp4-pe-mgr-reset-${RUN_ID}@hpl.test`,
        password: newPassword,
      })
      .expect(201);
  });

  it('BP4-PE lets ADMIN disable and enable a DIRECTOR without changing authority', async () => {
    const directorId = context.directorId;
    const before = await prisma.user.findUniqueOrThrow({
      where: { id: directorId },
      select: { passwordHash: true, isActive: true },
    });
    const rolesBefore = await prisma.userRole.findMany({
      where: { userId: directorId },
      include: { role: { select: { name: true } } },
    });

    try {
      await request(server)
        .patch(`/users/${directorId}/status`)
        .set(authHeader(context.adminToken))
        .send({ isActive: false })
        .expect(200);

      const disabled = await prisma.user.findUniqueOrThrow({
        where: { id: directorId },
        include: {
          roles: { include: { role: { select: { name: true } } } },
          permissions: true,
        },
      });
      expect(disabled.isActive).toBe(false);
      expect(disabled.passwordHash).toBe(before.passwordHash);
      expect(disabled.permissions).toEqual([]);
      expect(disabled.roles.map((item) => item.role.name)).toEqual(
        rolesBefore.map((item) => item.role.name),
      );

      await request(server)
        .post('/auth/login')
        .send({
          email: `director-${RUN_ID}@hpl.test`,
          password: TEST_PASSWORD,
        })
        .expect(401);
    } finally {
      await request(server)
        .patch(`/users/${directorId}/status`)
        .set(authHeader(context.adminToken))
        .send({ isActive: true })
        .expect(200);
    }

    const restored = await prisma.user.findUniqueOrThrow({
      where: { id: directorId },
      select: { isActive: true, passwordHash: true },
    });
    expect(restored.isActive).toBe(true);
    expect(restored.passwordHash).toBe(before.passwordHash);

    await request(server)
      .post('/auth/login')
      .send({
        email: `director-${RUN_ID}@hpl.test`,
        password: TEST_PASSWORD,
      })
      .expect(201);
  });

  it('BP4-PE has no alternate credential-takeover API', async () => {
    await request(server)
      .post('/auth/change-password')
      .set(authHeader(context.adminToken))
      .send({
        oldPassword: TEST_PASSWORD,
        newPassword: 'HijackPassword123!',
      })
      .expect(404);

    await request(server)
      .patch(`/users/${context.directorId}`)
      .set(authHeader(context.adminToken))
      .send({
        email: `taken-over-${RUN_ID}@hpl.test`,
        password: 'HijackPassword123!',
      })
      .expect(404);

    await request(server)
      .post('/auth/forgot-password')
      .set(authHeader(context.adminToken))
      .send({ email: `director-${RUN_ID}@hpl.test` })
      .expect(404);

    await request(server)
      .post('/users/invite')
      .set(authHeader(context.adminToken))
      .send({ email: `director-${RUN_ID}@hpl.test` })
      .expect(404);
  });

  it('GF1 DIRECTOR+ADMIN keeps Director visibility and FX without HEAD/ACCOUNTANT powers', async () => {
    const actor = await loginDualRole('director-admin', [
      RoleName.DIRECTOR,
      RoleName.ADMIN,
    ]);
    const foreignDeal = await createDeal(prisma, context);
    const foreignOrder = await createWonOrder();

    const dealCard = await request(server)
      .get(`/deals/${foreignDeal.id}`)
      .set(authHeader(actor.token))
      .expect(200);
    expect(bodyAs<{ ownerId: string }>(dealCard).ownerId).toBe(
      context.managerId,
    );

    const storedDeal = await prisma.deal.findUniqueOrThrow({
      where: { id: foreignDeal.id },
      select: { id: true, ownerId: true, title: true },
    });
    expect(storedDeal.ownerId).toBe(context.managerId);

    const deals = await request(server)
      .get('/deals')
      .query({ search: storedDeal.title, ownerId: context.managerId })
      .set(authHeader(actor.token))
      .expect(200);
    expect(
      bodyAs<{ items: { id: string; ownerId: string }[] }>(deals).items.some(
        (item) =>
          item.id === storedDeal.id && item.ownerId === context.managerId,
      ),
    ).toBe(true);

    const orderCard = await request(server)
      .get(`/orders/${foreignOrder.id}`)
      .set(authHeader(actor.token))
      .expect(200);
    expect(bodyAs<EntityResponse>(orderCard).id).toBe(foreignOrder.id);

    await request(server)
      .post('/currency-rates')
      .set(authHeader(actor.token))
      .send({ rate: '0.1' })
      .expect(201);

    const leadId = await createQualifiedLead(`gf1-dir-admin ${RUN_ID}`);
    const stage2 = await commercialPayload();
    await request(server)
      .post(`/leads/${leadId}/commercial-qualification`)
      .set(authHeader(actor.token))
      .send(stage2)
      .expect(403);

    const quoteId = await createSentPanelQuote();
    await request(server)
      .patch(`/quotes/${quoteId}/status`)
      .set(authHeader(actor.token))
      .send({ status: 'approved' })
      .expect(403);

    const payment = await createPayment(
      foreignOrder.id,
      Number(foreignOrder.totalAmount),
    );
    await request(server)
      .patch(`/orders/payments/${payment.id}/confirm`)
      .set(authHeader(actor.token))
      .send({ status: PaymentRecordStatus.CONFIRMED })
      .expect(403);

    const created = await request(server)
      .post('/users')
      .set(authHeader(actor.token))
      .send({
        email: `gf1-dir-admin-user-${RUN_ID}@hpl.test`,
        password: TEST_PASSWORD,
        firstName: 'Tech',
        lastName: 'FromDirAdmin',
        roleNames: [RoleName.ENGINEER],
      })
      .expect(201);
    expect(bodyAs<EntityResponse>(created).id).toBeDefined();
  });

  it('GF1 HEAD+ADMIN keeps HEAD deal/order authority plus technical admin', async () => {
    const actor = await loginDualRole('head-admin', [
      RoleName.HEAD,
      RoleName.ADMIN,
    ]);
    const foreignDeal = await createDeal(prisma, context);
    const foreignOrder = await createWonOrder();

    const dealCard = await request(server)
      .get(`/deals/${foreignDeal.id}`)
      .set(authHeader(actor.token))
      .expect(200);
    expect(bodyAs<{ ownerId: string }>(dealCard).ownerId).toBe(
      context.managerId,
    );

    const title = `GF1 HEAD+ADMIN ${RUN_ID}`;
    const updated = await request(server)
      .patch(`/deals/${foreignDeal.id}`)
      .set(authHeader(actor.token))
      .send({ title })
      .expect(200);
    expect(bodyAs<{ title: string }>(updated).title).toBe(title);

    await request(server)
      .get(`/orders/${foreignOrder.id}`)
      .set(authHeader(actor.token))
      .expect(200);

    const leadId = await createQualifiedLead(`gf1-head-admin ${RUN_ID}`);
    await request(server)
      .post(`/leads/${leadId}/commercial-qualification`)
      .set(authHeader(actor.token))
      .send(await commercialPayload())
      .expect(201);

    const quoteId = await createSentPanelQuote();
    await request(server)
      .patch(`/quotes/${quoteId}/status`)
      .set(authHeader(actor.token))
      .send({ status: 'approved' })
      .expect(200);

    await request(server)
      .post('/currency-rates')
      .set(authHeader(actor.token))
      .send({ rate: '0.15' })
      .expect(403);

    const payment = await createPayment(
      foreignOrder.id,
      Number(foreignOrder.totalAmount),
    );
    await request(server)
      .patch(`/orders/payments/${payment.id}/confirm`)
      .set(authHeader(actor.token))
      .send({ status: PaymentRecordStatus.CONFIRMED })
      .expect(403);

    await request(server)
      .post('/users')
      .set(authHeader(actor.token))
      .send({
        email: `gf1-head-admin-user-${RUN_ID}@hpl.test`,
        password: TEST_PASSWORD,
        firstName: 'Tech',
        lastName: 'FromHeadAdmin',
        roleNames: [RoleName.ENGINEER],
      })
      .expect(201);
  });

  it('GF1 ACCOUNTANT+ADMIN can confirm payment and use technical admin', async () => {
    const actor = await loginDualRole('accountant-admin', [
      RoleName.ACCOUNTANT,
      RoleName.ADMIN,
    ]);
    const foreignDeal = await createDeal(prisma, context);
    const foreignOrder = await createWonOrder();
    const payment = await createPayment(
      foreignOrder.id,
      Number(foreignOrder.totalAmount),
    );

    await request(server)
      .get(`/deals/${foreignDeal.id}`)
      .set(authHeader(actor.token))
      .expect(200);
    await request(server)
      .get(`/orders/${foreignOrder.id}`)
      .set(authHeader(actor.token))
      .expect(200);

    await request(server)
      .patch(`/orders/payments/${payment.id}/confirm`)
      .set(authHeader(actor.token))
      .send({ status: PaymentRecordStatus.CONFIRMED })
      .expect(200);

    await request(server)
      .post('/users')
      .set(authHeader(actor.token))
      .send({
        email: `gf1-acc-admin-user-${RUN_ID}@hpl.test`,
        password: TEST_PASSWORD,
        firstName: 'Tech',
        lastName: 'FromAccAdmin',
        roleNames: [RoleName.ENGINEER],
      })
      .expect(201);

    await request(server)
      .post('/currency-rates')
      .set(authHeader(actor.token))
      .send({ rate: '0.15' })
      .expect(403);

    const leadId = await createQualifiedLead(`gf1-acc-admin ${RUN_ID}`);
    await request(server)
      .post(`/leads/${leadId}/commercial-qualification`)
      .set(authHeader(actor.token))
      .send(await commercialPayload())
      .expect(403);

    const quoteId = await createSentPanelQuote();
    await request(server)
      .patch(`/quotes/${quoteId}/status`)
      .set(authHeader(actor.token))
      .send({ status: 'approved' })
      .expect(403);
  });

  it('GF1 ADMIN-only stays technical and cannot read another owner deal/order', async () => {
    const foreignDeal = await createDeal(prisma, context);
    const foreignOrder = await createWonOrder();

    await request(server)
      .get(`/deals/${foreignDeal.id}`)
      .set(authHeader(context.adminToken))
      .expect(403);
    await request(server)
      .get(`/orders/${foreignOrder.id}`)
      .set(authHeader(context.adminToken))
      .expect(403);
    await request(server)
      .patch(`/deals/${foreignDeal.id}`)
      .set(authHeader(context.adminToken))
      .send({ title: 'admin hijack' })
      .expect(403);
    await request(server)
      .post('/currency-rates')
      .set(authHeader(context.adminToken))
      .send({ rate: '0.15' })
      .expect(403);

    const leadId = await createQualifiedLead(`gf1-admin-only ${RUN_ID}`);
    await request(server)
      .post(`/leads/${leadId}/commercial-qualification`)
      .set(authHeader(context.adminToken))
      .send(await commercialPayload())
      .expect(403);

    const quoteId = await createSentPanelQuote();
    await request(server)
      .patch(`/quotes/${quoteId}/status`)
      .set(authHeader(context.adminToken))
      .send({ status: 'approved' })
      .expect(403);

    const payment = await createPayment(
      foreignOrder.id,
      Number(foreignOrder.totalAmount),
    );
    await request(server)
      .patch(`/orders/payments/${payment.id}/confirm`)
      .set(authHeader(context.adminToken))
      .send({ status: PaymentRecordStatus.CONFIRMED })
      .expect(403);

    await request(server)
      .post('/users')
      .set(authHeader(context.adminToken))
      .send({
        email: `gf1-admin-only-user-${RUN_ID}@hpl.test`,
        password: TEST_PASSWORD,
        firstName: 'Tech',
        lastName: 'AdminOnly',
        roleNames: [RoleName.ENGINEER],
      })
      .expect(201);
  });

  it('GF1 MANAGER+ADMIN stays owner-scoped and does not gain HEAD/ACCOUNTANT/DIRECTOR authority', async () => {
    const actor = await loginDualRole('manager-admin', [
      RoleName.MANAGER,
      RoleName.ADMIN,
    ]);
    const foreignDeal = await createDeal(prisma, context);
    const ownDeal = await request(server)
      .post('/deals')
      .set(authHeader(actor.token))
      .send({
        title: `GF1 own deal ${RUN_ID}`,
        clientId: context.clientId,
        items: [skuItemPayload({ quantitySheets: 1, quantityM2: 1 })],
      })
      .expect(201);

    await request(server)
      .get(`/deals/${foreignDeal.id}`)
      .set(authHeader(actor.token))
      .expect(403);
    await request(server)
      .get(`/deals/${bodyAs<EntityResponse>(ownDeal).id}`)
      .set(authHeader(actor.token))
      .expect(200);

    await request(server)
      .post('/users')
      .set(authHeader(actor.token))
      .send({
        email: `gf1-mgr-admin-user-${RUN_ID}@hpl.test`,
        password: TEST_PASSWORD,
        firstName: 'Tech',
        lastName: 'FromMgrAdmin',
        roleNames: [RoleName.ENGINEER],
      })
      .expect(201);

    await request(server)
      .post('/currency-rates')
      .set(authHeader(actor.token))
      .send({ rate: '0.15' })
      .expect(403);

    const leadId = await createQualifiedLead(`gf1-mgr-admin ${RUN_ID}`);
    await request(server)
      .post(`/leads/${leadId}/commercial-qualification`)
      .set(authHeader(actor.token))
      .send(await commercialPayload())
      .expect(403);

    const quoteId = await createSentPanelQuote();
    await request(server)
      .patch(`/quotes/${quoteId}/status`)
      .set(authHeader(actor.token))
      .send({ status: 'approved' })
      .expect(403);

    const foreignOrder = await createWonOrder();
    const payment = await createPayment(
      foreignOrder.id,
      Number(foreignOrder.totalAmount),
    );
    await request(server)
      .patch(`/orders/payments/${payment.id}/confirm`)
      .set(authHeader(actor.token))
      .send({ status: PaymentRecordStatus.CONFIRMED })
      .expect(403);
  });

  it('BP4 lets ENGINEER authenticate without inheriting business permissions', async () => {
    const me = await request(server)
      .get('/auth/me')
      .set(authHeader(context.engineerToken))
      .expect(200);
    expect(bodyAs<{ email: string }>(me).email).toBe(
      `engineer-${RUN_ID}@hpl.test`,
    );

    await request(server)
      .post('/leads')
      .set(authHeader(context.engineerToken))
      .send({ title: `engineer lead ${RUN_ID}`, source: 'e2e' })
      .expect(403);
    await request(server)
      .post('/currency-rates')
      .set(authHeader(context.engineerToken))
      .send({ rate: '0.3' })
      .expect(403);
    await request(server)
      .post('/inventory/expected-receipts')
      .set(authHeader(context.engineerToken))
      .send({
        supplierId: (
          await prisma.supplier.findUniqueOrThrow({
            where: { code: `QA-SUP-${RUN_ID}` },
          })
        ).id,
        expectedDate: futureIso(1),
        items: [{ productId: context.productId, quantity: 1 }],
      })
      .expect(403);
  });

  it('Stage 1 assigns an engineer without changing Lead.ownerId', async () => {
    const leadResponse = await request(server)
      .post('/leads')
      .set(authHeader(context.managerToken))
      .send({
        title: `Engineering lead ${RUN_ID}`,
        source: 'e2e',
        clientId: context.clientId,
      })
      .expect(201);
    const leadId = bodyAs<LeadResponse>(leadResponse).id;
    await qualifyLeadStage1(leadId, true);

    const assigned = await request(server)
      .post(`/engineering/leads/${leadId}/assign`)
      .set(authHeader(context.managerToken))
      .send({ engineerId: context.engineerId })
      .expect(201);
    const body = bodyAs<{ ownerId: string; created: boolean }>(assigned);
    expect(body.ownerId).toBe(context.managerId);
    expect(body.created).toBe(true);

    await request(server)
      .get(`/engineering/leads/${leadId}`)
      .set(authHeader(context.engineerToken))
      .expect(200);

    const stored = await prisma.lead.findUniqueOrThrow({
      where: { id: leadId },
    });
    expect(stored.ownerId).toBe(context.managerId);
  });

  it('Stage 3 lets HEAD approve subsystem commercial cost without creating a Quote', async () => {
    const { leadId, quotesBefore, dealsBefore } =
      await prepareSubsystemCommercial(context.headToken);
    const after = await prisma.panelQuote.count();
    expect(after).toBe(quotesBefore);
    const dealsAfter = await prisma.deal.count();
    expect(dealsAfter).toBe(dealsBefore);

    const commercial = await prisma.facadeCommercialCalculation.findFirstOrThrow({
      where: { leadId, isCurrent: true },
    });
    expect(commercial.status).toBe('APPROVED');
    expect(commercial.approvedById).toBe(context.headId);
    expect(commercial.approverRoleSnapshot).toBe(RoleName.HEAD);
    expect(commercial.quoteCreated).toBe(false);

    const managerView = await request(server)
      .get(`/leads/${leadId}/facade-commercial`)
      .set(authHeader(context.managerToken))
      .expect(200);
    const managerBody = bodyAs<{
      canApprove: boolean;
      canReadPurchase: boolean;
      calculation: {
        approvedCustomerAmount: string | null;
        items: Array<{ purchasePrice: string | null }>;
      };
    }>(managerView);
    expect(managerBody.canApprove).toBe(false);
    expect(managerBody.canReadPurchase).toBe(false);
    expect(Number(managerBody.calculation.approvedCustomerAmount)).toBe(8000);
    expect(managerBody.calculation.items.every((item) => item.purchasePrice === null)).toBe(
      true,
    );

    await request(server)
      .post(`/leads/${leadId}/facade-commercial/approve`)
      .set(authHeader(context.engineerToken))
      .send({ expectedRevision: commercial.revision })
      .expect(403);
    await request(server)
      .post(`/leads/${leadId}/facade-commercial/approve`)
      .set(authHeader(context.managerToken))
      .send({ expectedRevision: commercial.revision })
      .expect(403);
  });

  it('Stage 3 lets DIRECTOR approve subsystem cost and still forbids quotes:approve', async () => {
    const { leadId } = await prepareSubsystemCommercial(context.directorToken);
    const commercial = await prisma.facadeCommercialCalculation.findFirstOrThrow({
      where: { leadId, isCurrent: true },
    });
    expect(commercial.approverRoleSnapshot).toBe(RoleName.DIRECTOR);
    expect(Number(commercial.approvedCustomerAmount)).toBe(8000);

    const quoteId = await createSentPanelQuote();
    await request(server)
      .patch(`/quotes/${quoteId}/status`)
      .set(authHeader(context.directorToken))
      .send({ status: 'approved' })
      .expect(403);

    await request(server)
      .post(`/engineering/leads/${leadId}/facade/calculate`)
      .set(authHeader(context.engineerToken))
      .send({
        configCode: 'HPL_FACADE_BASE_1220_3050',
        claddingAreaM2: '1200',
        expectedRevision: 1,
      })
      .expect(201);

    const workspace = await request(server)
      .get(`/leads/${leadId}/facade-commercial`)
      .set(authHeader(context.headToken))
      .expect(200);
    expect(bodyAs<{ staleTechnicalBasis: boolean }>(workspace).staleTechnicalBasis).toBe(
      true,
    );
    const frozen = await prisma.facadeCommercialCalculation.findFirstOrThrow({
      where: { leadId, isCurrent: true, status: 'APPROVED' },
    });
    expect(Number(frozen.approvedCustomerAmount)).toBe(8000);
    expect(frozen.facadeCalculationRevision).toBe(1);
  });

  it('Stage 4 lets HEAD approve installation cost without Quote, Deal, or INSTALLER', async () => {
    const { leadId, quotesBefore, dealsBefore } =
      await prepareInstallationCommercial(context.headToken);
    expect(await prisma.panelQuote.count()).toBe(quotesBefore);
    expect(await prisma.deal.count()).toBe(dealsBefore);
    expect(Object.values(RoleName)).not.toContain('INSTALLER');

    const commercial =
      await prisma.installationCommercialCalculation.findFirstOrThrow({
        where: { leadId, isCurrent: true },
      });
    expect(commercial.status).toBe('APPROVED');
    expect(commercial.approvedById).toBe(context.headId);
    expect(commercial.approverRoleSnapshot).toBe(RoleName.HEAD);
    expect(commercial.quoteCreated).toBe(false);
    expect(Number(commercial.approvedCustomerAmount)).toBe(15000);

    const managerView = await request(server)
      .get(`/leads/${leadId}/installation-commercial`)
      .set(authHeader(context.managerToken))
      .expect(200);
    const managerBody = bodyAs<{
      canApprove: boolean;
      canReadCost: boolean;
      calculation: {
        approvedCustomerAmount: string | null;
        items: Array<{ pricePerUnit: string | null }>;
      };
    }>(managerView);
    expect(managerBody.canApprove).toBe(false);
    expect(managerBody.canReadCost).toBe(false);
    expect(Number(managerBody.calculation.approvedCustomerAmount)).toBe(15000);
    expect(
      managerBody.calculation.items.every((item) => item.pricePerUnit === null),
    ).toBe(true);

    await request(server)
      .post(`/leads/${leadId}/installation-commercial/approve`)
      .set(authHeader(context.engineerToken))
      .send({ expectedRevision: commercial.revision })
      .expect(403);
    await request(server)
      .post(`/leads/${leadId}/installation-commercial/approve`)
      .set(authHeader(context.managerToken))
      .send({ expectedRevision: commercial.revision })
      .expect(403);
    await request(server)
      .post('/references/installation-rates')
      .set(authHeader(context.engineerToken))
      .send({
        contractorId: '00000000-0000-4000-8000-000000000001',
        workTypeId: '00000000-0000-4000-8000-000000000002',
        unit: 'M2',
        pricePerUnit: '1',
        currency: 'USD',
        validFrom: new Date().toISOString(),
      })
      .expect(403);
  });

  it('Stage 4 lets DIRECTOR approve installation and still forbids quotes:approve', async () => {
    const { leadId } = await prepareInstallationCommercial(context.directorToken, {
      ventFacadeKitRequired: true,
    });
    const commercial =
      await prisma.installationCommercialCalculation.findFirstOrThrow({
        where: { leadId, isCurrent: true },
      });
    expect(commercial.approverRoleSnapshot).toBe(RoleName.DIRECTOR);

    const facade = await prisma.facadeSubsystemCalculation.findUnique({
      where: { leadId },
    });
    expect(facade).toBeNull();

    const quoteId = await createSentPanelQuote();
    await request(server)
      .patch(`/quotes/${quoteId}/status`)
      .set(authHeader(context.directorToken))
      .send({ status: 'approved' })
      .expect(403);

    await request(server)
      .patch(`/engineering/leads/${leadId}/installation`)
      .set(authHeader(context.engineerToken))
      .send({
        expectedRevision: 2,
        items: [
          {
            workTypeId: (
              await prisma.installationCalculationItem.findFirstOrThrow({
                where: { calculation: { leadId } },
              })
            ).workTypeId,
            quantity: '1200',
          },
        ],
      })
      .expect(200);

    const workspace = await request(server)
      .get(`/leads/${leadId}/installation-commercial`)
      .set(authHeader(context.headToken))
      .expect(200);
    expect(bodyAs<{ staleTechnicalBasis: boolean }>(workspace).staleTechnicalBasis).toBe(
      true,
    );
    const frozen =
      await prisma.installationCommercialCalculation.findFirstOrThrow({
        where: { leadId, isCurrent: true, status: 'APPROVED' },
      });
    expect(Number(frozen.approvedCustomerAmount)).toBe(15000);
  });

  it('Stage 4 does not auto-create an installation calculation for HPL-only', async () => {
    const leadId = await createQualifiedLead(
      `Stage4 hpl-only ${RUN_ID}-${Math.random().toString(16).slice(2)}`,
    );
    await request(server)
      .post(`/engineering/leads/${leadId}/assign`)
      .set(authHeader(context.managerToken))
      .send({ engineerId: context.engineerId })
      .expect(409);
    const calculation = await prisma.installationCalculation.findUnique({
      where: { leadId },
    });
    expect(calculation).toBeNull();
  });

  it('uses canonical warehouse RBAC on legacy mutation routes', async () => {
    const supplier = await prisma.supplier.findUniqueOrThrow({
      where: { code: `QA-SUP-${RUN_ID}` },
    });
    const payload = {
      supplierId: supplier.id,
      expectedDate: futureIso(1),
      items: [{ productId: context.productId, quantity: 2 }],
    };

    await request(server)
      .post('/inventory/expected-receipts')
      .set(authHeader(context.storekeeperToken))
      .send(payload)
      .expect(403);
    await request(server)
      .post('/inventory/expected-receipts')
      .set(authHeader(context.adminToken))
      .send(payload)
      .expect(403);

    const plannedResponse = await request(server)
      .post('/inventory/expected-receipts')
      .set(authHeader(context.headToken))
      .send(payload)
      .expect(201);
    const planned = bodyAs<EntityResponse & { items: EntityResponse[] }>(
      plannedResponse,
    );
    const receivePayload = {
      clientReceiptId: `legacy-rbac-${RUN_ID}`,
      items: [{ itemId: planned.items[0].id, acceptedQuantity: 1 }],
    };

    await request(server)
      .post(`/inventory/expected-receipts/${planned.id}/receive`)
      .set(authHeader(context.headToken))
      .send(receivePayload)
      .expect(403);
    await request(server)
      .post(`/inventory/expected-receipts/${planned.id}/receive`)
      .set(authHeader(context.adminToken))
      .send(receivePayload)
      .expect(403);
    await request(server)
      .patch(`/inventory/warehouse-purchases/${planned.id}`)
      .set(authHeader(context.storekeeperToken))
      .send({ comment: 'forbidden plan edit' })
      .expect(403);
    await request(server)
      .post(`/inventory/expected-receipts/${planned.id}/receive`)
      .set(authHeader(context.storekeeperToken))
      .send(receivePayload)
      .expect(201);
  });

  it('serializes warehouse receive against cancel and quantity reduction', async () => {
    const supplier = await prisma.supplier.findUniqueOrThrow({
      where: { code: `QA-SUP-${RUN_ID}` },
    });
    const createPlan = async (quantity: number) => {
      const response = await request(server)
        .post('/inventory/warehouse-purchases')
        .set(authHeader(context.headToken))
        .send({
          supplierId: supplier.id,
          expectedDate: futureIso(1),
          items: [{ productId: context.productId, quantity }],
        })
        .expect(201);
      return bodyAs<EntityResponse & { items: EntityResponse[] }>(response);
    };

    const cancelRace = await createPlan(1);
    const [receiveResult, cancelResult] = await Promise.all([
      request(server)
        .post(`/inventory/warehouse-purchases/${cancelRace.id}/receipts`)
        .set(authHeader(context.storekeeperToken))
        .send({
          clientReceiptId: `cancel-race-${RUN_ID}`,
          items: [{ itemId: cancelRace.items[0].id, acceptedQuantity: 1 }],
        }),
      request(server)
        .post(`/inventory/warehouse-purchases/${cancelRace.id}/cancel`)
        .set(authHeader(context.headToken)),
    ]);
    expect([receiveResult.status, cancelResult.status].sort()).toEqual([
      201, 400,
    ]);

    const updateRace = await createPlan(2);
    const [received, reduced] = await Promise.all([
      request(server)
        .post(`/inventory/warehouse-purchases/${updateRace.id}/receipts`)
        .set(authHeader(context.storekeeperToken))
        .send({
          clientReceiptId: `update-race-${RUN_ID}`,
          items: [{ itemId: updateRace.items[0].id, acceptedQuantity: 2 }],
        }),
      request(server)
        .patch(`/inventory/warehouse-purchases/${updateRace.id}`)
        .set(authHeader(context.headToken))
        .send({
          items: [{ itemId: updateRace.items[0].id, orderedQuantity: 1 }],
        }),
    ]);
    expect([received.status, reduced.status]).toContain(400);
    expect(
      [received.status, reduced.status].filter((status) => status < 300),
    ).toHaveLength(1);
    const finalItem = await prisma.expectedReceiptItem.findUniqueOrThrow({
      where: { id: updateRace.items[0].id },
    });
    expect(finalItem.quantity).toBeGreaterThanOrEqual(
      finalItem.receivedQuantity,
    );
  });

  it('prevents concurrent warehouse over-receipt', async () => {
    const supplier = await prisma.supplier.findUniqueOrThrow({
      where: { code: `QA-SUP-${RUN_ID}` },
    });
    const response = await request(server)
      .post('/inventory/warehouse-purchases')
      .set(authHeader(context.headToken))
      .send({
        supplierId: supplier.id,
        expectedDate: futureIso(1),
        items: [{ productId: context.productId, quantity: 1 }],
      })
      .expect(201);
    const plan = bodyAs<EntityResponse & { items: EntityResponse[] }>(response);
    const receive = () =>
      request(server)
        .post(`/inventory/warehouse-purchases/${plan.id}/receipts`)
        .set(authHeader(context.storekeeperToken))
        .send({ items: [{ itemId: plan.items[0].id, acceptedQuantity: 1 }] });

    const results = await Promise.all([receive(), receive()]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 400]);
    const finalItem = await prisma.expectedReceiptItem.findUniqueOrThrow({
      where: { id: plan.items[0].id },
    });
    expect(finalItem.receivedQuantity).toBe(1);
  });

  it('BP4 seed convergence removes forbidden leftover permissions', async () => {
    const headRole = await prisma.role.findUniqueOrThrow({
      where: { name: RoleName.HEAD },
      select: { id: true },
    });
    const adminRole = await prisma.role.findUniqueOrThrow({
      where: { name: RoleName.ADMIN },
      select: { id: true },
    });
    const extraSlugs = [
      'currency_rates:manage',
      'payments:confirm',
      'quotes:approve',
      'leads:commercial_qualify',
    ];

    for (const slug of extraSlugs) {
      const permission = await prisma.permission.findUniqueOrThrow({
        where: { slug },
        select: { id: true },
      });
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: headRole.id,
            permissionId: permission.id,
          },
        },
        update: {},
        create: { roleId: headRole.id, permissionId: permission.id },
      });
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: adminRole.id,
            permissionId: permission.id,
          },
        },
        update: {},
        create: { roleId: adminRole.id, permissionId: permission.id },
      });
    }

    await synchronizeRbac(prisma);

    const headPerms = await prisma.rolePermission.findMany({
      where: { roleId: headRole.id },
      include: { permission: { select: { slug: true } } },
    });
    const adminPerms = await prisma.rolePermission.findMany({
      where: { roleId: adminRole.id },
      include: { permission: { select: { slug: true } } },
    });
    const headSlugs = headPerms.map((item) => item.permission.slug);
    const adminSlugs = adminPerms.map((item) => item.permission.slug);

    expect(headSlugs).not.toContain('currency_rates:manage');
    expect(headSlugs).not.toContain('payments:confirm');
    expect(adminSlugs).not.toContain('payments:confirm');
    expect(adminSlugs).not.toContain('quotes:approve');
    expect(adminSlugs).not.toContain('leads:commercial_qualify');
    expect(adminSlugs.sort()).toEqual(
      [...ROLE_PERMISSION_SLUGS[RoleName.ADMIN]].sort(),
    );
    expect(headSlugs.sort()).toEqual(
      [...ROLE_PERMISSION_SLUGS[RoleName.HEAD]].sort(),
    );
  });

  it('BP4 target roles exist and OBSERVER does not', async () => {
    const roles = await prisma.role.findMany({ select: { name: true } });
    const names = roles.map((role) => role.name).sort();
    expect(names).toEqual([...TARGET_ROLE_NAMES].sort());
    expect(names).not.toContain('OBSERVER');

    const pool = await prisma.user.findUniqueOrThrow({
      where: { email: 'lead-pool@hpl.com' },
      include: { roles: { include: { role: true } } },
    });
    expect(pool.roles).toEqual([]);
  });

  it('converts one quote concurrently into exactly one deal', async () => {
    const quoteId = await createApprovedPanelQuote();
    const quote = await prisma.panelQuote.findUniqueOrThrow({
      where: { id: quoteId },
      select: { leadId: true },
    });

    await qualifyLeadStage1(quote.leadId);

    const [first, second] = await Promise.all([
      request(server)
        .post(`/quotes/${quoteId}/convert-to-deal`)
        .set(authHeader(context.headToken)),
      request(server)
        .post(`/quotes/${quoteId}/convert-to-deal`)
        .set(authHeader(context.headToken)),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);

    const winner = first.status === 201 ? first : second;
    const loser = first.status === 201 ? second : first;
    const winnerBody = bodyAs<{ dealId: string }>(winner);
    expect(winnerBody.dealId).toBeTruthy();
    expect(loser.status).toBe(409);

    const deals = await prisma.deal.findMany({
      where: { convertedFromLead: { is: { id: quote.leadId } } },
    });
    expect(deals).toHaveLength(1);
    expect(deals[0]?.id).toBe(winnerBody.dealId);

    const lead = await prisma.lead.findUniqueOrThrow({
      where: { id: quote.leadId },
    });
    const convertedQuote = await prisma.panelQuote.findUniqueOrThrow({
      where: { id: quoteId },
    });
    expect(lead.dealId).toBe(winnerBody.dealId);
    expect(lead.status).toBe('CONVERTED');
    expect(convertedQuote.dealId).toBe(winnerBody.dealId);
  });

  it('rejects quote creation from a calculation outside the Stage-2 path', async () => {
    const leadResponse = await request(server)
      .post('/leads')
      .set(authHeader(context.managerToken))
      .send({
        title: `Legacy calc quote ${RUN_ID}`,
        source: 'e2e',
        clientId: context.clientId,
      })
      .expect(201);
    const leadId = bodyAs<EntityResponse>(leadResponse).id;

    const panelType = await prisma.panelType.findFirstOrThrow({
      where: { code: 'exterior_with_uv' },
    });
    const panelSize = await prisma.panelSize.findFirstOrThrow({
      where: { widthMm: 1220, heightMm: 2440 },
    });
    const supplier = await prisma.supplier.findFirstOrThrow({
      where: { code: 'wuya' },
    });
    const qualityClass = await prisma.qualityClass.findFirstOrThrow({
      where: { code: 'economy' },
    });

    const calculation = await prisma.calculationSession.create({
      data: {
        leadId,
        createdById: context.managerId,
        status: 'finalized',
        totalAmount: new Prisma.Decimal('20'),
        displayCurrency: 'USD',
        commercialConfirmedAt: null,
        items: {
          create: {
            panelTypeId: panelType.id,
            panelSizeId: panelSize.id,
            thicknessMm: 10,
            supplierId: supplier.id,
            qualityClassId: qualityClass.id,
            requiredAreaM2: new Prisma.Decimal('2.9768'),
            sheetsCount: 1,
            supplierPricePerM2: new Prisma.Decimal('100'),
            clientPricePerM2: new Prisma.Decimal('20'),
            pricePerM2: new Prisma.Decimal('20'),
            pricePerSheet: new Prisma.Decimal('20'),
            totalPrice: new Prisma.Decimal('20'),
            wastePercent: new Prisma.Decimal('0'),
          },
        },
      },
    });

    const convert = await request(server)
      .post(`/calculations/${calculation.id}/convert-to-quote`)
      .set(authHeader(context.headToken))
      .send({ clientComment: 'legacy bypass' })
      .expect(409);

    expect(bodyAs<{ errorCode?: string }>(convert).errorCode).toBe(
      'CALCULATION_NOT_COMMERCIALLY_QUALIFIED',
    );
  });

  it('repeated qualify and forbidden Manager conversion create no duplicate Deal', async () => {
    const quoteId = await createApprovedPanelQuote();
    const quote = await prisma.panelQuote.findUniqueOrThrow({
      where: { id: quoteId },
      select: { leadId: true },
    });

    const [qualify, convert] = await Promise.all([
      request(server)
        .post(`/leads/${quote.leadId}/qualify`)
        .set(authHeader(context.managerToken))
        .send({
          clientId: context.clientId,
          projectObjectId: context.projectObjectId,
          needDescription: 'HPL panels for lobby',
          decisionMakerContact: 'Chief architect',
          qualification: await stage1QualificationPayload(prisma, {
            installationRequired: false,
          }),
        }),
      request(server)
        .post(`/quotes/${quoteId}/convert-to-deal`)
        .set(authHeader(context.managerToken)),
    ]);

    expect(qualify.status).toBe(201);
    expect(bodyAs<LeadResponse>(qualify).dealId).toBeTruthy();

    const lead = await prisma.lead.findUniqueOrThrow({
      where: { id: quote.leadId },
    });
    const quoteDeals = await prisma.deal.findMany({
      where: { title: `КП #${quoteId.slice(0, 8)}` },
    });
    const qualifyDeals = await prisma.deal.findMany({
      where: { title: lead.title },
    });

    expect(qualifyDeals).toHaveLength(1);
    expect(quoteDeals).toHaveLength(0);
    expect(convert.status).toBe(403);
    expect(lead.status).toBe('QUALIFIED');
    expect(lead.dealId).toBe(bodyAs<LeadResponse>(qualify).dealId);
  });

  it('locks commercial item mutations after WON', async () => {
    const wonDeal = await createDeal(prisma, context, DealStage.WON);
    const addPayload = {
      items: [skuItemPayload({ quantitySheets: 3 })],
    };
    const qtyPayload = {
      items: [skuItemPayload({ quantitySheets: 4 })],
    };
    const pricePayload = {
      items: [skuItemPayload({ unitPrice: 120 })],
    };
    const deletePayload = { items: [] };
    const discountPayload = {
      items: [skuItemPayload({ discount: 5 })],
    };

    await request(server)
      .post(`/deals/${wonDeal.id}/items`)
      .set(authHeader(context.managerToken))
      .send(addPayload)
      .expect(403);

    await request(server)
      .post(`/deals/${wonDeal.id}/items`)
      .set(authHeader(context.managerToken))
      .send(qtyPayload)
      .expect(403);

    await request(server)
      .post(`/deals/${wonDeal.id}/items`)
      .set(authHeader(context.managerToken))
      .send(pricePayload)
      .expect(403);

    await request(server)
      .post(`/deals/${wonDeal.id}/items`)
      .set(authHeader(context.managerToken))
      .send(deletePayload)
      .expect(403);

    await request(server)
      .post(`/deals/${wonDeal.id}/items`)
      .set(authHeader(context.managerToken))
      .send(discountPayload)
      .expect(403);
  });

  it('still allows non-commercial Deal update after WON', async () => {
    const wonDeal = await createDeal(prisma, context, DealStage.WON);
    const title = `Operational WON title ${RUN_ID}`;

    const response = await request(server)
      .patch(`/deals/${wonDeal.id}`)
      .set(authHeader(context.managerToken))
      .send({ title })
      .expect(200);

    expect(bodyAs<{ title: string }>(response).title).toBe(title);
  });

  it('denies Manager discount injection on create and setItems', async () => {
    const openDeal = await createDeal(prisma, context);

    await request(server)
      .post(`/deals/${openDeal.id}/items`)
      .set(authHeader(context.managerToken))
      .send({
        items: [skuItemPayload({ discount: 5 })],
      })
      .expect(403);

    await request(server)
      .post('/deals')
      .set(authHeader(context.managerToken))
      .send({
        title: `Discount inject ${RUN_ID}`,
        clientId: context.clientId,
        items: [skuItemPayload({ discount: 8 })],
      })
      .expect(403);
  });

  it('BP5 records client acceptance separately from HEAD Quote approval', async () => {
    const quoteId = await createApprovedPanelQuote();

    const accepted = await request(server)
      .post(`/quotes/${quoteId}/client-accept`)
      .set(authHeader(context.managerToken))
      .expect(200);

    const body = bodyAs<{
      clientAcceptedAt: string;
      clientAcceptedById: string;
      status: string;
    }>(accepted);
    expect(body.status).toBe('approved');
    expect(body.clientAcceptedById).toBe(context.managerId);
    expect(body.clientAcceptedAt).toBeTruthy();

    const stored = await prisma.panelQuote.findUniqueOrThrow({
      where: { id: quoteId },
    });
    expect(stored.clientAcceptedById).toBe(context.managerId);
    expect(stored.clientAcceptedAt).not.toBeNull();

    const audit = await prisma.auditLog.findMany({
      where: { action: 'QUOTE_CLIENT_ACCEPTED', entityId: quoteId },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0].userId).toBe(context.managerId);
  });

  it('BP5 rejects client acceptance when Quote is not internally approved', async () => {
    const quoteId = await createSentPanelQuote();

    await request(server)
      .post(`/quotes/${quoteId}/client-accept`)
      .set(authHeader(context.managerToken))
      .expect(409);

    await request(server)
      .patch(`/quotes/${quoteId}/status`)
      .set(authHeader(context.managerToken))
      .send({ status: 'rejected', rejectionReason: 'Client declined' })
      .expect(200);

    await request(server)
      .post(`/quotes/${quoteId}/client-accept`)
      .set(authHeader(context.managerToken))
      .expect(409);
  });

  it('BP5 forbids a foreign Manager from recording client acceptance', async () => {
    const quoteId = await createApprovedPanelQuote();
    const passwordHash = await hash(TEST_PASSWORD, 12);
    await upsertUser(prisma, {
      email: `bp5-foreign-manager-${RUN_ID}@hpl.test`,
      firstName: 'Foreign',
      lastName: 'Manager',
      passwordHash,
      roleName: RoleName.MANAGER,
    });
    const foreign = await login(
      server,
      `bp5-foreign-manager-${RUN_ID}@hpl.test`,
    );

    await request(server)
      .post(`/quotes/${quoteId}/client-accept`)
      .set(authHeader(foreign.accessToken))
      .expect(403);

    const headAccepted = await request(server)
      .post(`/quotes/${quoteId}/client-accept`)
      .set(authHeader(context.headToken))
      .send({ note: 'HEAD recorded customer acceptance' })
      .expect(200);

    expect(bodyAs<{ clientAcceptedById: string }>(headAccepted).clientAcceptedById).toBe(
      context.headId,
    );
    const handoffs = await prisma.dealExecutionHandoff.count({
      where: { quoteId },
    });
    expect(handoffs).toBe(1);
  });

  it('BP5 client acceptance is idempotent and ignores actor/timestamp injection', async () => {
    const quoteId = await createApprovedPanelQuote();
    const injectedAt = '2020-01-01T00:00:00.000Z';

    const first = await request(server)
      .post(`/quotes/${quoteId}/client-accept`)
      .set(authHeader(context.managerToken))
      .send({
        clientAcceptedAt: injectedAt,
        clientAcceptedById: context.headId,
      })
      .expect(200);

    const firstBody = bodyAs<{
      clientAcceptedAt: string;
      clientAcceptedById: string;
    }>(first);
    expect(firstBody.clientAcceptedById).toBe(context.managerId);
    expect(firstBody.clientAcceptedAt).not.toBe(injectedAt);

    await request(server)
      .post(`/quotes/${quoteId}/client-accept`)
      .set(authHeader(context.managerToken))
      .expect(200);

    const audits = await prisma.auditLog.findMany({
      where: { action: 'QUOTE_CLIENT_ACCEPTED', entityId: quoteId },
    });
    expect(audits).toHaveLength(1);
  });

  it('BP5 lets HEAD and DIRECTOR create SupplierOrders after client acceptance', async () => {
    const first = await createClientAcceptedHplDeal();
    const payload = {
      supplierId: first.supplierId,
      orderedAt: '2026-08-17T00:00:00.000Z',
      expectedReadyAt: '2026-08-20T00:00:00.000Z',
      expectedShipmentAt: '2026-08-21T00:00:00.000Z',
      expectedArrivalAt: '2026-08-28T00:00:00.000Z',
      comment: 'First factory batch',
    };

    const createdByHead = await request(server)
      .post(`/deals/${first.dealId}/supplier-orders`)
      .set(authHeader(context.headToken))
      .send(payload)
      .expect(201);
    expect(
      bodyAs<{ createdById: string; dealId: string }>(createdByHead)
        .createdById,
    ).toBe(context.headId);

    const tianran = await prisma.supplier.findFirstOrThrow({
      where: { code: 'tianran' },
    });
    const createdByDirector = await request(server)
      .post(`/deals/${first.dealId}/supplier-orders`)
      .set(authHeader(context.directorToken))
      .send({
        ...payload,
        supplierId: tianran.id,
        comment: 'Second factory batch',
      })
      .expect(201);
    expect(bodyAs<{ createdById: string }>(createdByDirector).createdById).toBe(
      context.directorId,
    );

    const listed = await request(server)
      .get(`/deals/${first.dealId}/supplier-orders`)
      .set(authHeader(context.headToken))
      .expect(200);
    expect(bodyAs<EntityResponse[]>(listed)).toHaveLength(2);

    const headAdmin = await loginDualRole('bp5-head-admin', [
      RoleName.HEAD,
      RoleName.ADMIN,
    ]);
    const directorAdmin = await loginDualRole('bp5-director-admin', [
      RoleName.DIRECTOR,
      RoleName.ADMIN,
    ]);
    const second = await createClientAcceptedHplDeal();
    await request(server)
      .post(`/deals/${second.dealId}/supplier-orders`)
      .set(authHeader(headAdmin.token))
      .send(payload)
      .expect(201);
    await request(server)
      .post(`/deals/${second.dealId}/supplier-orders`)
      .set(authHeader(directorAdmin.token))
      .send({ ...payload, supplierId: tianran.id })
      .expect(201);
  });

  it('BP5 forbids non-authority roles from creating SupplierOrders', async () => {
    const { dealId, supplierId } = await createClientAcceptedHplDeal();
    const payload = {
      supplierId,
      orderedAt: '2026-08-17T00:00:00.000Z',
      expectedReadyAt: '2026-08-20T00:00:00.000Z',
    };

    await request(server)
      .post(`/deals/${dealId}/supplier-orders`)
      .set(authHeader(context.adminToken))
      .send(payload)
      .expect(403);
    await request(server)
      .post(`/deals/${dealId}/supplier-orders`)
      .set(authHeader(context.managerToken))
      .send(payload)
      .expect(403);
    await request(server)
      .post(`/deals/${dealId}/supplier-orders`)
      .set(authHeader(context.accountantToken))
      .send(payload)
      .expect(403);
    await request(server)
      .post(`/deals/${dealId}/supplier-orders`)
      .set(authHeader(context.storekeeperToken))
      .send(payload)
      .expect(403);
    await request(server)
      .post(`/deals/${dealId}/supplier-orders`)
      .set(authHeader(context.engineerToken))
      .send(payload)
      .expect(403);
  });

  it('BP5 rejects SupplierOrder create without client acceptance and does not auto-create on WON', async () => {
    const quoteId = await createApprovedPanelQuote();
    const conversion = await request(server)
      .post(`/quotes/${quoteId}/convert-to-deal`)
      .set(authHeader(context.headToken))
      .expect(201);
    const dealId = bodyAs<{ dealId: string }>(conversion).dealId;
    const supplier = await prisma.supplier.findFirstOrThrow({
      where: { code: 'wuya' },
    });

    await request(server)
      .post(`/deals/${dealId}/supplier-orders`)
      .set(authHeader(context.headToken))
      .send({
        supplierId: supplier.id,
        orderedAt: '2026-08-17T00:00:00.000Z',
        expectedReadyAt: '2026-08-20T00:00:00.000Z',
      })
      .expect(409);

    await prisma.deal.update({
      where: { id: dealId },
      data: { stage: DealStage.WON },
    });
    expect(await prisma.supplierOrder.count({ where: { dealId } })).toBe(0);

    await request(server)
      .post('/orders/from-deal')
      .set(authHeader(context.managerToken))
      .send({ dealId })
      .expect(201);
    expect(await prisma.supplierOrder.count({ where: { dealId } })).toBe(0);
  });

  it('BP5 drives readiness reminders and stops them after ready confirmation', async () => {
    const { dealId, supplierId } = await createClientAcceptedHplDeal();
    const expectedReadyAt = new Date('2026-08-19T12:00:00.000Z');
    const created = await request(server)
      .post(`/deals/${dealId}/supplier-orders`)
      .set(authHeader(context.headToken))
      .send({
        supplierId,
        orderedAt: '2026-08-16T12:00:00.000Z',
        expectedReadyAt: expectedReadyAt.toISOString(),
      })
      .expect(201);
    const supplierOrderId = bodyAs<EntityResponse>(created).id;

    const headAdmin = await loginDualRole('bp5-ready-head-admin', [
      RoleName.HEAD,
      RoleName.ADMIN,
    ]);
    const directorAdmin = await loginDualRole('bp5-ready-director-admin', [
      RoleName.DIRECTOR,
      RoleName.ADMIN,
    ]);
    const headAdminUser = await prisma.user.findUniqueOrThrow({
      where: { email: headAdmin.email },
      select: { id: true },
    });
    const directorAdminUser = await prisma.user.findUniqueOrThrow({
      where: { email: directorAdmin.email },
      select: { id: true },
    });
    const adminUser = await prisma.user.findUniqueOrThrow({
      where: { email: `admin-${RUN_ID}@hpl.test` },
      select: { id: true },
    });

    const reminderWhere = {
      relatedType: 'SupplierOrder',
      relatedId: supplierOrderId,
    };

    await supplierOrdersService.processReadinessReminders(
      new Date('2026-08-17T08:00:00.000Z'),
    );
    await supplierOrdersService.processReadinessReminders(
      new Date('2026-08-17T18:00:00.000Z'),
    );
    const soft = await prisma.notification.findMany({
      where: { ...reminderWhere, type: SUPPLIER_ORDER_REMINDER_TYPE.SOFT },
    });
    const softRecipients = new Set(soft.map((item) => item.userId));
    expect(softRecipients.has(context.headId)).toBe(true);
    expect(softRecipients.has(context.directorId)).toBe(true);
    expect(softRecipients.has(headAdminUser.id)).toBe(true);
    expect(softRecipients.has(directorAdminUser.id)).toBe(true);
    expect(softRecipients.has(context.managerId)).toBe(false);
    expect(softRecipients.has(adminUser.id)).toBe(false);
    expect(soft.filter((item) => item.userId === context.headId)).toHaveLength(
      1,
    );

    await supplierOrdersService.processReadinessReminders(
      new Date('2026-08-19T08:00:00.000Z'),
    );
    await supplierOrdersService.processReadinessReminders(
      new Date('2026-08-19T18:00:00.000Z'),
    );
    expect(
      await prisma.notification.count({
        where: { ...reminderWhere, type: SUPPLIER_ORDER_REMINDER_TYPE.DUE },
      }),
    ).toBe(soft.length);

    await supplierOrdersService.processReadinessReminders(
      new Date('2026-08-20T08:00:00.000Z'),
    );
    await supplierOrdersService.processReadinessReminders(
      new Date('2026-08-20T18:00:00.000Z'),
    );
    const overdueDayOne = await prisma.notification.count({
      where: { ...reminderWhere, type: SUPPLIER_ORDER_REMINDER_TYPE.OVERDUE },
    });
    expect(overdueDayOne).toBe(soft.length);

    await supplierOrdersService.processReadinessReminders(
      new Date('2026-08-21T08:00:00.000Z'),
    );
    expect(
      await prisma.notification.count({
        where: { ...reminderWhere, type: SUPPLIER_ORDER_REMINDER_TYPE.OVERDUE },
      }),
    ).toBe(overdueDayOne + soft.length);

    await request(server)
      .post(`/supplier-orders/${supplierOrderId}/confirm-ready`)
      .set(authHeader(context.directorToken))
      .expect(200);
    await request(server)
      .post(`/supplier-orders/${supplierOrderId}/confirm-ready`)
      .set(authHeader(context.headToken))
      .expect(200);

    const readyAudits = await prisma.auditLog.findMany({
      where: {
        action: 'SUPPLIER_ORDER_READY_CONFIRMED',
        entityId: supplierOrderId,
      },
    });
    expect(readyAudits).toHaveLength(1);

    const afterConfirm = await prisma.notification.count({
      where: reminderWhere,
    });
    await supplierOrdersService.processReadinessReminders(
      new Date('2026-08-22T08:00:00.000Z'),
    );
    expect(await prisma.notification.count({ where: reminderWhere })).toBe(
      afterConfirm,
    );

    const followOn = await createClientAcceptedHplDeal();
    const rescheduled = await request(server)
      .post(`/deals/${followOn.dealId}/supplier-orders`)
      .set(authHeader(context.headToken))
      .send({
        supplierId,
        orderedAt: '2026-08-16T12:00:00.000Z',
        expectedReadyAt: '2026-08-19T12:00:00.000Z',
      })
      .expect(201);
    const rescheduledId = bodyAs<EntityResponse>(rescheduled).id;
    await supplierOrdersService.processReadinessReminders(
      new Date('2026-08-17T08:00:00.000Z'),
    );
    await request(server)
      .patch(`/supplier-orders/${rescheduledId}/dates`)
      .set(authHeader(context.headToken))
      .send({ expectedReadyAt: '2026-08-25T12:00:00.000Z' })
      .expect(200);
    await supplierOrdersService.processReadinessReminders(
      new Date('2026-08-17T12:00:00.000Z'),
    );
    expect(
      await prisma.notification.count({
        where: {
          relatedType: 'SupplierOrder',
          relatedId: rescheduledId,
          type: SUPPLIER_ORDER_REMINDER_TYPE.SOFT,
        },
      }),
    ).toBe(soft.length);
    await supplierOrdersService.processReadinessReminders(
      new Date('2026-08-23T08:00:00.000Z'),
    );
    expect(
      await prisma.notification.count({
        where: {
          relatedType: 'SupplierOrder',
          relatedId: rescheduledId,
          type: SUPPLIER_ORDER_REMINDER_TYPE.SOFT,
        },
      }),
    ).toBe(soft.length * 2);
  });

  it('BP5 keeps PAID as the shipment gate after SupplierOrder exists', async () => {
    const { dealId, supplierId } = await createClientAcceptedHplDeal();
    const created = await request(server)
      .post(`/deals/${dealId}/supplier-orders`)
      .set(authHeader(context.headToken))
      .send({
        supplierId,
        orderedAt: '2026-08-17T00:00:00.000Z',
        expectedReadyAt: '2026-08-20T00:00:00.000Z',
      })
      .expect(201);
    const supplierOrderId = bodyAs<EntityResponse>(created).id;

    await prisma.deal.update({
      where: { id: dealId },
      data: { stage: DealStage.WON },
    });
    const orderResponse = await request(server)
      .post('/orders/from-deal')
      .set(authHeader(context.managerToken))
      .send({ dealId })
      .expect(201);
    const order = bodyAs<OrderResponse>(orderResponse);

    await request(server)
      .post(`/supplier-orders/${supplierOrderId}/confirm-ready`)
      .set(authHeader(context.headToken))
      .expect(200);

    await request(server)
      .patch(`/supplier-orders/${supplierOrderId}/status`)
      .set(authHeader(context.headToken))
      .send({ status: SupplierOrderStatus.SHIPPED })
      .expect(409);

    const half = Number(order.totalAmount) / 2;
    const partial = await createPayment(order.id, half);
    await request(server)
      .patch(`/orders/payments/${partial.id}/confirm`)
      .set(authHeader(context.accountantToken))
      .send({ status: PaymentRecordStatus.CONFIRMED })
      .expect(200);
    await request(server)
      .patch(`/supplier-orders/${supplierOrderId}/status`)
      .set(authHeader(context.headToken))
      .send({ status: SupplierOrderStatus.SHIPPED })
      .expect(409);

    const afterPartial = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
    });
    const rest = await createPayment(
      order.id,
      Number(afterPartial.remainingAmount),
    );
    await request(server)
      .patch(`/orders/payments/${rest.id}/confirm`)
      .set(authHeader(context.accountantToken))
      .send({ status: PaymentRecordStatus.CONFIRMED })
      .expect(200);

    await request(server)
      .patch(`/supplier-orders/${supplierOrderId}/status`)
      .set(authHeader(context.adminToken))
      .send({ status: SupplierOrderStatus.SHIPPED })
      .expect(403);
    await request(server)
      .patch(`/supplier-orders/${supplierOrderId}/status`)
      .set(authHeader(context.managerToken))
      .send({ status: SupplierOrderStatus.SHIPPED })
      .expect(403);
    await request(server)
      .patch(`/supplier-orders/${supplierOrderId}/status`)
      .set(authHeader(context.accountantToken))
      .send({ status: SupplierOrderStatus.SHIPPED })
      .expect(403);

    await request(server)
      .patch(`/supplier-orders/${supplierOrderId}/status`)
      .set(authHeader(context.headToken))
      .send({ status: SupplierOrderStatus.SHIPPED })
      .expect(200);
    await request(server)
      .patch(`/supplier-orders/${supplierOrderId}/status`)
      .set(authHeader(context.directorToken))
      .send({ status: SupplierOrderStatus.DELIVERED })
      .expect(200);
  });

  it('BP6 completes a deal without installation only after PAID and every client SupplierOrder is delivered', async () => {
    const setup = await createShippedPaidHplDeal(false, 2);
    await request(server)
      .post(`/deals/${setup.dealId}/installation/schedule`)
      .set(authHeader(context.headToken))
      .send({
        expectedInstallationAt: '2026-08-25T00:00:00.000Z',
        expectedCompletionAt: '2026-08-26T00:00:00.000Z',
      })
      .expect(409);

    const first = setup.supplierOrderIds[0];
    const second = setup.supplierOrderIds[1];

    await request(server)
      .post(`/supplier-orders/${first}/confirm-client-delivery`)
      .set(authHeader(context.managerToken))
      .expect(200);

    let deal = await prisma.deal.findUniqueOrThrow({
      where: { id: setup.dealId },
    });
    let order = await prisma.order.findUniqueOrThrow({
      where: { id: setup.orderId },
    });
    expect(deal.completedAt).toBeNull();
    expect(order.status).not.toBe(OrderStatus.COMPLETED);

    const delivered = await request(server)
      .post(`/supplier-orders/${second}/confirm-client-delivery`)
      .set(authHeader(context.headToken))
      .expect(200);
    expect(bodyAs<{ status: string }>(delivered).status).toBe(
      SupplierOrderStatus.DELIVERED,
    );

    deal = await prisma.deal.findUniqueOrThrow({ where: { id: setup.dealId } });
    order = await prisma.order.findUniqueOrThrow({
      where: { id: setup.orderId },
    });
    expect(deal.stage).toBe(DealStage.WON);
    expect(deal.completedAt).not.toBeNull();
    expect(order.status).toBe(OrderStatus.COMPLETED);
    const completedAt = deal.completedAt!.toISOString();

    await request(server)
      .post(`/supplier-orders/${second}/confirm-client-delivery`)
      .set(authHeader(context.directorToken))
      .expect(200);

    const again = await prisma.deal.findUniqueOrThrow({
      where: { id: setup.dealId },
    });
    expect(again.completedAt?.toISOString()).toBe(completedAt);
    expect(
      await prisma.auditLog.count({
        where: { action: 'CLIENT_DELIVERY_CONFIRMED', entityId: second },
      }),
    ).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: { action: 'DEAL_COMPLETED', entityId: setup.dealId },
      }),
    ).toBe(1);
    expect(
      await prisma.delivery.count({ where: { orderId: setup.orderId } }),
    ).toBe(0);
  });

  it('BP6 does not complete when all SupplierOrders are delivered but payment is only partial', async () => {
    const setup = await createShippedPaidHplDeal(false, 1);
    await prisma.order.update({
      where: { id: setup.orderId },
      data: { paymentStatus: PaymentStatus.PARTIALLY_PAID },
    });
    await prisma.supplierOrder.update({
      where: { id: setup.supplierOrderIds[0] },
      data: { status: SupplierOrderStatus.DELIVERED },
    });

    await request(server)
      .post(
        `/supplier-orders/${setup.supplierOrderIds[0]}/confirm-client-delivery`,
      )
      .set(authHeader(context.managerToken))
      .expect(200);

    const deal = await prisma.deal.findUniqueOrThrow({
      where: { id: setup.dealId },
    });
    expect(deal.completedAt).toBeNull();
  });

  it('BP6 completes installation when HEAD confirms as supervisor', async () => {
    const setup = await createShippedPaidHplDeal(true, 1);
    await request(server)
      .post(
        `/supplier-orders/${setup.supplierOrderIds[0]}/confirm-client-delivery`,
      )
      .set(authHeader(context.managerToken))
      .expect(200);

    let deal = await prisma.deal.findUniqueOrThrow({
      where: { id: setup.dealId },
    });
    expect(deal.completedAt).toBeNull();

    const dates = {
      expectedInstallationAt: '2026-08-25T00:00:00.000Z',
      expectedCompletionAt: '2026-08-26T00:00:00.000Z',
    };
    await request(server)
      .post(`/deals/${setup.dealId}/installation/schedule`)
      .set(authHeader(context.headToken))
      .send(dates)
      .expect(200);

    await request(server)
      .post(`/deals/${setup.dealId}/installation/confirm-supervisor`)
      .set(authHeader(context.engineerToken))
      .expect(403);

    await request(server)
      .post(`/deals/${setup.dealId}/installation/confirm-supervisor`)
      .set(authHeader(context.headToken))
      .expect(200);

    deal = await prisma.deal.findUniqueOrThrow({ where: { id: setup.dealId } });
    const installation = await prisma.dealInstallation.findUniqueOrThrow({
      where: { dealId: setup.dealId },
    });
    expect(installation.supervisorConfirmedById).toBe(context.headId);
    expect(installation.completedAt).not.toBeNull();
    expect(deal.completedAt).not.toBeNull();
    expect(deal.stage).toBe(DealStage.WON);
  });

  it('BP6 completes installation when DIRECTOR confirms as supervisor', async () => {
    const setup = await createShippedPaidHplDeal(true, 1);
    await request(server)
      .post(
        `/supplier-orders/${setup.supplierOrderIds[0]}/confirm-client-delivery`,
      )
      .set(authHeader(context.managerToken))
      .expect(200);
    await request(server)
      .post(`/deals/${setup.dealId}/installation/schedule`)
      .set(authHeader(context.directorToken))
      .send({
        expectedInstallationAt: '2026-08-25T00:00:00.000Z',
        expectedCompletionAt: '2026-08-26T00:00:00.000Z',
      })
      .expect(200);

    await request(server)
      .post(`/deals/${setup.dealId}/installation/confirm-supervisor`)
      .set(authHeader(context.directorToken))
      .expect(200);

    const deal = await prisma.deal.findUniqueOrThrow({
      where: { id: setup.dealId },
    });
    const installation = await prisma.dealInstallation.findUniqueOrThrow({
      where: { dealId: setup.dealId },
    });
    expect(installation.supervisorConfirmedById).toBe(context.directorId);
    expect(deal.completedAt).not.toBeNull();
  });

  it('BP6 does not let ENGINEER confirm installation as supervisor', async () => {
    const setup = await createShippedPaidHplDeal(true, 1);
    await request(server)
      .post(
        `/supplier-orders/${setup.supplierOrderIds[0]}/confirm-client-delivery`,
      )
      .set(authHeader(context.managerToken))
      .expect(200);
    await request(server)
      .post(`/deals/${setup.dealId}/installation/schedule`)
      .set(authHeader(context.headToken))
      .send({
        expectedInstallationAt: '2026-08-25T00:00:00.000Z',
        expectedCompletionAt: '2026-08-26T00:00:00.000Z',
      })
      .expect(200);

    await request(server)
      .post(`/deals/${setup.dealId}/installation/confirm-supervisor`)
      .set(authHeader(context.engineerToken))
      .expect(403);

    const deal = await prisma.deal.findUniqueOrThrow({
      where: { id: setup.dealId },
    });
    expect(deal.completedAt).toBeNull();

    await request(server)
      .post(`/deals/${setup.dealId}/installation/confirm-supervisor`)
      .set(authHeader(context.headToken))
      .expect(200);

    const completed = await prisma.deal.findUniqueOrThrow({
      where: { id: setup.dealId },
    });
    expect(completed.completedAt).not.toBeNull();
  });

  it('BP6 enforces client delivery and installation authorization', async () => {
    const setup = await createShippedPaidHplDeal(true, 1);
    const dates = {
      expectedInstallationAt: '2026-08-25T00:00:00.000Z',
      expectedCompletionAt: '2026-08-26T00:00:00.000Z',
    };

    await request(server)
      .post(`/deals/${setup.dealId}/installation/schedule`)
      .set(authHeader(context.managerToken))
      .send(dates)
      .expect(403);
    await request(server)
      .post(`/deals/${setup.dealId}/installation/schedule`)
      .set(authHeader(context.accountantToken))
      .send(dates)
      .expect(403);
    await request(server)
      .post(`/deals/${setup.dealId}/installation/schedule`)
      .set(authHeader(context.storekeeperToken))
      .send(dates)
      .expect(403);
    await request(server)
      .post(`/deals/${setup.dealId}/installation/schedule`)
      .set(authHeader(context.engineerToken))
      .send(dates)
      .expect(403);
    await request(server)
      .post(`/deals/${setup.dealId}/installation/schedule`)
      .set(authHeader(context.adminToken))
      .send(dates)
      .expect(403);

    await request(server)
      .post(`/deals/${setup.dealId}/installation/schedule`)
      .set(authHeader(context.headToken))
      .send(dates)
      .expect(200);

    await request(server)
      .post(`/deals/${setup.dealId}/installation/confirm-supervisor`)
      .set(authHeader(context.adminToken))
      .expect(403);
    await request(server)
      .post(`/deals/${setup.dealId}/installation/confirm-supervisor`)
      .set(authHeader(context.managerToken))
      .expect(403);
    await request(server)
      .post(`/deals/${setup.dealId}/installation/confirm-supervisor`)
      .set(authHeader(context.engineerToken))
      .expect(403);

    const engineerAdmin = await loginDualRole('bp6-engineer-admin', [
      RoleName.ENGINEER,
      RoleName.ADMIN,
    ]);
    const headAdmin = await loginDualRole('bp6-head-admin', [
      RoleName.HEAD,
      RoleName.ADMIN,
    ]);
    await request(server)
      .post(`/deals/${setup.dealId}/installation/confirm-supervisor`)
      .set(authHeader(engineerAdmin.token))
      .expect(403);
    await request(server)
      .post(`/deals/${setup.dealId}/installation/confirm-supervisor`)
      .set(authHeader(headAdmin.token))
      .expect(200);
    const directorAdmin = await loginDualRole('bp6-director-admin', [
      RoleName.DIRECTOR,
      RoleName.ADMIN,
    ]);
    await request(server)
      .post(`/deals/${setup.dealId}/installation/confirm-supervisor`)
      .set(authHeader(directorAdmin.token))
      .expect(200);

    const soId = setup.supplierOrderIds[0];
    await request(server)
      .post(`/supplier-orders/${soId}/confirm-client-delivery`)
      .set(authHeader(context.adminToken))
      .expect(403);
    await request(server)
      .post(`/supplier-orders/${soId}/confirm-client-delivery`)
      .set(authHeader(context.accountantToken))
      .expect(403);
    await request(server)
      .post(`/supplier-orders/${soId}/confirm-client-delivery`)
      .set(authHeader(context.storekeeperToken))
      .expect(403);
    await request(server)
      .post(`/supplier-orders/${soId}/confirm-client-delivery`)
      .set(authHeader(context.engineerToken))
      .expect(403);

    const passwordHash = await hash(TEST_PASSWORD, 12);
    await upsertUser(prisma, {
      email: `bp6-foreign-manager-${RUN_ID}@hpl.test`,
      firstName: 'Foreign',
      lastName: 'Manager',
      passwordHash,
      roleName: RoleName.MANAGER,
    });
    const foreign = await login(
      server,
      `bp6-foreign-manager-${RUN_ID}@hpl.test`,
    );
    await request(server)
      .post(`/supplier-orders/${soId}/confirm-client-delivery`)
      .set(authHeader(foreign.accessToken))
      .expect(404);

    await prisma.order.update({
      where: { id: setup.orderId },
      data: { paymentStatus: PaymentStatus.UNPAID },
    });
    await request(server)
      .post(`/supplier-orders/${soId}/confirm-client-delivery`)
      .set(authHeader(context.managerToken))
      .expect(409);

    await prisma.order.update({
      where: { id: setup.orderId },
      data: { paymentStatus: PaymentStatus.PAID },
    });
    await request(server)
      .post(`/supplier-orders/${soId}/confirm-client-delivery`)
      .set(authHeader(context.managerToken))
      .expect(200);
  });

  it('closure flow preserves Quote versions, frozen FX, one Deal and client-document secrecy under races', async () => {
    const leadResponse = await request(server)
      .post('/leads')
      .set(authHeader(context.managerToken))
      .send({
        title: `Closure flow ${RUN_ID}`,
        source: 'closure-e2e',
        clientId: context.clientId,
      })
      .expect(201);
    const leadId = bodyAs<EntityResponse>(leadResponse).id;
    await qualifyLeadStage1(leadId);
    await confirmLeadStage2(leadId);

    const qualifiedLead = await prisma.lead.findUniqueOrThrow({
      where: { id: leadId },
      select: { dealId: true, status: true },
    });
    expect(qualifiedLead.status).toBe('QUALIFIED');
    expect(qualifiedLead.dealId).toBeTruthy();

    const panelType = await prisma.panelType.findFirstOrThrow({
      where: { code: 'exterior_with_uv' },
    });
    const sizes = await prisma.panelSize.findMany({
      where: {
        OR: [
          { widthMm: 1220, heightMm: 2440 },
          { widthMm: 1220, heightMm: 3050 },
        ],
      },
      orderBy: { heightMm: 'asc' },
    });
    expect(sizes).toHaveLength(2);
    const supplier = await prisma.supplier.findFirstOrThrow({
      where: { code: 'wuya' },
    });
    const quality = await prisma.qualityClass.findFirstOrThrow({
      where: { code: 'economy' },
    });
    const technicalGroups = (firstArea = '12.5') => [
      {
        title: 'Фасад A',
        items: [
          {
            panelTypeId: panelType.id,
            panelSizeId: sizes[0].id,
            thicknessMm: '10',
            qualityClassId: quality.id,
            requiredAreaM2: firstArea,
            supplierId: supplier.id,
          },
          {
            panelTypeId: panelType.id,
            panelSizeId: sizes[1].id,
            thicknessMm: '10',
            qualityClassId: quality.id,
            requiredAreaM2: '8.75',
            supplierId: supplier.id,
          },
        ],
      },
      {
        title: 'Фасад B',
        items: [
          {
            panelTypeId: panelType.id,
            panelSizeId: sizes[0].id,
            thicknessMm: '10',
            qualityClassId: quality.id,
            requiredAreaM2: '6.25',
            supplierId: supplier.id,
          },
        ],
      },
    ];

    const calculationRequest = await request(server)
      .post('/calculations/requests')
      .set(authHeader(context.managerToken))
      .send({ leadId, calculations: technicalGroups() })
      .expect(201);
    const requestId = bodyAs<EntityResponse>(calculationRequest).id;
    await request(server)
      .post(`/calculations/requests/${requestId}/submit`)
      .set(authHeader(context.managerToken))
      .expect(201);

    const quoteAttempts = await Promise.all([
      request(server)
        .post(`/calculations/requests/${requestId}/convert-to-quote`)
        .set(authHeader(context.headToken))
        .send({ supplierId: supplier.id }),
      request(server)
        .post(`/calculations/requests/${requestId}/convert-to-quote`)
        .set(authHeader(context.headToken))
        .send({ supplierId: supplier.id }),
    ]);
    expect(quoteAttempts.map((item) => item.status).sort()).toEqual([201, 409]);
    const v1Response = quoteAttempts.find((item) => item.status === 201)!;
    const v1 = bodyAs<{ id: string; items: EntityResponse[] }>(v1Response);
    expect(v1.items).toHaveLength(3);

    await request(server)
      .post('/currency-rates')
      .set(authHeader(context.directorToken))
      .send({ rate: '0.123' })
      .expect(201);
    const approvalStatuses = await Promise.all(
      v1.items.slice(0, 2).map((item, index) =>
        request(server)
          .patch(`/quotes/${v1.id}/approved-pricing`)
          .set(authHeader(context.headToken))
          .send({
            items: [
              { id: item.id, purchasePricePerM2Cny: String(80 + index * 10) },
            ],
          }),
      ),
    );
    expect(approvalStatuses.every((item) => item.status === 200)).toBe(true);
    await request(server)
      .post('/currency-rates')
      .set(authHeader(context.directorToken))
      .send({ rate: '0.321' })
      .expect(201);
    await request(server)
      .patch(`/quotes/${v1.id}/approved-pricing`)
      .set(authHeader(context.headToken))
      .send({ items: [{ id: v1.items[2].id, purchasePricePerM2Cny: '100' }] })
      .expect(200);

    const secret = `INTERNAL-SECRET-${RUN_ID}`;
    const clientNote = `Client note ${RUN_ID}`;
    await request(server)
      .patch(`/quotes/${v1.id}/commercial-terms`)
      .set(authHeader(context.headToken))
      .send({
        productionTerms: '15–20 рабочих дней после согласования',
        deliveryTerms: 'Доставка ориентировочно за 4 недели',
        commercialNote: clientNote,
        internalCommercialNote: secret,
      })
      .expect(200);
    const finalizedV1 = await Promise.all([
      request(server)
        .post(`/quotes/${v1.id}/finalize`)
        .set(authHeader(context.headToken))
        .send({}),
      request(server)
        .post(`/quotes/${v1.id}/finalize`)
        .set(authHeader(context.headToken))
        .send({}),
    ]);
    expect(finalizedV1.every((item) => item.status === 200)).toBe(true);

    const v1Row = await prisma.panelQuote.findUniqueOrThrow({
      where: { id: v1.id },
      include: { items: true },
    });
    expect(v1Row.cnyUsdRate?.toString()).toBe('0.123');
    expect(v1Row.items.every((item) => item.priceApprovedAt !== null)).toBe(
      true,
    );
    expect(v1Row.pdfFileId).toBeTruthy();
    expect(
      await prisma.file.count({
        where: { relatedType: 'QUOTE', relatedId: v1.id },
      }),
    ).toBe(1);

    const docx = await request(server)
      .get(`/quotes/${v1.id}/docx`)
      .set(authHeader(context.headToken))
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const archive = await JSZip.loadAsync(docx.body as Buffer);
    const documentXml = await archive
      .file('word/document.xml')!
      .async('string');
    expect(documentXml).toContain(clientNote);
    expect(documentXml).not.toContain(secret);
    const docxText = [...documentXml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)]
      .map((match) => match[1])
      .join('');
    expect(docxText).toContain('КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ');
    expect(docxText).toContain('на поставку HPL-панелей');
    expect(docxText).not.toContain('КП v');
    expect(docxText).not.toContain(v1.id);
    expect(docxText).not.toContain(v1.id.slice(0, 8));
    expect(v1Row.versionNumber).toBe(1);

    await request(server)
      .patch(`/calculations/requests/${requestId}`)
      .set(authHeader(context.headToken))
      .send({ calculations: technicalGroups('18.5') })
      .expect(200);
    const historicalGroups = await prisma.calculationSession.findMany({
      where: { requestId },
      select: { deletedAt: true },
    });
    expect(
      historicalGroups.filter((item) => item.deletedAt !== null),
    ).toHaveLength(2);
    expect(
      historicalGroups.filter((item) => item.deletedAt === null),
    ).toHaveLength(2);

    const versions = await Promise.all([
      request(server)
        .post(`/quotes/${v1.id}/versions`)
        .set(authHeader(context.headToken)),
      request(server)
        .post(`/quotes/${v1.id}/versions`)
        .set(authHeader(context.headToken)),
    ]);
    expect(versions.every((item) => item.status === 201)).toBe(true);
    const versionIds = versions.map((item) => bodyAs<EntityResponse>(item).id);
    expect(new Set(versionIds).size).toBe(1);
    const v2Id = versionIds[0];
    const v2 = await prisma.panelQuote.findUniqueOrThrow({
      where: { id: v2Id },
      include: { items: true },
    });
    expect(v2.versionNumber).toBe(2);
    expect(v2.previousVersionId).toBe(v1.id);
    expect(v2.cnyUsdRate).toBeNull();
    expect(v2.pdfFileId).toBeNull();
    expect(v2.items).toHaveLength(3);
    expect(v2.items[0].requiredAreaM2.toString()).toBe('18.5');

    await request(server)
      .patch(`/quotes/${v2.id}/approved-pricing`)
      .set(authHeader(context.headToken))
      .send({
        items: v2.items.map((item, index) => ({
          id: item.id,
          purchasePricePerM2Cny: String(110 + index * 10),
        })),
      })
      .expect(200);
    await request(server)
      .post(`/quotes/${v2.id}/finalize`)
      .set(authHeader(context.headToken))
      .send({})
      .expect(200);
    const v2Docx = await request(server)
      .get(`/quotes/${v2.id}/docx`)
      .set(authHeader(context.headToken))
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const v2Archive = await JSZip.loadAsync(v2Docx.body as Buffer);
    const v2DocumentXml = await v2Archive
      .file('word/document.xml')!
      .async('string');
    const v2DocxText = [...v2DocumentXml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)]
      .map((match) => match[1])
      .join('');
    expect(v2.versionNumber).toBe(2);
    expect(v2DocxText).toContain('КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ');
    expect(v2DocxText).toContain('на поставку HPL-панелей');
    expect(v2DocxText).not.toContain('КП v2');
    expect(v2DocxText).not.toContain('КП v');
    expect(v2DocxText).not.toContain(v2.id);
    expect(v2DocxText).not.toContain(v2.id.slice(0, 8));
    await request(server)
      .patch(`/quotes/${v2.id}/status`)
      .set(authHeader(context.managerToken))
      .send({ status: 'sent' })
      .expect(200);
    await request(server)
      .patch(`/quotes/${v2.id}/status`)
      .set(authHeader(context.headToken))
      .send({ status: 'approved' })
      .expect(200);
    await request(server)
      .post(`/quotes/${v2.id}/client-accept`)
      .set(authHeader(context.managerToken))
      .expect(200);

    const acceptedLead = await prisma.lead.findUniqueOrThrow({
      where: { id: leadId },
    });
    const acceptedDeal = await prisma.deal.findUniqueOrThrow({
      where: { id: acceptedLead.dealId! },
    });
    expect(acceptedLead.dealId).toBe(qualifiedLead.dealId);
    expect(acceptedLead.status).toBe('CONVERTED');
    expect(acceptedDeal.stage).toBe(DealStage.AGREEMENT_PENDING);
    expect(v1Row.totalAmount.toString()).toBe(
      (
        await prisma.panelQuote.findUniqueOrThrow({ where: { id: v1.id } })
      ).totalAmount.toString(),
    );
    expect(
      (
        await prisma.panelQuote.findUniqueOrThrow({ where: { id: v2.id } })
      ).cnyUsdRate?.toString(),
    ).toBe('0.321');
  });

  it('marks KPI incomplete until DIRECTOR explicitly supplies every deal-currency rate', async () => {
    const leadId = bodyAs<EntityResponse>(
      await request(server)
        .post('/leads')
        .set(authHeader(context.managerToken))
        .send({
          title: `KPI currency closure ${RUN_ID}`,
          source: 'closure-e2e',
          clientId: context.clientId,
        })
        .expect(201),
    ).id;
    await qualifyLeadStage1(leadId);
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    await prisma.deal.update({
      where: { id: lead.dealId! },
      data: {
        stage: DealStage.WON,
        currency: 'CNY',
        totalAmount: new Prisma.Decimal('100'),
      },
    });
    await prisma.dealStageHistory.create({
      data: {
        dealId: lead.dealId!,
        oldStage: DealStage.QUALIFICATION,
        newStage: DealStage.WON,
        changedById: context.managerId,
        createdAt: new Date('2026-08-15T00:00:00.000Z'),
      },
    });

    const plan = {
      userId: context.managerId,
      period: '2026-08-01T00:00:00.000Z',
      targetAmount: '1000000',
      currencyCode: 'UZS',
    };
    await request(server)
      .post('/reports/sales-plans')
      .set(authHeader(context.managerToken))
      .send({
        ...plan,
        fxRates: [{ fromCurrency: 'USD', rateToPlanCurrency: '12500' }],
      })
      .expect(403);
    await request(server)
      .post('/reports/sales-plans')
      .set(authHeader(context.directorToken))
      .send({
        ...plan,
        fxRates: [{ fromCurrency: 'USD', rateToPlanCurrency: '12500' }],
      })
      .expect(201);

    const filter = {
      dateFrom: '2026-08-01T00:00:00.000Z',
      dateTo: '2026-08-31T23:59:59.999Z',
      managerId: context.managerId,
    };
    const incomplete = await request(server)
      .get('/reports/kpi')
      .query(filter)
      .set(authHeader(context.directorToken))
      .expect(200);
    const incompleteMetric = bodyAs<{
      managers: Array<{
        salesPlanStatus: string;
        missingFxCurrencies: string[];
        salesPlanPercent: number | null;
        totalScore: number | null;
      }>;
    }>(incomplete).managers[0];
    expect(incompleteMetric.salesPlanStatus).toBe('INCOMPLETE');
    expect(incompleteMetric.missingFxCurrencies).toContain('CNY');
    expect(incompleteMetric.salesPlanPercent).toBeNull();
    expect(incompleteMetric.totalScore).toBeNull();

    await request(server)
      .post('/reports/sales-plans')
      .set(authHeader(context.directorToken))
      .send({
        ...plan,
        fxRates: [
          { fromCurrency: 'USD', rateToPlanCurrency: '12500' },
          { fromCurrency: 'CNY', rateToPlanCurrency: '1700' },
        ],
      })
      .expect(201);
    const complete = await request(server)
      .get('/reports/kpi')
      .query(filter)
      .set(authHeader(context.directorToken))
      .expect(200);
    const completeMetric = bodyAs<{
      managers: Array<{
        salesPlanStatus: string;
        missingFxCurrencies: string[];
        salesPlanPercent: number | null;
        totalScore: number | null;
      }>;
    }>(complete).managers[0];
    expect(completeMetric.salesPlanStatus).toBe('COMPLETE');
    expect(completeMetric.missingFxCurrencies).toEqual([]);
    expect(completeMetric.salesPlanPercent).not.toBeNull();
    expect(completeMetric.totalScore).not.toBeNull();
  });

  it('Stage 5 HPL-only quote has no empty facade or installation sections', async () => {
    const quoteId = await createSentPanelQuote();
    const quote = await prisma.panelQuote.findUniqueOrThrow({
      where: { id: quoteId },
      include: { componentSnapshots: true },
    });
    expect(quote.componentSnapshots.map((item) => item.kind).sort()).toEqual([
      'HPL',
    ]);
    const docx = await request(server)
      .get(`/quotes/${quoteId}/docx`)
      .set(authHeader(context.headToken))
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const xml = await (
      await JSZip.loadAsync(docx.body as Buffer)
    )
      .file('word/document.xml')!
      .async('string');
    const text = [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)]
      .map((match) => match[1])
      .join('');
    expect(text).toContain('на поставку HPL-панелей');
    expect(text).not.toContain('Фасадная подсистема');
    expect(text).not.toContain('Монтажные работы');
    expect(text).not.toContain(quoteId);
    expect(Object.values(RoleName)).not.toContain('INSTALLER');
  });

  it('Stage 5 does not silently include unapproved installation in a Quote', async () => {
    const { leadId } = await prepareInstallationCommercial(context.headToken);
    await prisma.installationCommercialCalculation.updateMany({
      where: { leadId },
      data: { status: 'DRAFT', approvedCustomerAmount: null, approvedAt: null },
    });
    await confirmLeadStage2(leadId);
    const quoteId = await headQuoteFromExistingLead(leadId);
    const snapshots = await prisma.panelQuoteComponentSnapshot.findMany({
      where: { quoteId },
    });
    expect(snapshots.map((item) => item.kind)).toEqual(['HPL']);
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    expect(lead.dealId).toBeTruthy();
    expect(await prisma.deal.count({ where: { id: lead.dealId! } })).toBe(1);
  });

  it('Stage 5 assembles HPL + approved installation without extra Deal or DIRECTOR quote approval', async () => {
    const { leadId } = await prepareInstallationCommercial(context.headToken);
    await confirmLeadStage2(leadId);
    const quoteId = await headQuoteFromExistingLead(leadId);
    const snapshots = await prisma.panelQuoteComponentSnapshot.findMany({
      where: { quoteId },
      orderBy: { sortOrder: 'asc' },
    });
    expect(snapshots.map((item) => item.kind)).toEqual(['HPL', 'INSTALLATION']);
    expect(Number(snapshots[1]?.customerAmount)).toBe(15000);
    const composition = await request(server)
      .get('/quotes/composition')
      .query({ leadId })
      .set(authHeader(context.managerToken))
      .expect(200);
    const body = bodyAs<{
      components: Array<{ kind: string; amount: string | null }>;
    }>(composition);
    expect(
      body.components.find((item) => item.kind === 'INSTALLATION')?.amount,
    ).toBe('15000.00');
    expect(JSON.stringify(body)).not.toMatch(/pricePerUnit|contractorName/);
    await request(server)
      .patch(`/quotes/${quoteId}/status`)
      .set(authHeader(context.directorToken))
      .send({ status: 'approved' })
      .expect(403);
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    expect(await prisma.deal.count({ where: { id: lead.dealId! } })).toBe(1);
  });

  it('Stage 5 assembles HPL + approved facade without leaking purchase prices', async () => {
    const { leadId } = await prepareSubsystemCommercial(context.directorToken);
    await confirmLeadStage2(leadId);
    const quoteId = await headQuoteFromExistingLead(leadId);
    const snapshots = await prisma.panelQuoteComponentSnapshot.findMany({
      where: { quoteId },
      orderBy: { sortOrder: 'asc' },
    });
    expect(snapshots.map((item) => item.kind)).toEqual(['HPL', 'FACADE']);
    expect(Number(snapshots[1]?.customerAmount)).toBe(8000);
    expect(JSON.stringify(snapshots[1]?.customerSnapshot)).not.toMatch(
      /purchasePrice|offerSnapshot|margin/,
    );
    await request(server)
      .post(`/quotes/${quoteId}/finalize`)
      .set(authHeader(context.directorToken))
      .send({})
      .expect(403);
  });

  it('Stage 5 assembles HPL + facade + installation on one Lead with combined subtitle', async () => {
    const { leadId, facadeRevision, installationRevision } =
      await prepareAllThreeCommercial();
    await confirmLeadStage2(leadId);

    const composition = await request(server)
      .get('/quotes/composition')
      .query({ leadId })
      .set(authHeader(context.managerToken))
      .expect(200);
    const preview = bodyAs<{
      components: Array<{
        kind: string;
        amount: string | null;
        currency: string | null;
        sourceRevision: number | null;
        includeInQuote?: boolean;
        readiness?: string;
      }>;
      totals: {
        grandTotal: { amount: string; currency: string } | null;
        byCurrency: Array<{ amount: string; currency: string }>;
      };
    }>(composition);
    expect(preview.components.map((item) => item.kind)).toEqual([
      'HPL',
      'FACADE',
      'INSTALLATION',
    ]);
    expect(preview.components.find((item) => item.kind === 'FACADE')).toEqual(
      expect.objectContaining({
        amount: '8000.00',
        currency: 'USD',
        sourceRevision: facadeRevision,
        includeInQuote: true,
        readiness: 'READY',
      }),
    );
    expect(
      preview.components.find((item) => item.kind === 'INSTALLATION'),
    ).toEqual(
      expect.objectContaining({
        amount: '15000.00',
        currency: 'USD',
        sourceRevision: installationRevision,
        includeInQuote: true,
        readiness: 'READY',
      }),
    );
    expect(JSON.stringify(preview)).not.toMatch(
      /purchasePrice|offerSnapshot|pricePerUnit|contractorName|margin|cnyUsdRate|"sourceId"/,
    );

    const quoteId = await headQuoteFromExistingLead(leadId);
    const quote = await prisma.panelQuote.findUniqueOrThrow({
      where: { id: quoteId },
      include: { componentSnapshots: { orderBy: { sortOrder: 'asc' } } },
    });
    expect(quote.componentSnapshots.map((item) => item.kind)).toEqual([
      'HPL',
      'FACADE',
      'INSTALLATION',
    ]);
    expect(Number(quote.componentSnapshots[1]?.customerAmount)).toBe(8000);
    expect(Number(quote.componentSnapshots[2]?.customerAmount)).toBe(15000);
    expect(quote.componentSnapshots[1]?.sourceRevision).toBe(facadeRevision);
    expect(quote.componentSnapshots[2]?.sourceRevision).toBe(
      installationRevision,
    );
    expect(
      JSON.stringify(quote.componentSnapshots.map((item) => item.customerSnapshot)),
    ).not.toMatch(/purchasePrice|pricePerUnit|contractorName|margin/);

    await request(server)
      .patch(`/quotes/${quoteId}/status`)
      .set(authHeader(context.directorToken))
      .send({ status: 'approved' })
      .expect(403);
    await request(server)
      .post(`/quotes/${quoteId}/finalize`)
      .set(authHeader(context.directorToken))
      .send({})
      .expect(403);

    const docx = await request(server)
      .get(`/quotes/${quoteId}/docx`)
      .set(authHeader(context.headToken))
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const xml = await (
      await JSZip.loadAsync(docx.body as Buffer)
    )
      .file('word/document.xml')!
      .async('string');
    const text = [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)]
      .map((match) => match[1])
      .join('');
    expect(text).toContain(
      'на поставку HPL-панелей, фасадной подсистемы и монтажные работы',
    );
    expect(text).toContain('Фасадная подсистема');
    expect(text).toContain('Монтажные работы');
    expect(text).toContain('8000.00 USD');
    expect(text).toContain('15000.00 USD');
    expect(text).toContain('Цена за м² с НДС 12%');
    expect(text).not.toContain(quoteId);
    expect(text).not.toMatch(/purchasePrice|contractorName|INTERNAL/);

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    expect(lead.dealId).toBeTruthy();
    expect(await prisma.deal.count({ where: { id: lead.dealId! } })).toBe(1);
    expect(await prisma.lead.count({ where: { id: leadId } })).toBe(1);
    expect(Object.values(RoleName)).not.toContain('INSTALLER');
  });

  it('Stage 5 keeps Quote v1 immutable after a new installation approval and stores v2 separately', async () => {
    const { leadId } = await prepareInstallationCommercial(context.headToken);
    await confirmLeadStage2(leadId);
    const v1Id = await headQuoteFromExistingLead(leadId);
    const v1Before = await prisma.panelQuote.findUniqueOrThrow({
      where: { id: v1Id },
      include: { componentSnapshots: true, items: true },
    });
    expect(
      Number(
        v1Before.componentSnapshots.find((item) => item.kind === 'INSTALLATION')
          ?.customerAmount,
      ),
    ).toBe(15000);
    const v1Pdf = v1Before.pdfFileId;

    await request(server)
      .patch(`/engineering/leads/${leadId}/installation`)
      .set(authHeader(context.engineerToken))
      .send({
        expectedRevision: 2,
        items: [
          {
            workTypeId: (
              await prisma.installationCalculationItem.findFirstOrThrow({
                where: { calculation: { leadId } },
              })
            ).workTypeId,
            quantity: '1200',
          },
        ],
      })
      .expect(200);

    const reprice = await request(server)
      .post(`/leads/${leadId}/installation-commercial/revisions`)
      .set(authHeader(context.headToken))
      .expect(201);
    const workspace = await request(server)
      .get(`/leads/${leadId}/installation-commercial`)
      .set(authHeader(context.headToken))
      .expect(200);
    const commercial = bodyAs<{
      calculation: { revision: number; items: Array<{ id: string }> };
    }>(workspace);
    const rate = await prisma.installationContractorRate.findFirstOrThrow({
      where: {
        workTypeId: (
          await prisma.installationCalculationItem.findFirstOrThrow({
            where: { calculation: { leadId } },
          })
        ).workTypeId!,
      },
    });
    const patched = await request(server)
      .patch(`/leads/${leadId}/installation-commercial`)
      .set(authHeader(context.headToken))
      .send({
        expectedRevision: commercial.calculation.revision,
        selections: [
          { itemId: commercial.calculation.items[0].id, rateId: rate.id },
        ],
        proposedCustomerAmount: '17000',
        proposedCurrency: 'USD',
      })
      .expect(200);
    const submitted = await request(server)
      .post(`/leads/${leadId}/installation-commercial/submit`)
      .set(authHeader(context.headToken))
      .send({
        expectedRevision: bodyAs<{ revision: number }>(patched).revision,
      })
      .expect(201);
    await request(server)
      .post(`/leads/${leadId}/installation-commercial/approve`)
      .set(authHeader(context.headToken))
      .send({
        expectedRevision: bodyAs<{ revision: number }>(submitted).revision,
      })
      .expect(201);

    const v2Id = bodyAs<EntityResponse>(
      await request(server)
        .post(`/quotes/${v1Id}/versions`)
        .set(authHeader(context.headToken))
        .send({ acknowledgeStaleComponents: true })
        .expect(201),
    ).id;

    const v1After = await prisma.panelQuote.findUniqueOrThrow({
      where: { id: v1Id },
      include: { componentSnapshots: true, items: true },
    });
    expect(v1After.pdfFileId).toBe(v1Pdf);
    expect(
      Number(
        v1After.componentSnapshots.find((item) => item.kind === 'INSTALLATION')
          ?.customerAmount,
      ),
    ).toBe(15000);
    expect(v1After.cnyUsdRate?.toString()).toBe(v1Before.cnyUsdRate?.toString());

    const v2 = await prisma.panelQuote.findUniqueOrThrow({
      where: { id: v2Id },
      include: { componentSnapshots: true, items: true },
    });
    expect(v2.versionNumber).toBe(2);
    expect(v2.cnyUsdRate?.toString()).toBe(v1Before.cnyUsdRate?.toString());
    expect(
      Number(
        v2.componentSnapshots.find((item) => item.kind === 'INSTALLATION')
          ?.customerAmount,
      ),
    ).toBe(17000);

    await request(server)
      .post(`/quotes/${v2Id}/finalize`)
      .set(authHeader(context.headToken))
      .send({})
      .expect(200);
    const v2Ready = await prisma.panelQuote.findUniqueOrThrow({
      where: { id: v2Id },
    });
    expect(v2Ready.pdfFileId).toBeTruthy();
    expect(v2Ready.pdfFileId).not.toBe(v1Pdf);
    await request(server)
      .get(`/quotes/${v1Id}/pdf`)
      .set(authHeader(context.headToken))
      .expect(200);
    await request(server)
      .get(`/quotes/${v2Id}/pdf`)
      .set(authHeader(context.headToken))
      .expect(200);
  });

  async function createClientAcceptedHplDeal(
    installationRequired = false,
  ): Promise<{
    quoteId: string;
    dealId: string;
    supplierId: string;
  }> {
    const quoteId = await createApprovedPanelQuote(installationRequired);
    await request(server)
      .post(`/quotes/${quoteId}/client-accept`)
      .set(authHeader(context.managerToken))
      .expect(200);
    const conversion = await request(server)
      .post(`/quotes/${quoteId}/convert-to-deal`)
      .set(authHeader(context.headToken))
      .expect(201);
    const dealId = bodyAs<{ dealId: string }>(conversion).dealId;
    const supplier = await prisma.supplier.findFirstOrThrow({
      where: { code: 'wuya' },
    });
    return { quoteId, dealId, supplierId: supplier.id };
  }

  async function createShippedPaidHplDeal(
    installationRequired = false,
    supplierOrderCount = 1,
  ): Promise<{
    dealId: string;
    orderId: string;
    supplierOrderIds: string[];
  }> {
    const created = await createClientAcceptedHplDeal(installationRequired);
    const payload = {
      supplierId: created.supplierId,
      orderedAt: '2026-08-17T00:00:00.000Z',
      expectedReadyAt: '2026-08-20T00:00:00.000Z',
    };
    const supplierOrderIds: string[] = [];
    for (let index = 0; index < supplierOrderCount; index += 1) {
      const createdOrder = await request(server)
        .post(`/deals/${created.dealId}/supplier-orders`)
        .set(authHeader(context.headToken))
        .send({
          ...payload,
          comment: `BP6 batch ${index + 1}`,
        })
        .expect(201);
      supplierOrderIds.push(bodyAs<EntityResponse>(createdOrder).id);
    }

    await prisma.deal.update({
      where: { id: created.dealId },
      data: { stage: DealStage.WON },
    });
    const orderResponse = await request(server)
      .post('/orders/from-deal')
      .set(authHeader(context.managerToken))
      .send({ dealId: created.dealId })
      .expect(201);
    const order = bodyAs<OrderResponse>(orderResponse);
    await payOrderInFull(order.id, order.totalAmount);

    for (const supplierOrderId of supplierOrderIds) {
      await request(server)
        .post(`/supplier-orders/${supplierOrderId}/confirm-ready`)
        .set(authHeader(context.headToken))
        .expect(200);
      await request(server)
        .patch(`/supplier-orders/${supplierOrderId}/status`)
        .set(authHeader(context.headToken))
        .send({ status: SupplierOrderStatus.SHIPPED })
        .expect(200);
    }

    return {
      dealId: created.dealId,
      orderId: order.id,
      supplierOrderIds,
    };
  }

  async function loginDualRole(
    label: string,
    roleNames: RoleName[],
  ): Promise<{ email: string; token: string }> {
    const email = `gf1-${label}-${RUN_ID}@hpl.test`;
    const passwordHash = await hash(TEST_PASSWORD, 12);
    await upsertUserWithRoles(prisma, {
      email,
      firstName: 'GF1',
      lastName: label,
      passwordHash,
      roleNames,
    });
    const tokens = await login(server, email);
    return { email, token: tokens.accessToken };
  }

  async function commercialPayload() {
    const supplier = await prisma.supplier.findFirstOrThrow({
      where: { code: 'wuya' },
    });
    const qualityClass = await prisma.qualityClass.findFirstOrThrow({
      where: { code: 'economy' },
    });

    return {
      supplierId: supplier.id,
      qualityClassId: qualityClass.id,
      decisionComment: 'GF1',
    };
  }

  async function createQualifiedLead(title: string): Promise<string> {
    const leadResponse = await request(server)
      .post('/leads')
      .set(authHeader(context.managerToken))
      .send({
        title,
        source: 'e2e',
        clientId: context.clientId,
      })
      .expect(201);
    const leadId = bodyAs<EntityResponse>(leadResponse).id;
    await qualifyLeadStage1(leadId);
    return leadId;
  }

  async function prepareSubsystemCommercial(approverToken: string): Promise<{
    leadId: string;
    quotesBefore: number;
    dealsBefore: number;
  }> {
    const leadResponse = await request(server)
      .post('/leads')
      .set(authHeader(context.managerToken))
      .send({
        title: `Stage3 subsystem ${RUN_ID}-${Math.random().toString(16).slice(2)}`,
        source: 'e2e',
        clientId: context.clientId,
      })
      .expect(201);
    const leadId = bodyAs<LeadResponse>(leadResponse).id;
    await qualifyLeadStage1(leadId, true);
    await prisma.leadQualification.update({
      where: { leadId },
      data: { ventFacadeKitRequired: true },
    });
    await request(server)
      .post(`/engineering/leads/${leadId}/assign`)
      .set(authHeader(context.managerToken))
      .send({ engineerId: context.engineerId })
      .expect(201);

    const calculated = await request(server)
      .post(`/engineering/leads/${leadId}/facade/calculate`)
      .set(authHeader(context.engineerToken))
      .send({
        configCode: 'HPL_FACADE_BASE_1220_3050',
        claddingAreaM2: '1000',
      })
      .expect(201);
    expect(bodyAs<{ quoteCreated: boolean; dealCreated: boolean }>(calculated).quoteCreated).toBe(
      false,
    );
    const quotesBefore = await prisma.panelQuote.count();
    const dealsBefore = await prisma.deal.count();

    const supplier = await prisma.supplier.findFirstOrThrow({
      where: { code: `QA-SUP-${RUN_ID}` },
    });
    const materials = await prisma.facadeMaterial.findMany({
      where: { isActive: true, category: { not: 'HPL' } },
    });
    for (const material of materials) {
      await request(server)
        .post('/references/facade-offers')
        .set(authHeader(context.headToken))
        .send({
          materialId: material.id,
          supplierId: supplier.id,
          purchasePrice: '1.5',
          currency: 'USD',
          unit: material.unit,
          validFrom: new Date().toISOString(),
        })
        .expect(201);
    }

    await request(server)
      .post(`/leads/${leadId}/facade-commercial`)
      .set(authHeader(approverToken))
      .expect(201);
    const workspace = await request(server)
      .get(`/leads/${leadId}/facade-commercial`)
      .set(authHeader(approverToken))
      .expect(200);
    const body = bodyAs<{
      calculation: {
        id: string;
        revision: number;
        items: Array<{
          id: string;
          excludedFromSubsystemCommercialCost: boolean;
          materialCode: string;
        }>;
      };
      offers: Array<{ id: string; materialCode: string; isActive: boolean }>;
    }>(workspace);
    const selections = body.calculation.items
      .filter((item) => !item.excludedFromSubsystemCommercialCost)
      .map((item) => ({
        itemId: item.id,
        offerId:
          body.offers.find(
            (offer) => offer.materialCode === item.materialCode && offer.isActive,
          )?.id ?? null,
      }));

    const patched = await request(server)
      .patch(`/leads/${leadId}/facade-commercial`)
      .set(authHeader(approverToken))
      .send({
        expectedRevision: body.calculation.revision,
        selections,
        proposedCustomerAmount: '8000',
        proposedCurrency: 'USD',
        commercialNote: 'Stage 3 explicit amount',
      })
      .expect(200);
    const patchedBody = bodyAs<{ revision: number }>(patched);
    const submitted = await request(server)
      .post(`/leads/${leadId}/facade-commercial/submit`)
      .set(authHeader(approverToken))
      .send({ expectedRevision: patchedBody.revision })
      .expect(201);
    await request(server)
      .post(`/leads/${leadId}/facade-commercial/approve`)
      .set(authHeader(approverToken))
      .send({ expectedRevision: bodyAs<{ revision: number }>(submitted).revision })
      .expect(201);
    return { leadId, quotesBefore, dealsBefore };
  }

  async function prepareInstallationCommercial(
    approverToken: string,
    options: { ventFacadeKitRequired?: boolean } = {},
  ): Promise<{
    leadId: string;
    quotesBefore: number;
    dealsBefore: number;
  }> {
    const leadResponse = await request(server)
      .post('/leads')
      .set(authHeader(context.managerToken))
      .send({
        title: `Stage4 installation ${RUN_ID}-${Math.random().toString(16).slice(2)}`,
        source: 'e2e',
        clientId: context.clientId,
      })
      .expect(201);
    const leadId = bodyAs<LeadResponse>(leadResponse).id;
    await qualifyLeadStage1(leadId, true);
    if (options.ventFacadeKitRequired) {
      await prisma.leadQualification.update({
        where: { leadId },
        data: { ventFacadeKitRequired: true },
      });
    }
    await request(server)
      .post(`/engineering/leads/${leadId}/assign`)
      .set(authHeader(context.managerToken))
      .send({ engineerId: context.engineerId })
      .expect(201);

    const suffix = Math.random().toString(16).slice(2, 8);
    const workTypeResponse = await request(server)
      .post('/references/installation-work-types')
      .set(authHeader(context.headToken))
      .send({
        code: `hpl_install_${suffix}`,
        nameRu: 'Монтаж HPL',
        nameUz: 'HPL montaj',
        nameEn: 'HPL install',
        unit: 'M2',
        category: 'CLADDING',
      })
      .expect(201);
    const workTypeId = bodyAs<EntityResponse>(workTypeResponse).id;
    const contractorResponse = await request(server)
      .post('/references/installation-contractors')
      .set(authHeader(context.headToken))
      .send({
        name: `Crew ${suffix}`,
        type: 'INTERNAL_CREW',
      })
      .expect(201);
    const contractorId = bodyAs<EntityResponse>(contractorResponse).id;
    const rateResponse = await request(server)
      .post('/references/installation-rates')
      .set(authHeader(context.headToken))
      .send({
        contractorId,
        workTypeId,
        unit: 'M2',
        pricePerUnit: '12',
        currency: 'USD',
        validFrom: new Date().toISOString(),
      })
      .expect(201);
    const rateId = bodyAs<EntityResponse>(rateResponse).id;

    const saved = await request(server)
      .patch(`/engineering/leads/${leadId}/installation`)
      .set(authHeader(context.engineerToken))
      .send({
        items: [{ workTypeId, quantity: '1000', quantitySource: 'MANUAL' }],
      })
      .expect(200);
    expect(bodyAs<{ quoteCreated: boolean; dealCreated: boolean }>(saved).quoteCreated).toBe(
      false,
    );
    await request(server)
      .post(`/engineering/leads/${leadId}/installation/complete`)
      .set(authHeader(context.engineerToken))
      .send({ expectedRevision: bodyAs<{ revision: number }>(saved).revision })
      .expect(201);

    const quotesBefore = await prisma.panelQuote.count();
    const dealsBefore = await prisma.deal.count();

    await request(server)
      .post(`/leads/${leadId}/installation-commercial`)
      .set(authHeader(approverToken))
      .expect(201);
    const workspace = await request(server)
      .get(`/leads/${leadId}/installation-commercial`)
      .set(authHeader(approverToken))
      .expect(200);
    const body = bodyAs<{
      calculation: {
        revision: number;
        items: Array<{ id: string }>;
      };
    }>(workspace);
    const patched = await request(server)
      .patch(`/leads/${leadId}/installation-commercial`)
      .set(authHeader(approverToken))
      .send({
        expectedRevision: body.calculation.revision,
        selections: [{ itemId: body.calculation.items[0].id, rateId }],
        proposedCustomerAmount: '15000',
        proposedCurrency: 'USD',
      })
      .expect(200);
    const submitted = await request(server)
      .post(`/leads/${leadId}/installation-commercial/submit`)
      .set(authHeader(approverToken))
      .send({ expectedRevision: bodyAs<{ revision: number }>(patched).revision })
      .expect(201);
    await request(server)
      .post(`/leads/${leadId}/installation-commercial/approve`)
      .set(authHeader(approverToken))
      .send({
        expectedRevision: bodyAs<{ revision: number }>(submitted).revision,
      })
      .expect(201);
    return { leadId, quotesBefore, dealsBefore };
  }

  async function prepareAllThreeCommercial(): Promise<{
    leadId: string;
    facadeRevision: number;
    installationRevision: number;
  }> {
    const leadResponse = await request(server)
      .post('/leads')
      .set(authHeader(context.managerToken))
      .send({
        title: `Stage5 all-three ${RUN_ID}-${Math.random().toString(16).slice(2)}`,
        source: 'e2e',
        clientId: context.clientId,
      })
      .expect(201);
    const leadId = bodyAs<LeadResponse>(leadResponse).id;
    await qualifyLeadStage1(leadId, true);
    await prisma.leadQualification.update({
      where: { leadId },
      data: { ventFacadeKitRequired: true },
    });
    await request(server)
      .post(`/engineering/leads/${leadId}/assign`)
      .set(authHeader(context.managerToken))
      .send({ engineerId: context.engineerId })
      .expect(201);

    await request(server)
      .post(`/engineering/leads/${leadId}/facade/calculate`)
      .set(authHeader(context.engineerToken))
      .send({
        configCode: 'HPL_FACADE_BASE_1220_3050',
        claddingAreaM2: '1000',
      })
      .expect(201);
    const supplier = await prisma.supplier.findFirstOrThrow({
      where: { code: `QA-SUP-${RUN_ID}` },
    });
    const materials = await prisma.facadeMaterial.findMany({
      where: { isActive: true, category: { not: 'HPL' } },
    });
    for (const material of materials) {
      await request(server)
        .post('/references/facade-offers')
        .set(authHeader(context.headToken))
        .send({
          materialId: material.id,
          supplierId: supplier.id,
          purchasePrice: '1.5',
          currency: 'USD',
          unit: material.unit,
          validFrom: new Date().toISOString(),
        })
        .expect(201);
    }
    await request(server)
      .post(`/leads/${leadId}/facade-commercial`)
      .set(authHeader(context.directorToken))
      .expect(201);
    const facadeWorkspace = await request(server)
      .get(`/leads/${leadId}/facade-commercial`)
      .set(authHeader(context.directorToken))
      .expect(200);
    const facadeBody = bodyAs<{
      calculation: {
        revision: number;
        items: Array<{
          id: string;
          excludedFromSubsystemCommercialCost: boolean;
          materialCode: string;
        }>;
      };
      offers: Array<{ id: string; materialCode: string; isActive: boolean }>;
    }>(facadeWorkspace);
    const facadeSelections = facadeBody.calculation.items
      .filter((item) => !item.excludedFromSubsystemCommercialCost)
      .map((item) => ({
        itemId: item.id,
        offerId:
          facadeBody.offers.find(
            (offer) => offer.materialCode === item.materialCode && offer.isActive,
          )?.id ?? null,
      }));
    const facadePatched = await request(server)
      .patch(`/leads/${leadId}/facade-commercial`)
      .set(authHeader(context.directorToken))
      .send({
        expectedRevision: facadeBody.calculation.revision,
        selections: facadeSelections,
        proposedCustomerAmount: '8000',
        proposedCurrency: 'USD',
      })
      .expect(200);
    const facadeSubmitted = await request(server)
      .post(`/leads/${leadId}/facade-commercial/submit`)
      .set(authHeader(context.directorToken))
      .send({
        expectedRevision: bodyAs<{ revision: number }>(facadePatched).revision,
      })
      .expect(201);
    await request(server)
      .post(`/leads/${leadId}/facade-commercial/approve`)
      .set(authHeader(context.directorToken))
      .send({
        expectedRevision: bodyAs<{ revision: number }>(facadeSubmitted).revision,
      })
      .expect(201);

    const suffix = Math.random().toString(16).slice(2, 8);
    const workTypeResponse = await request(server)
      .post('/references/installation-work-types')
      .set(authHeader(context.headToken))
      .send({
        code: `hpl_install_all3_${suffix}`,
        nameRu: 'Монтаж HPL',
        nameUz: 'HPL montaj',
        nameEn: 'HPL install',
        unit: 'M2',
        category: 'CLADDING',
      })
      .expect(201);
    const workTypeId = bodyAs<EntityResponse>(workTypeResponse).id;
    const contractorResponse = await request(server)
      .post('/references/installation-contractors')
      .set(authHeader(context.headToken))
      .send({
        name: `Crew all3 ${suffix}`,
        type: 'INTERNAL_CREW',
      })
      .expect(201);
    const contractorId = bodyAs<EntityResponse>(contractorResponse).id;
    const rateResponse = await request(server)
      .post('/references/installation-rates')
      .set(authHeader(context.headToken))
      .send({
        contractorId,
        workTypeId,
        unit: 'M2',
        pricePerUnit: '12',
        currency: 'USD',
        validFrom: new Date().toISOString(),
      })
      .expect(201);
    const rateId = bodyAs<EntityResponse>(rateResponse).id;
    const saved = await request(server)
      .patch(`/engineering/leads/${leadId}/installation`)
      .set(authHeader(context.engineerToken))
      .send({
        items: [{ workTypeId, quantity: '1000', quantitySource: 'MANUAL' }],
      })
      .expect(200);
    await request(server)
      .post(`/engineering/leads/${leadId}/installation/complete`)
      .set(authHeader(context.engineerToken))
      .send({ expectedRevision: bodyAs<{ revision: number }>(saved).revision })
      .expect(201);
    await request(server)
      .post(`/leads/${leadId}/installation-commercial`)
      .set(authHeader(context.headToken))
      .expect(201);
    const installWorkspace = await request(server)
      .get(`/leads/${leadId}/installation-commercial`)
      .set(authHeader(context.headToken))
      .expect(200);
    const installBody = bodyAs<{
      calculation: { revision: number; items: Array<{ id: string }> };
    }>(installWorkspace);
    const installPatched = await request(server)
      .patch(`/leads/${leadId}/installation-commercial`)
      .set(authHeader(context.headToken))
      .send({
        expectedRevision: installBody.calculation.revision,
        selections: [
          { itemId: installBody.calculation.items[0].id, rateId },
        ],
        proposedCustomerAmount: '15000',
        proposedCurrency: 'USD',
      })
      .expect(200);
    const installSubmitted = await request(server)
      .post(`/leads/${leadId}/installation-commercial/submit`)
      .set(authHeader(context.headToken))
      .send({
        expectedRevision: bodyAs<{ revision: number }>(installPatched).revision,
      })
      .expect(201);
    await request(server)
      .post(`/leads/${leadId}/installation-commercial/approve`)
      .set(authHeader(context.headToken))
      .send({
        expectedRevision: bodyAs<{ revision: number }>(installSubmitted)
          .revision,
      })
      .expect(201);

    const facade = await prisma.facadeCommercialCalculation.findFirstOrThrow({
      where: { leadId, status: 'APPROVED' },
      orderBy: { revision: 'desc' },
    });
    const installation =
      await prisma.installationCommercialCalculation.findFirstOrThrow({
        where: { leadId, status: 'APPROVED' },
        orderBy: { revision: 'desc' },
      });

    return {
      leadId,
      facadeRevision: facade.revision,
      installationRevision: installation.revision,
    };
  }

  async function qualifyLeadStage1(
    leadId: string,
    installationRequired = false,
  ): Promise<void> {
    await request(server)
      .post(`/leads/${leadId}/qualify`)
      .set(authHeader(context.managerToken))
      .send({
        clientId: context.clientId,
        contactId: context.contactId,
        projectObjectId: context.projectObjectId,
        needDescription: 'HPL panels for lobby',
        decisionMakerContact: 'Chief architect',
        qualification: await stage1QualificationPayload(prisma, {
          installationRequired,
        }),
      })
      .expect(201);
  }

  async function confirmLeadStage2(
    leadId: string,
    supplierCode = 'wuya',
    qualityCode = 'economy',
  ): Promise<void> {
    const supplier = await prisma.supplier.findFirstOrThrow({
      where: { code: supplierCode },
    });
    const qualityClass = await prisma.qualityClass.findFirstOrThrow({
      where: { code: qualityCode },
    });

    await request(server)
      .post(`/leads/${leadId}/commercial-qualification`)
      .set(authHeader(context.headToken))
      .send({
        supplierId: supplier.id,
        qualityClassId: qualityClass.id,
        decisionComment: `${supplierCode} ${qualityCode}`,
      })
      .expect(201);
  }

  async function createApprovedPanelQuote(
    installationRequired = false,
  ): Promise<string> {
    const quoteId = await createSentPanelQuote(installationRequired);

    await request(server)
      .patch(`/quotes/${quoteId}/status`)
      .set(authHeader(context.headToken))
      .send({ status: 'approved' })
      .expect(200);

    return quoteId;
  }

  async function createSentPanelQuote(
    installationRequired = false,
  ): Promise<string> {
    const leadResponse = await request(server)
      .post('/leads')
      .set(authHeader(context.managerToken))
      .send({
        title: `Quote lead ${RUN_ID}-${Math.random().toString(16).slice(2)}`,
        source: 'e2e',
        clientId: context.clientId,
      })
      .expect(201);

    const leadId = bodyAs<EntityResponse>(leadResponse).id;

    await qualifyLeadStage1(leadId, installationRequired);
    await confirmLeadStage2(leadId);

    const panelType = await prisma.panelType.findFirstOrThrow({
      where: { code: 'exterior_with_uv' },
    });
    const panelSize = await prisma.panelSize.findFirstOrThrow({
      where: { widthMm: 1220, heightMm: 2440 },
    });
    const supplier = await prisma.supplier.findFirstOrThrow({
      where: { code: 'wuya' },
    });
    const qualityClass = await prisma.qualityClass.findFirstOrThrow({
      where: { code: 'economy' },
    });

    const calculationRequest = await request(server)
      .post('/calculations/requests')
      .set(authHeader(context.managerToken))
      .send({
        leadId,
        notes: 'Canonical Manager technical request',
        calculations: [
          {
            title: 'Main facade',
            items: [
              {
                panelTypeId: panelType.id,
                panelSizeId: panelSize.id,
                thicknessMm: 10,
                qualityClassId: qualityClass.id,
                requiredAreaM2: '15.50',
                supplierId: supplier.id,
              },
            ],
          },
        ],
      });
    if (calculationRequest.status !== 201) {
      throw new Error(
        `Canonical calculation request failed: ${calculationRequest.status} ${JSON.stringify(calculationRequest.body)}`,
      );
    }

    const requestId = bodyAs<EntityResponse>(calculationRequest).id;

    await request(server)
      .post(`/calculations/requests/${requestId}/submit`)
      .set(authHeader(context.managerToken))
      .expect(201);

    const quoteResponse = await request(server)
      .post(`/calculations/requests/${requestId}/convert-to-quote`)
      .set(authHeader(context.headToken))
      .send({ clientComment: 'E2E sent quote' })
      .expect(201);

    const quote = bodyAs<EntityResponse & { items: EntityResponse[] }>(
      quoteResponse,
    );
    const quoteId = quote.id;

    await request(server)
      .patch(`/quotes/${quoteId}/approved-pricing`)
      .set(authHeader(context.headToken))
      .send({
        items: quote.items.map((item, index) => ({
          id: item.id,
          purchasePricePerM2Cny: String(80 + index * 10),
        })),
      })
      .expect(200);

    await request(server)
      .patch(`/quotes/${quoteId}/commercial-terms`)
      .set(authHeader(context.headToken))
      .send({
        productionTerms: '15–20 рабочих дней',
        deliveryTerms: 'Ориентировочно 4 недели после утверждения декора',
        commercialNote: 'Client-facing E2E note',
        internalCommercialNote: 'INTERNAL-ONLY-DO-NOT-SHOW',
      })
      .expect(200);

    await request(server)
      .post(`/quotes/${quoteId}/finalize`)
      .set(authHeader(context.headToken))
      .send({})
      .expect(200);

    await request(server)
      .patch(`/quotes/${quoteId}/status`)
      .set(authHeader(context.managerToken))
      .send({ status: 'sent' })
      .expect(200);

    return quoteId;
  }

  async function headQuoteFromExistingLead(leadId: string): Promise<string> {
    const panelType = await prisma.panelType.findFirstOrThrow({
      where: { code: 'exterior_with_uv' },
    });
    const panelSize = await prisma.panelSize.findFirstOrThrow({
      where: { widthMm: 1220, heightMm: 2440 },
    });
    const supplier = await prisma.supplier.findFirstOrThrow({
      where: { code: 'wuya' },
    });
    const qualityClass = await prisma.qualityClass.findFirstOrThrow({
      where: { code: 'economy' },
    });
    const calculationRequest = await request(server)
      .post('/calculations/requests')
      .set(authHeader(context.managerToken))
      .send({
        leadId,
        notes: 'Stage 5 combined quote request',
        calculations: [
          {
            title: 'Main facade',
            items: [
              {
                panelTypeId: panelType.id,
                panelSizeId: panelSize.id,
                thicknessMm: 10,
                qualityClassId: qualityClass.id,
                requiredAreaM2: '15.50',
                supplierId: supplier.id,
              },
            ],
          },
        ],
      })
      .expect(201);
    const requestId = bodyAs<EntityResponse>(calculationRequest).id;
    await request(server)
      .post(`/calculations/requests/${requestId}/submit`)
      .set(authHeader(context.managerToken))
      .expect(201);
    const quoteResponse = await request(server)
      .post(`/calculations/requests/${requestId}/convert-to-quote`)
      .set(authHeader(context.headToken))
      .send({ clientComment: 'Stage 5 quote' })
      .expect(201);
    const quote = bodyAs<EntityResponse & { items: EntityResponse[] }>(
      quoteResponse,
    );
    await request(server)
      .patch(`/quotes/${quote.id}/approved-pricing`)
      .set(authHeader(context.headToken))
      .send({
        items: quote.items.map((item, index) => ({
          id: item.id,
          purchasePricePerM2Cny: String(80 + index * 10),
        })),
      })
      .expect(200);
    await request(server)
      .patch(`/quotes/${quote.id}/commercial-terms`)
      .set(authHeader(context.headToken))
      .send({
        productionTerms: '15–20 рабочих дней',
        deliveryTerms: 'Ориентировочно 4 недели после утверждения декора',
      })
      .expect(200);
    await request(server)
      .post(`/quotes/${quote.id}/finalize`)
      .set(authHeader(context.headToken))
      .send({})
      .expect(200);
    return quote.id;
  }

  function skuItemPayload(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      productId: context.productId,
      quantitySheets: 2,
      quantityM2: 1,
      unitPrice: 100,
      discount: 0,
      ...overrides,
    };
  }

  async function createPayment(orderId: string, amount: number) {
    const response = await request(server)
      .post(`/orders/${orderId}/payments`)
      .set(authHeader(context.managerToken))
      .send({
        orderId,
        amount: amount.toFixed(2),
        paymentDate: new Date().toISOString(),
      });

    if (response.status !== 201) {
      console.log('PAYMENT_RESPONSE_BODY', response.body);
    }

    expect(response.status).toBe(201);

    return bodyAs<EntityResponse>(response);
  }

  async function createWonOrder(): Promise<OrderResponse & { dealId: string }> {
    const wonDeal = await createDeal(prisma, context, DealStage.WON);
    const orderResponse = await request(server)
      .post('/orders/from-deal')
      .set(authHeader(context.managerToken))
      .send({ dealId: wonDeal.id })
      .expect(201);

    return { ...bodyAs<OrderResponse>(orderResponse), dealId: wonDeal.id };
  }

  async function payOrderInFull(
    orderId: string,
    totalAmount: string | number,
  ): Promise<void> {
    const payment = await createPayment(orderId, Number(totalAmount));
    await request(server)
      .patch(`/orders/payments/${payment.id}/confirm`)
      .set(authHeader(context.accountantToken))
      .send({ status: PaymentRecordStatus.CONFIRMED })
      .expect(200);
  }

  function deliveryPayload(
    orderId: string,
    orderItemId: string,
    quantity: number,
  ) {
    return {
      orderId,
      deliveryDate: new Date().toISOString(),
      items: [{ orderItemId, quantity }],
    };
  }
});

async function seedAcceptanceData(
  prisma: PrismaService,
  server: App,
): Promise<TestContext> {
  await seedAuthData(prisma);

  const passwordHash = await hash(TEST_PASSWORD, 12);
  await ensureSystemUsers(prisma, passwordHash);

  const head = await upsertUser(prisma, {
    email: `head-${RUN_ID}@hpl.test`,
    firstName: 'Acceptance',
    lastName: 'Head',
    passwordHash,
    roleName: RoleName.HEAD,
  });
  const manager = await upsertUser(prisma, {
    email: `manager-${RUN_ID}@hpl.test`,
    firstName: 'Acceptance',
    lastName: 'Manager',
    passwordHash,
    roleName: RoleName.MANAGER,
    managerId: head.id,
  });
  const admin = await upsertUser(prisma, {
    email: `admin-${RUN_ID}@hpl.test`,
    firstName: 'Acceptance',
    lastName: 'Admin',
    passwordHash,
    roleName: RoleName.ADMIN,
  });
  const director = await upsertUser(prisma, {
    email: `director-${RUN_ID}@hpl.test`,
    firstName: 'Acceptance',
    lastName: 'Director',
    passwordHash,
    roleName: RoleName.DIRECTOR,
  });
  const accountant = await upsertUser(prisma, {
    email: `accountant-${RUN_ID}@hpl.test`,
    firstName: 'Acceptance',
    lastName: 'Accountant',
    passwordHash,
    roleName: RoleName.ACCOUNTANT,
  });
  await upsertUser(prisma, {
    email: `storekeeper-${RUN_ID}@hpl.test`,
    firstName: 'Acceptance',
    lastName: 'Storekeeper',
    passwordHash,
    roleName: RoleName.STOREKEEPER,
  });
  const engineer = await upsertUser(prisma, {
    email: `engineer-${RUN_ID}@hpl.test`,
    firstName: 'Acceptance',
    lastName: 'Engineer',
    passwordHash,
    roleName: RoleName.ENGINEER,
  });

  const adminTokens = await login(server, `admin-${RUN_ID}@hpl.test`);
  const directorTokens = await login(server, `director-${RUN_ID}@hpl.test`);
  const headTokens = await login(server, `head-${RUN_ID}@hpl.test`);
  const managerTokens = await login(server, `manager-${RUN_ID}@hpl.test`);
  const accountantTokens = await login(server, `accountant-${RUN_ID}@hpl.test`);
  const storekeeperTokens = await login(
    server,
    `storekeeper-${RUN_ID}@hpl.test`,
  );
  const engineerTokens = await login(server, `engineer-${RUN_ID}@hpl.test`);

  const supplier = await prisma.supplier.upsert({
    where: { code: `QA-SUP-${RUN_ID}` },
    update: { name: `QA Supplier ${RUN_ID}` },
    create: { code: `QA-SUP-${RUN_ID}`, name: `QA Supplier ${RUN_ID}` },
  });
  const brand = await prisma.brand.upsert({
    where: { code: `QA-BRAND-${RUN_ID}` },
    update: { name: `QA Brand ${RUN_ID}` },
    create: { code: `QA-BRAND-${RUN_ID}`, name: `QA Brand ${RUN_ID}` },
  });
  const collection = await prisma.productCollection.upsert({
    where: {
      brandId_name: {
        brandId: brand.id,
        name: `QA Collection ${RUN_ID}`,
      },
    },
    update: {},
    create: {
      brandId: brand.id,
      name: `QA Collection ${RUN_ID}`,
    },
  });
  const sheetArea = (3050 * 1300) / 1_000_000;
  const product = await prisma.product.upsert({
    where: { sku: `QA-HPL-${RUN_ID}` },
    update: {
      name: `QA HPL Panel ${RUN_ID}`,
      brandId: brand.id,
      collectionId: collection.id,
      supplierId: supplier.id,
      thickness: 12,
      length: 3050,
      width: 1300,
      sheetArea,
      unit: 'm2',
      status: ProductStatus.ACTIVE,
      deletedAt: null,
    },
    create: {
      sku: `QA-HPL-${RUN_ID}`,
      name: `QA HPL Panel ${RUN_ID}`,
      brandId: brand.id,
      collectionId: collection.id,
      supplierId: supplier.id,
      decorCode: `QA-${RUN_ID}`,
      colorName: 'White',
      surface: 'Matte',
      thickness: 12,
      length: 3050,
      width: 1300,
      sheetArea,
      unit: 'm2',
      status: ProductStatus.ACTIVE,
    },
  });

  await prisma.productPrice.deleteMany({ where: { productId: product.id } });
  await prisma.productPrice.createMany({
    data: [
      {
        productId: product.id,
        type: ProductPriceType.PURCHASE,
        amount: 60,
        validFrom: new Date(Date.now() - 60_000),
      },
      {
        productId: product.id,
        type: ProductPriceType.RETAIL,
        amount: 100,
        validFrom: new Date(Date.now() - 60_000),
      },
    ],
  });
  await prisma.stockBalance.upsert({
    where: { productId: product.id },
    update: { onHand: 500, reserved: 0, available: 500 },
    create: { productId: product.id, onHand: 500, reserved: 0, available: 500 },
  });

  const client = await prisma.client.create({
    data: {
      type: ClientType.COMPANY,
      name: `QA Client ${RUN_ID}`,
      inn: `7700${RUN_ID.slice(-6)}`,
      phone: '79991112233',
      email: `client-${RUN_ID}@example.test`,
      segment: ClientSegment.DEALER,
      ownerId: manager.id,
    },
  });
  const contact = await prisma.contact.create({
    data: {
      clientId: client.id,
      firstName: 'Decision',
      lastName: 'Maker',
      phone: '79992223344',
      email: `contact-${RUN_ID}@example.test`,
      isPrimary: true,
    },
  });
  const projectObject = await prisma.projectObject.create({
    data: {
      clientId: client.id,
      name: `QA Object ${RUN_ID}`,
      address: 'QA address',
      decisionMakerContactId: contact.id,
    },
  });

  const { apiKeyToken, apiKeyLimitedToken } =
    await seedServiceAccountsForE2e(prisma);

  await seedPanels(prisma);
  await seedFixtureCnyUsdRate(prisma, admin.id);
  await seedCalculatorProduct(prisma);
  await seedFacadeSubsystemCatalog(prisma);

  return {
    adminToken: adminTokens.accessToken,
    directorToken: directorTokens.accessToken,
    headToken: headTokens.accessToken,
    managerToken: managerTokens.accessToken,
    accountantToken: accountantTokens.accessToken,
    storekeeperToken: storekeeperTokens.accessToken,
    engineerToken: engineerTokens.accessToken,
    headId: head.id,
    managerId: manager.id,
    accountantId: accountant.id,
    directorId: director.id,
    engineerId: engineer.id,
    clientId: client.id,
    contactId: contact.id,
    projectObjectId: projectObject.id,
    productId: product.id,
    sheetArea,
    apiKeyToken,
    apiKeyLimitedToken,
  };
}

async function ensureSystemUsers(
  prisma: PrismaService,
  passwordHash: string,
): Promise<void> {
  await upsertUser(prisma, {
    email: 'lead-pool@hpl.com',
    firstName: 'Lead',
    lastName: 'Pool',
    passwordHash,
  });
  await upsertUser(prisma, {
    email: 'system@hpl.com',
    firstName: 'System',
    lastName: 'Bot',
    passwordHash,
  });
}

async function seedAuthData(prisma: PrismaService): Promise<void> {
  await synchronizeRbac(prisma);
}

async function upsertUser(
  prisma: PrismaService,
  input: {
    email: string;
    firstName: string;
    lastName: string;
    passwordHash: string;
    roleName?: RoleName;
    managerId?: string;
  },
): Promise<{ id: string }> {
  const user = await prisma.user.upsert({
    where: { email: input.email },
    update: {
      passwordHash: input.passwordHash,
      firstName: input.firstName,
      lastName: input.lastName,
      managerId: input.managerId,
      isActive: true,
    },
    create: {
      email: input.email,
      passwordHash: input.passwordHash,
      firstName: input.firstName,
      lastName: input.lastName,
      managerId: input.managerId,
      isActive: true,
    },
    select: { id: true },
  });

  await prisma.userRole.deleteMany({ where: { userId: user.id } });

  if (input.roleName) {
    const role = await prisma.role.findUniqueOrThrow({
      where: { name: input.roleName },
      select: { id: true },
    });
    await prisma.userRole.create({
      data: {
        userId: user.id,
        roleId: role.id,
      },
    });
  }

  return user;
}

async function upsertUserWithRoles(
  prisma: PrismaService,
  input: {
    email: string;
    firstName: string;
    lastName: string;
    passwordHash: string;
    roleNames: RoleName[];
  },
): Promise<{ id: string }> {
  const user = await prisma.user.upsert({
    where: { email: input.email },
    update: {
      passwordHash: input.passwordHash,
      firstName: input.firstName,
      lastName: input.lastName,
      isActive: true,
    },
    create: {
      email: input.email,
      passwordHash: input.passwordHash,
      firstName: input.firstName,
      lastName: input.lastName,
      isActive: true,
    },
    select: { id: true },
  });

  await prisma.userRole.deleteMany({ where: { userId: user.id } });

  const roles = await prisma.role.findMany({
    where: { name: { in: input.roleNames } },
    select: { id: true, name: true },
  });

  await prisma.userRole.createMany({
    data: roles.map((role) => ({
      userId: user.id,
      roleId: role.id,
    })),
  });

  return user;
}

async function login(server: App, email: string): Promise<AuthTokens> {
  const response = await request(server)
    .post('/auth/login')
    .send({ email, password: TEST_PASSWORD })
    .expect(201);

  return bodyAs<AuthTokens>(response);
}

async function createDeal(
  prisma: PrismaService,
  context: TestContext,
  stage: DealStage = DealStage.QUALIFICATION,
  items: Prisma.DealItemCreateWithoutDealInput[] = [
    {
      product: { connect: { id: context.productId } },
      quantitySheets: 2,
      quantityM2: context.sheetArea * 2,
      unitPrice: new Prisma.Decimal(100),
      discount: new Prisma.Decimal(0),
      totalPrice: new Prisma.Decimal(context.sheetArea * 2 * 100),
      purchasePriceSnapshot: new Prisma.Decimal(60),
    },
  ],
): Promise<EntityResponse> {
  const totalAmount = items.reduce(
    (sum, item) => sum.plus(item.totalPrice as Prisma.Decimal),
    new Prisma.Decimal(0),
  );
  const purchaseCost = new Prisma.Decimal(context.sheetArea * 2 * 60);

  return prisma.deal.create({
    data: {
      title: `QA Deal ${RUN_ID}-${Math.random().toString(16).slice(2)}`,
      clientId: context.clientId,
      projectObjectId: context.projectObjectId,
      ownerId: context.managerId,
      fulfillmentSource: FulfillmentSource.WAREHOUSE_STOCK,
      stage,
      totalAmount,
      margin: totalAmount.minus(purchaseCost),
      items: { create: items },
    },
    select: { id: true },
  });
}

function authHeader(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

function bodyAs<T>(response: Response): T {
  const body: unknown = response.body;
  return body as T;
}

function futureDate(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function futureIso(days: number): string {
  return futureDate(days).toISOString();
}

async function stage1QualificationPayload(
  prisma: PrismaService,
  overrides: {
    installationRequired: boolean;
    stockOnly?: boolean;
    urgent?: boolean;
    willingToWait?: boolean;
  },
): Promise<Record<string, unknown>> {
  const panelType = await prisma.panelType.findFirstOrThrow({
    where: { code: 'exterior_with_uv' },
  });
  const panelSize = await prisma.panelSize.findFirstOrThrow({
    where: { widthMm: 1220, heightMm: 2440 },
  });

  return {
    application: 'EXTERIOR_WITH_UV',
    panelTypeId: panelType.id,
    thicknessMm: 10,
    panelSizeId: panelSize.id,
    colorCode: 'W100',
    colorName: 'White',
    requiredAreaM2: 15.5,
    installationRequired: overrides.installationRequired,
    stockOnly: overrides.stockOnly ?? false,
    urgent: overrides.urgent ?? false,
    willingToWait: overrides.willingToWait ?? true,
    customerRequirements: 'Only buys if material is in stock',
  };
}

function hashApiKeyToken(token: string, pepper: string): string {
  return createHash('sha256')
    .update(token + pepper)
    .digest('hex');
}

async function seedServiceAccountsForE2e(
  prisma: PrismaService,
): Promise<{ apiKeyToken: string; apiKeyLimitedToken: string }> {
  const pepper =
    process.env.SERVICE_ACCOUNT_TOKEN_PEPPER ??
    'test-service-account-pepper-min-32-chars';
  const apiKeyToken = `e2e-valid-${RUN_ID}`;
  const apiKeyLimitedToken = `e2e-limited-${RUN_ID}`;

  await prisma.serviceAccount.upsert({
    where: { name: `telegram-bot-e2e-${RUN_ID}` },
    update: {},
    create: {
      name: `telegram-bot-e2e-${RUN_ID}`,
      tokenHash: hashApiKeyToken(apiKeyToken, pepper),
      permissions: ['leads:create'],
      isActive: true,
    },
  });

  await prisma.serviceAccount.upsert({
    where: { name: `telegram-bot-limited-${RUN_ID}` },
    update: {},
    create: {
      name: `telegram-bot-limited-${RUN_ID}`,
      tokenHash: hashApiKeyToken(apiKeyLimitedToken, pepper),
      permissions: ['clients:create'],
      isActive: true,
    },
  });

  return { apiKeyToken, apiKeyLimitedToken };
}
