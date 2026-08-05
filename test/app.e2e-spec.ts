import 'dotenv/config';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  ActivityType,
  ClientSegment,
  ClientType,
  DealStage,
  PaymentRecordStatus,
  PaymentStatus,
  Prisma,
  ProductPriceType,
  ProductStatus,
  RoleName,
  TaskPriority,
  TaskStatus,
  TaskType,
} from '@prisma/client';
import { hash } from 'bcryptjs';
import request, { Response } from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/modules/prisma/prisma.service';
import { TasksCronService } from './../src/modules/tasks/tasks-cron.service';

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
  headToken: string;
  managerToken: string;
  headId: string;
  managerId: string;
  clientId: string;
  contactId: string;
  projectObjectId: string;
  productId: string;
  sheetArea: number;
};

const RUN_ID = `${Date.now()}`;
const TEST_PASSWORD = 'Password123!';
const ACCESS_SECRET = 'test-access-secret';
const REFRESH_SECRET = 'test-refresh-secret';

jest.setTimeout(120_000);

const permissionSlugs = [
  'users:read',
  'users:create',
  'users:manage',
  'products:read',
  'products:create',
  'products:update',
  'products:delete',
  'products:manage_prices',
  'products:read_purchase_price',
  'clients:read',
  'clients:read_all',
  'clients:create',
  'clients:update',
  'clients:delete',
  'leads:read',
  'leads:read_all',
  'leads:create',
  'leads:update',
  'leads:delete',
  'leads:qualify',
  'leads:assign',
  'tasks:read',
  'tasks:read_all',
  'tasks:create',
  'tasks:update',
  'tasks:delete',
  'deals:read',
  'deals:read_all',
  'deals:create',
  'deals:update',
  'deals:delete',
  'deals:create_offer',
  'deals:approve_offer',
  'deals:stage_exception',
  'orders:read',
  'orders:create',
  'payments:create',
  'payments:confirm',
  'deliveries:create',
  'inventory:read',
  'inventory:manage',
  'audit:read',
] as const;

describe('CRM HPL acceptance criteria (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let prisma: PrismaService;
  let tasksCronService: TasksCronService;
  let context: TestContext;

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = ACCESS_SECRET;
    process.env.JWT_REFRESH_SECRET = REFRESH_SECRET;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await app.init();

    server = app.getHttpServer();
    prisma = app.get(PrismaService);
    tasksCronService = app.get(TasksCronService);
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

  it('AT-03 enforces lead qualification fields and converts lead to qualification deal', async () => {
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
        estimatedAmount: 125000,
        targetDate: futureIso(20),
      })
      .expect(400);

    const qualifyResponse = await request(server)
      .post(`/leads/${lead.id}/qualify`)
      .set(authHeader(context.managerToken))
      .send({
        clientId: context.clientId,
        projectObjectId: context.projectObjectId,
        needDescription: 'HPL panels for lobby',
        estimatedAmount: 125000,
        targetDate: futureIso(20),
        decisionMakerContact: 'Chief architect',
      })
      .expect(201);
    const qualifiedLead = bodyAs<LeadResponse>(qualifyResponse);

    expect(qualifiedLead.dealId).toBeDefined();

    const deal = await prisma.deal.findUniqueOrThrow({
      where: { id: qualifiedLead.dealId },
    });
    expect(deal.stage).toBe(DealStage.QUALIFICATION);
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
      .set(authHeader(context.headToken))
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
      .set(authHeader(context.headToken))
      .send({ status: PaymentRecordStatus.CONFIRMED })
      .expect(200);
    const paidOrder = bodyAs<OrderResponse>(secondConfirmation);

    expect(Number(paidOrder.paidAmount)).toBeCloseTo(totalAmount, 2);
    expect(Number(paidOrder.remainingAmount)).toBe(0);
    expect(paidOrder.paymentStatus).toBe(PaymentStatus.PAID);
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
    const payment = await createPayment(order.id, Number(order.totalAmount));

    await request(server)
      .patch(`/orders/payments/${payment.id}/confirm`)
      .set(authHeader(context.headToken))
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

  async function createPayment(orderId: string, amount: number) {
    const response = await request(server)
      .post(`/orders/${orderId}/payments`)
      .set(authHeader(context.managerToken))
      .send({
        orderId,
        amount,
        paymentDate: new Date().toISOString(),
      })
      .expect(201);

    return bodyAs<EntityResponse>(response);
  }
});

async function seedAcceptanceData(
  prisma: PrismaService,
  server: App,
): Promise<TestContext> {
  await seedAuthData(prisma);

  const passwordHash = await hash(TEST_PASSWORD, 12);
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
  await upsertUser(prisma, {
    email: `admin-${RUN_ID}@hpl.test`,
    firstName: 'Acceptance',
    lastName: 'Admin',
    passwordHash,
    roleName: RoleName.ADMIN,
  });

  const adminTokens = await login(server, `admin-${RUN_ID}@hpl.test`);
  const headTokens = await login(server, `head-${RUN_ID}@hpl.test`);
  const managerTokens = await login(server, `manager-${RUN_ID}@hpl.test`);

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

  return {
    adminToken: adminTokens.accessToken,
    headToken: headTokens.accessToken,
    managerToken: managerTokens.accessToken,
    headId: head.id,
    managerId: manager.id,
    clientId: client.id,
    contactId: contact.id,
    projectObjectId: projectObject.id,
    productId: product.id,
    sheetArea,
  };
}

async function seedAuthData(prisma: PrismaService): Promise<void> {
  const roleIds = new Map<RoleName, string>();
  const permissionIds = new Map<string, string>();

  for (const roleName of Object.values(RoleName)) {
    const role = await prisma.role.upsert({
      where: { name: roleName },
      update: {},
      create: { name: roleName },
      select: { id: true },
    });
    roleIds.set(roleName, role.id);
  }

  for (const slug of permissionSlugs) {
    const permission = await prisma.permission.upsert({
      where: { slug },
      update: {},
      create: { slug, description: slug },
      select: { id: true },
    });
    permissionIds.set(slug, permission.id);
  }

  await assignRolePermissions(
    prisma,
    roleIds,
    RoleName.ADMIN,
    Array.from(permissionSlugs),
  );
  await assignRolePermissions(
    prisma,
    roleIds,
    RoleName.HEAD,
    Array.from(permissionSlugs),
  );
  await assignRolePermissions(prisma, roleIds, RoleName.MANAGER, [
    'products:read',
    'clients:read',
    'clients:create',
    'clients:update',
    'leads:read',
    'leads:create',
    'leads:update',
    'leads:qualify',
    'tasks:read',
    'tasks:create',
    'tasks:update',
    'deals:read',
    'deals:create',
    'deals:update',
    'deals:create_offer',
    'orders:read',
    'orders:create',
    'payments:create',
    'deliveries:create',
    'audit:read',
  ]);
  await assignRolePermissions(prisma, roleIds, RoleName.STOREKEEPER, [
    'products:read',
    'orders:read',
    'deliveries:create',
    'inventory:read',
    'inventory:manage',
  ]);
  await assignRolePermissions(
    prisma,
    roleIds,
    RoleName.OBSERVER,
    Array.from(permissionSlugs).filter((slug) => slug.endsWith(':read')),
  );

  async function assignRolePermissions(
    prismaService: PrismaService,
    roles: Map<RoleName, string>,
    roleName: RoleName,
    slugs: string[],
  ): Promise<void> {
    const roleId = getFromMap(roles, roleName);

    for (const slug of slugs) {
      const permissionId = getFromMap(permissionIds, slug);

      await prismaService.rolePermission.upsert({
        where: {
          roleId_permissionId: { roleId, permissionId },
        },
        update: {},
        create: { roleId, permissionId },
      });
    }
  }
}

async function upsertUser(
  prisma: PrismaService,
  input: {
    email: string;
    firstName: string;
    lastName: string;
    passwordHash: string;
    roleName: RoleName;
    managerId?: string;
  },
): Promise<{ id: string }> {
  const role = await prisma.role.findUniqueOrThrow({
    where: { name: input.roleName },
    select: { id: true },
  });
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
  await prisma.userRole.create({
    data: {
      userId: user.id,
      roleId: role.id,
    },
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

function getFromMap<T>(map: Map<string, T>, key: string): T {
  const value = map.get(key);

  if (!value) {
    throw new Error(`Missing test fixture: ${key}`);
  }

  return value;
}
