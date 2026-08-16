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
import request, { Response } from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { TestIntegrationsModule } from './../src/integrations/test/test-integrations.module';
import { seedPanels, seedFixtureCnyUsdRate } from './../prisma/seed/panels';
import { seedCalculatorProduct } from './../prisma/seed/calculator-product';
import { IdempotencyService } from './../src/integrations/telegram/services/idempotency.service';
import { TelegramAdminHandlerService } from './../src/integrations/telegram/services/telegram-admin-handler.service';
import { TelegramLeadFactory } from './../src/integrations/telegram/services/telegram-lead-factory.service';
import { compactUuid } from './../src/integrations/telegram/telegram.types';
import { InventoryService } from './../src/modules/inventory/inventory.service';
import { SHIPMENT_PAYMENT_NOT_CONFIRMED_MESSAGE } from './../src/modules/orders/services/shipment-payment.policy';
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
  apiKeyToken: string;
  apiKeyLimitedToken: string;
};

const RUN_ID = `${Date.now()}`;
const TEST_PASSWORD = 'Password123!';
// env.schema требует >= 32 символов на JWT-секрет
const ACCESS_SECRET = 'test-access-secret-key-min-32-chars';
const REFRESH_SECRET = 'test-refresh-secret-key-min-32-chars';

jest.setTimeout(120_000);

const permissionSlugs = [
  'auth:me',
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
  'deals:override_terminal',
  'orders:read',
  'orders:create',
  'orders:cancel',
  'payments:create',
  'payments:confirm',
  'deliveries:create',
  'inventory:read',
  'inventory:manage',
  'files:upload',
  'files:read',
  'audit:read',
  'reports:read',
  'admin:queues',
  'panel_catalog:read',
  'panel_catalog:manage',
  'calculations:read',
  'calculations:read_all',
  'calculations:create',
  'calculations:update',
  'calculations:delete',
  'quotes:read',
  'quotes:read_all',
  'quotes:create',
  'quotes:update',
  'quotes:approve',
  'currency_rates:manage',
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
      .set(authHeader(context.adminToken))
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
      .set(authHeader(context.adminToken))
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
      .set(authHeader(context.adminToken))
      .send({ status: PaymentRecordStatus.CONFIRMED })
      .expect(200);

    const secondPayment = await createPayment(order.id, totalAmount / 2);
    await request(server)
      .patch(`/orders/payments/${secondPayment.id}/confirm`)
      .set(authHeader(context.adminToken))
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
      .set(authHeader(context.adminToken))
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
      .set(authHeader(context.adminToken))
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
      .set(authHeader(context.adminToken))
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

    expect(
      await prisma.delivery.count({ where: { orderId: order.id } }),
    ).toBe(0);
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

  it('P0-B denies supplier-order DELIVERED when client order is UNPAID', async () => {
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

    const response = await request(server)
      .patch(`/supplier-orders/${supplierOrder.id}/status`)
      .set(authHeader(context.managerToken))
      .send({ status: SupplierOrderStatus.DELIVERED })
      .expect(409);

    expect(response.body).toEqual(
      expect.objectContaining({
        message: SHIPMENT_PAYMENT_NOT_CONFIRMED_MESSAGE,
      }),
    );

    const unchanged = await prisma.supplierOrder.findUniqueOrThrow({
      where: { id: supplierOrder.id },
    });
    expect(unchanged.status).toBe(SupplierOrderStatus.DRAFT);
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
      .set(authHeader(context.headToken))
      .send({
        items: [{ itemId: receipt.items[0].id, receivedQuantity: 10 }],
      })
      .expect(201);

    const balanceAfter = await prisma.stockBalance.findUniqueOrThrow({
      where: { productId: context.productId },
    });
    expect(balanceAfter.onHand).toBeGreaterThan(balanceBefore.onHand);
    expect(
      await prisma.delivery.count({ where: { orderId: order.id } }),
    ).toBe(0);
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

    const payload = deliveryPayload(
      order.id,
      orderItem.id,
      orderItem.quantity,
    );
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
      .set(authHeader(context.adminToken))
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

    expect(
      await prisma.delivery.count({ where: { orderId: order.id } }),
    ).toBe(0);
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
      .set(authHeader(context.adminToken))
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
      .set(authHeader(context.adminToken))
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
      .set(authHeader(context.adminToken))
      .send({ status: PaymentRecordStatus.CONFIRMED })
      .expect(200);

    // Повторный confirm уже обработанного платежа → 409
    await request(server)
      .patch(`/orders/payments/${payment.id}/confirm`)
      .set(authHeader(context.adminToken))
      .send({ status: PaymentRecordStatus.CONFIRMED })
      .expect(409);

    // CONFIRMED → REJECTED задним числом запрещён → 409
    await request(server)
      .patch(`/orders/payments/${payment.id}/confirm`)
      .set(authHeader(context.adminToken))
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
    const assignedMetadata = await prisma.telegramLeadMetadata.findUniqueOrThrow(
      { where: { leadId: lead.id } },
    );
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

    const updated = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
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

    expect(bodyAs<unknown[]>(types)).toHaveLength(3);
    expect(bodyAs<unknown[]>(sizes)).toHaveLength(20);
    const pricingBody = bodyAs<
      Array<{ currencyCode: string; basePricePerM2?: string }>
    >(pricing);
    expect(pricingBody.every((item) => item.currencyCode === 'CNY')).toBe(true);
    expect(
      pricingBody.every((item) => item.basePricePerM2 === undefined),
    ).toBe(true);
  });

  it('PR-4 filters supplier quality classes by panel type', async () => {
    const response = await request(server)
      .get('/suppliers/wuya/quality-classes')
      .query({ panelType: 'exterior' })
      .set(authHeader(context.managerToken))
      .expect(200);

    const mappings = bodyAs<Array<{ qualityClass: { code: string } }>>(response);
    expect(mappings).toHaveLength(1);
    expect(mappings[0]?.qualityClass.code).toBe('economy');
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

    await request(server)
      .post('/panel-colors')
      .send(colorPayload)
      .expect(401);

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

  it('P1 creates, reads, updates, finalizes and deletes calculations', async () => {
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

    const panelType = await prisma.panelType.findFirstOrThrow({
      where: { code: 'exterior' },
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
    };

    const created = await request(server)
      .post('/calculations')
      .set(authHeader(context.managerToken))
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
    expect(calculation.items[0]?.supplierPricePerM2).toBeUndefined();
    expect(new Prisma.Decimal(calculation.items[0]?.clientPricePerM2).toString()).toBe(
      '20',
    );
    expect(new Prisma.Decimal(calculation.items[0]?.pricePerM2).toString()).toBe(
      '20',
    );

    const fetched = await request(server)
      .get(`/calculations/${calculation.id}`)
      .set(authHeader(context.managerToken))
      .expect(200);

    expect(bodyAs<{ id: string }>(fetched).id).toBe(calculation.id);

    const updated = await request(server)
      .patch(`/calculations/${calculation.id}`)
      .set(authHeader(context.managerToken))
      .send({
        notes: 'Updated draft',
        items: [{ ...itemPayload, requiredAreaM2: '20.00' }],
      })
      .expect(200);

    expect(bodyAs<{ notes: string }>(updated).notes).toBe('Updated draft');

    await request(server)
      .post(`/calculations/${calculation.id}/finalize`)
      .set(authHeader(context.managerToken))
      .expect(201);

    await request(server)
      .patch(`/calculations/${calculation.id}`)
      .set(authHeader(context.managerToken))
      .send({ notes: 'Should fail' })
      .expect(409);

    await request(server)
      .delete(`/calculations/${calculation.id}`)
      .set(authHeader(context.managerToken))
      .expect(200);

    await request(server)
      .get(`/calculations/${calculation.id}`)
      .set(authHeader(context.managerToken))
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

    expect(workspaceBody.catalog.panelTypes.length).toBe(3);
    expect(workspaceBody.catalog.panelSizes.length).toBe(20);
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

  it('P2 converts finalized calculation to quote and deal', async () => {
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

    const panelType = await prisma.panelType.findFirstOrThrow({
      where: { code: 'exterior' },
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
    };

    const calculation = await request(server)
      .post('/calculations')
      .set(authHeader(context.managerToken))
      .send({ leadId, items: [itemPayload] })
      .expect(201);

    const calculationId = bodyAs<EntityResponse>(calculation).id;

    await request(server)
      .post(`/calculations/${calculationId}/finalize`)
      .set(authHeader(context.managerToken))
      .expect(201);

    const quoteResponse = await request(server)
      .post(`/calculations/${calculationId}/convert-to-quote`)
      .set(authHeader(context.managerToken))
      .send({ clientComment: 'Срок поставки 14 дней' })
      .expect(201);

    const quote = bodyAs<{
      id: string;
      status: string;
      items: Array<{ panelTypeCode: string; totalPrice: string }>;
    }>(quoteResponse);

    expect(quote.status).toBe('draft');
    expect(quote.items[0]?.panelTypeCode).toBe('exterior');

    await request(server)
      .patch(`/quotes/${quote.id}/status`)
      .set(authHeader(context.managerToken))
      .send({ status: 'approved' })
      .expect(409);

    await request(server)
      .patch(`/quotes/${quote.id}/status`)
      .set(authHeader(context.managerToken))
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
      .set(authHeader(context.managerToken))
      .expect(201);

    const conversionBody = bodyAs<{ dealId: string; quote: { status: string } }>(
      conversion,
    );

    expect(conversionBody.quote.status).toBe('converted');
    expect(conversionBody.dealId).toBeTruthy();

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
      .set(authHeader(context.managerToken))
      .expect(409);

    const quote = await prisma.panelQuote.findUniqueOrThrow({
      where: { id: quoteId },
      select: { dealId: true, status: true },
    });
    expect(quote.dealId).toBeNull();
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
      where: { code: 'exterior' },
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
        .set(authHeader(context.managerToken))
        .send({
          panelTypeId,
          panelSizeId: panelSize.id,
          thicknessMm: 10,
          supplierId,
          qualityClassId,
          requiredAreaM2: '2.9768',
        });

    await preview(tianran.id, interior.id, economy.id).expect(201);
    await preview(tianran.id, exterior.id, economy.id).expect(400);
    await preview(tianran.id, exterior.id, medium.id).expect(201);
    await preview(tianran.id, exterior.id, premium.id).expect(201);
    await preview(wuya.id, exterior.id, economy.id).expect(201);
    await preview(wuya.id, exterior.id, premium.id).expect(400);
    await preview(polybet.id, exterior.id, premium.id).expect(201);
    await preview(polybet.id, exterior.id, economy.id).expect(400);

    await request(server)
      .post('/calculations')
      .set(authHeader(context.managerToken))
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
          },
        ],
      })
      .expect(400);
  });

  it('ignores manager-injected supplier price, rate and coefficient', async () => {
    const panelType = await prisma.panelType.findFirstOrThrow({
      where: { code: 'exterior' },
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
      .expect(201);

    const body = bodyAs<{ clientPricePerM2: string; total: string }>(preview);
    expect(new Prisma.Decimal(body.clientPricePerM2).toString()).toBe('20');
  });

  it('forbids Manager from managing CurrencyRate', async () => {
    await request(server)
      .post('/currency-rates')
      .set(authHeader(context.managerToken))
      .send({ rate: '0.2' })
      .expect(403);

    await request(server)
      .get('/currency-rates/current')
      .set(authHeader(context.managerToken))
      .expect(403);
  });

  it('allows Head to set and read the CNY→USD rate', async () => {
    const created = await request(server)
      .post('/currency-rates')
      .set(authHeader(context.headToken))
      .send({ rate: '0.11' })
      .expect(201);

    expect(bodyAs<{ rate: string }>(created).rate).toBeDefined();

    const current = await request(server)
      .get('/currency-rates/current')
      .set(authHeader(context.headToken))
      .expect(200);

    expect(new Prisma.Decimal(bodyAs<{ rate: string }>(current).rate).toString()).toBe(
      '0.11',
    );

    await request(server)
      .post('/currency-rates')
      .set(authHeader(context.headToken))
      .send({ rate: '0.1' })
      .expect(201);
  });

  it('converts one quote concurrently into exactly one deal', async () => {
    const quoteId = await createApprovedPanelQuote();
    const quote = await prisma.panelQuote.findUniqueOrThrow({
      where: { id: quoteId },
      select: { leadId: true },
    });

    const [first, second] = await Promise.all([
      request(server)
        .post(`/quotes/${quoteId}/convert-to-deal`)
        .set(authHeader(context.managerToken)),
      request(server)
        .post(`/quotes/${quoteId}/convert-to-deal`)
        .set(authHeader(context.managerToken)),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);

    const winner = first.status === 201 ? first : second;
    const loser = first.status === 201 ? second : first;
    const winnerBody = bodyAs<{ dealId: string }>(winner);
    const loserBody = bodyAs<{ errorCode?: string }>(loser);

    expect(winnerBody.dealId).toBeTruthy();
    expect(
      loserBody.errorCode === 'QUOTE_ALREADY_CONVERTED' ||
        loserBody.errorCode === 'LEAD_ALREADY_CONVERTED',
    ).toBe(true);

    const deals = await prisma.deal.findMany({
      where: { title: `КП #${quoteId.slice(0, 8)}` },
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
    expect(convertedQuote.dealId).toBe(winnerBody.dealId);
  });

  it('keeps one Lead → one Deal across qualify and quote convert', async () => {
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
          estimatedAmount: 125000,
          targetDate: futureIso(20),
          decisionMakerContact: 'Chief architect',
        }),
      request(server)
        .post(`/quotes/${quoteId}/convert-to-deal`)
        .set(authHeader(context.managerToken)),
    ]);

    const successStatuses = [qualify.status, convert.status].filter(
      (status) => status === 201,
    );
    expect(successStatuses).toHaveLength(1);
    expect([qualify.status, convert.status]).toContain(409);

    const lead = await prisma.lead.findUniqueOrThrow({
      where: { id: quote.leadId },
    });
    expect(lead.dealId).toBeTruthy();

    const quoteDeals = await prisma.deal.findMany({
      where: { title: `КП #${quoteId.slice(0, 8)}` },
    });
    const relatedDealIds = new Set(
      [lead.dealId, ...quoteDeals.map((deal) => deal.id)].filter(
        (id): id is string => Boolean(id),
      ),
    );
    expect(relatedDealIds.size).toBe(1);
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

  async function createApprovedPanelQuote(): Promise<string> {
    const quoteId = await createSentPanelQuote();

    await request(server)
      .patch(`/quotes/${quoteId}/status`)
      .set(authHeader(context.headToken))
      .send({ status: 'approved' })
      .expect(200);

    return quoteId;
  }

  async function createSentPanelQuote(): Promise<string> {
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

    const panelType = await prisma.panelType.findFirstOrThrow({
      where: { code: 'exterior' },
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

    const calculation = await request(server)
      .post('/calculations')
      .set(authHeader(context.managerToken))
      .send({
        leadId,
        items: [
          {
            panelTypeId: panelType.id,
            panelSizeId: panelSize.id,
            thicknessMm: 10,
            supplierId: supplier.id,
            qualityClassId: qualityClass.id,
            requiredAreaM2: '15.50',
          },
        ],
      })
      .expect(201);

    const calculationId = bodyAs<EntityResponse>(calculation).id;

    await request(server)
      .post(`/calculations/${calculationId}/finalize`)
      .set(authHeader(context.managerToken))
      .expect(201);

    const quoteResponse = await request(server)
      .post(`/calculations/${calculationId}/convert-to-quote`)
      .set(authHeader(context.managerToken))
      .send({ clientComment: 'E2E sent quote' })
      .expect(201);

    const quoteId = bodyAs<EntityResponse>(quoteResponse).id;

    await request(server)
      .patch(`/quotes/${quoteId}/status`)
      .set(authHeader(context.managerToken))
      .send({ status: 'sent' })
      .expect(200);

    return quoteId;
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
      .set(authHeader(context.adminToken))
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

  const { apiKeyToken, apiKeyLimitedToken } =
    await seedServiceAccountsForE2e(prisma);

  await seedPanels(prisma);
  await seedFixtureCnyUsdRate(prisma, admin.id);
  await seedCalculatorProduct(prisma);

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
    roleName: RoleName.OBSERVER,
  });
  await upsertUser(prisma, {
    email: 'system@hpl.com',
    firstName: 'System',
    lastName: 'Bot',
    passwordHash,
    roleName: RoleName.OBSERVER,
  });
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
    permissionSlugs.filter((slug) => slug !== 'payments:confirm'),
  );
  await assignRolePermissions(prisma, roleIds, RoleName.MANAGER, [
    'auth:me',
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
    'orders:cancel',
    'payments:create',
    'deliveries:create',
    'files:upload',
    'files:read',
    'audit:read',
    'panel_catalog:read',
    'calculations:read',
    'calculations:create',
    'calculations:update',
    'calculations:delete',
    'quotes:read',
    'quotes:create',
    'quotes:update',
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

function hashApiKeyToken(token: string, pepper: string): string {
  return createHash('sha256').update(token + pepper).digest('hex');
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

function getFromMap<T>(map: Map<string, T>, key: string): T {
  const value = map.get(key);

  if (!value) {
    throw new Error(`Missing test fixture: ${key}`);
  }

  return value;
}
