import 'dotenv/config';
import {
  ClientSegment,
  ClientStatus,
  ClientType,
  DealStage,
  LeadStatus,
  OrderStatus,
  PaymentRecordStatus,
  PaymentStatus,
  Prisma,
  PrismaClient,
  ProductPriceType,
  ProductStatus,
  RoleName,
  StockReservationStatus,
  TaskPriority,
  TaskStatus,
  TaskType,
} from '@prisma/client';
import { hash } from 'bcryptjs';
import { seedServiceAccounts } from './seed/service-accounts';
import { seedPanels, seedFixtureCnyUsdRate } from './seed/panels';
import { seedCalculatorProduct } from './seed/calculator-product';
import { synchronizeRbac } from '../src/auth/rbac/synchronize-rbac';

let prisma: PrismaClient;

const PASSWORD = 'Password123!';
const PASSWORD_HASH_ROUNDS = 12;
const SHEET_LENGTH = 3050;
const SHEET_WIDTH = 1300;
const SHEET_AREA = (SHEET_LENGTH * SHEET_WIDTH) / 1_000_000;

async function createPrismaClient(): Promise<PrismaClient> {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error('DATABASE_URL is required for seed');
  }

  if (
    connectionString.startsWith('postgres') ||
    connectionString.startsWith('prisma+postgres')
  ) {
    const { PrismaPg } = await import('@prisma/adapter-pg');
    return new PrismaClient({
      adapter: new PrismaPg({
        connectionString: resolvePgConnectionString(connectionString),
      }),
    });
  }

  throw new Error(
    'P0 requires PostgreSQL. Set DATABASE_URL to a postgresql:// connection string.',
  );
}

function resolvePgConnectionString(connectionString: string): string {
  const parsedUrl = new URL(connectionString);

  if (parsedUrl.protocol !== 'prisma+postgres:') {
    return connectionString;
  }

  const apiKey = parsedUrl.searchParams.get('api_key');

  if (!apiKey) {
    throw new Error('Prisma Postgres api_key is missing databaseUrl');
  }

  const decoded = Buffer.from(apiKey, 'base64url').toString('utf8');
  const payload: unknown = JSON.parse(decoded);

  if (
    typeof payload !== 'object' ||
    payload === null ||
    !('databaseUrl' in payload)
  ) {
    throw new Error('Prisma Postgres api_key payload is invalid');
  }

  const databaseUrl = payload.databaseUrl;

  if (typeof databaseUrl !== 'string') {
    throw new Error('Prisma Postgres api_key databaseUrl is invalid');
  }

  return databaseUrl;
}

const suppliers = [
  {
    code: 'SLOTEX',
    name: 'Slotex HPL Supply',
    contacts: { phone: '+7 (495) 221-45-80', email: 'sales@slotex.ru' },
  },
  {
    code: 'ARPA',
    name: 'Arpa Industriale',
    contacts: { phone: '+39 0522 635 111', email: 'export@arpa.it' },
  },
  {
    code: 'FUNDERMAX',
    name: 'Fundermax',
    contacts: { phone: '+43 7672 701 0', email: 'info@fundermax.at' },
  },
];

const brands = [
  { code: 'HPLPRO', name: 'HPL Pro' },
  { code: 'ARCHSKIN', name: 'Arch Skin' },
  { code: 'MAXCOMPACT', name: 'Max Compact' },
];

const collections = [
  { brandCode: 'HPLPRO', name: 'Solid Colors' },
  { brandCode: 'HPLPRO', name: 'Woodline' },
  { brandCode: 'ARCHSKIN', name: 'Stone' },
  { brandCode: 'MAXCOMPACT', name: 'Exterior' },
];

const products = [
  {
    sku: 'HPL-SOL-WHITE-12',
    name: 'HPL Solid White 12 мм',
    brandCode: 'HPLPRO',
    collectionName: 'Solid Colors',
    supplierCode: 'SLOTEX',
    decorCode: 'SW-100',
    colorName: 'Белый',
    surface: 'Матовая',
    base: 4200,
    purchase: 2850,
    wholesale: 3900,
    retail: 4600,
    stock: 120,
  },
  {
    sku: 'HPL-SOL-GRAPHITE-12',
    name: 'HPL Solid Graphite 12 мм',
    brandCode: 'HPLPRO',
    collectionName: 'Solid Colors',
    supplierCode: 'SLOTEX',
    decorCode: 'SG-210',
    colorName: 'Графит',
    surface: 'Soft Touch',
    base: 4700,
    purchase: 3200,
    wholesale: 4350,
    retail: 5200,
    stock: 85,
  },
  {
    sku: 'HPL-WOOD-OAK-12',
    name: 'HPL Woodline Natural Oak 12 мм',
    brandCode: 'HPLPRO',
    collectionName: 'Woodline',
    supplierCode: 'ARPA',
    decorCode: 'WO-310',
    colorName: 'Натуральный дуб',
    surface: 'Древесная текстура',
    base: 5300,
    purchase: 3650,
    wholesale: 4900,
    retail: 5900,
    stock: 64,
  },
  {
    sku: 'HPL-STONE-GREY-12',
    name: 'HPL Stone Grey 12 мм',
    brandCode: 'ARCHSKIN',
    collectionName: 'Stone',
    supplierCode: 'ARPA',
    decorCode: 'ST-420',
    colorName: 'Серый камень',
    surface: 'Текстурная',
    base: 6100,
    purchase: 4300,
    wholesale: 5650,
    retail: 6900,
    stock: 42,
  },
  {
    sku: 'HPL-EXT-ANTHRACITE-12',
    name: 'Max Compact Anthracite 12 мм',
    brandCode: 'MAXCOMPACT',
    collectionName: 'Exterior',
    supplierCode: 'FUNDERMAX',
    decorCode: 'EC-550',
    colorName: 'Антрацит',
    surface: 'Фасадная',
    base: 7800,
    purchase: 5400,
    wholesale: 7200,
    retail: 8900,
    stock: 28,
  },
];

async function clearDatabase(): Promise<void> {
  await prisma.currencyRate.deleteMany();
  await prisma.calculationLineItem.deleteMany();
  await prisma.panelQuoteItem.deleteMany();
  await prisma.panelQuote.deleteMany();
  await prisma.calculationSession.deleteMany();
  await prisma.calculationLineItem.deleteMany(); // повторное — на случай каскадных остатков
  await prisma.telegramLeadMetadata.deleteMany();
  await prisma.inboundWebhookEvent.deleteMany();
  await prisma.serviceAccount.deleteMany();
  await prisma.deliveryItem.deleteMany();
  await prisma.delivery.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.stockReservation.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.supplierOrder.deleteMany();
  await prisma.dealItem.deleteMany();
  await prisma.dealOffer.deleteMany();
  await prisma.dealStageHistory.deleteMany();
  await prisma.deal.deleteMany();
  await prisma.leadAssignmentHistory.deleteMany();
  await prisma.lead.deleteMany();
  await prisma.activity.deleteMany();
  await prisma.taskRescheduleHistory.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.task.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.userActivityLog.deleteMany();
  await prisma.session.deleteMany();
  await prisma.panelColor.deleteMany();
  await prisma.panelThicknessPricing.deleteMany();
  await prisma.supplierQualityMapping.deleteMany();
  await prisma.panelSize.deleteMany();
  await prisma.panelType.deleteMany();
  await prisma.qualityClass.deleteMany();
  await prisma.stockAdjustment.deleteMany();
  await prisma.stockBalance.deleteMany();
  await prisma.expectedReceiptItem.deleteMany();
  await prisma.expectedReceipt.deleteMany();
  await prisma.productPrice.deleteMany();
  await prisma.projectObject.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.client.deleteMany();
  await prisma.product.deleteMany();
  await prisma.productCollection.deleteMany();
  await prisma.brand.deleteMany();
  await prisma.supplier.deleteMany();
  await prisma.file.deleteMany();
  await prisma.salesPlan.deleteMany();
  await prisma.leadPlan.deleteMany();
  await prisma.kpiSetting.deleteMany();
  await prisma.userPermission.deleteMany();
  await prisma.userRole.deleteMany();
  await prisma.rolePermission.deleteMany();
  await prisma.team.updateMany({ data: { leaderId: null } });
  await prisma.user.updateMany({ data: { managerId: null, teamId: null } });
  await prisma.user.deleteMany();
  await prisma.team.deleteMany();
  await prisma.role.deleteMany();
  await prisma.permission.deleteMany();
}

async function seedRolesAndPermissions(): Promise<Map<RoleName, { id: string }>> {
  return synchronizeRbac(prisma);
}

async function createUser(input: {
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  passwordHash: string;
  roleId?: string;
  teamId?: string;
  managerId?: string;
}): Promise<{ id: string }> {
  const user = await prisma.user.create({
    data: {
      email: input.email,
      passwordHash: input.passwordHash,
      firstName: input.firstName,
      lastName: input.lastName,
      phone: input.phone,
      isActive: true,
      teamId: input.teamId,
      managerId: input.managerId,
      ...(input.roleId
        ? {
            roles: {
              create: { roleId: input.roleId },
            },
          }
        : {}),
    },
    select: { id: true },
  });

  return user;
}

function daysFromNow(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(12, 0, 0, 0);
  return date;
}

function daysAgo(days: number): Date {
  return daysFromNow(-days);
}

function calcDealItem(
  productId: string,
  quantitySheets: number,
  unitPrice: number,
  purchasePrice: number,
  discount = 0,
) {
  const quantityM2 = SHEET_AREA * quantitySheets;
  const totalPrice = quantityM2 * unitPrice - discount;
  const purchaseCost = quantityM2 * purchasePrice;

  return {
    productId,
    quantitySheets,
    quantityM2,
    unitPrice: new Prisma.Decimal(unitPrice),
    discount: new Prisma.Decimal(discount),
    totalPrice: new Prisma.Decimal(totalPrice),
    purchasePriceSnapshot: new Prisma.Decimal(purchasePrice),
    purchaseCost,
    totalPriceNumber: totalPrice,
  };
}

async function main(): Promise<void> {
  const isProduction = process.env.NODE_ENV === 'production';

  if (!isProduction) {
    console.log('Очистка базы данных...');
    await clearDatabase();
  }

  const roles = await seedRolesAndPermissions();

  if (!isProduction) {
  const passwordHash = await hash(PASSWORD, PASSWORD_HASH_ROUNDS);

  const salesTeam = await prisma.team.create({
    data: { name: 'Отдел продаж HPL' },
  });

  const admin = await createUser({
    email: 'admin@hpl.com',
    firstName: 'Алексей',
    lastName: 'Смирнов',
    phone: '+7 (495) 100-00-01',
    passwordHash,
    roleId: roles.get(RoleName.ADMIN)!.id,
  });

  const noLoginPasswordHash = await hash(
    `no-login-${Date.now()}-${Math.random()}`,
    PASSWORD_HASH_ROUNDS,
  );

  const leadPoolUser = await createUser({
    email: 'lead-pool@hpl.com',
    firstName: 'Lead',
    lastName: 'Pool',
    phone: '+7 (000) 000-00-00',
    passwordHash: noLoginPasswordHash,
  });

  const systemUser = await createUser({
    email: 'system@hpl.com',
    firstName: 'System',
    lastName: 'Bot',
    phone: '+7 (000) 000-00-01',
    passwordHash: noLoginPasswordHash,
  });

  const head = await createUser({
    email: 'head@hpl.com',
    firstName: 'Дмитрий',
    lastName: 'Волков',
    phone: '+7 (495) 100-00-02',
    passwordHash,
    roleId: roles.get(RoleName.HEAD)!.id,
    teamId: salesTeam.id,
  });

  await prisma.team.update({
    where: { id: salesTeam.id },
    data: { leaderId: head.id },
  });

  const managerElena = await createUser({
    email: 'manager1@hpl.com',
    firstName: 'Елена',
    lastName: 'Козлова',
    phone: '+7 (495) 100-00-03',
    passwordHash,
    roleId: roles.get(RoleName.MANAGER)!.id,
    teamId: salesTeam.id,
    managerId: head.id,
  });

  const managerIgor = await createUser({
    email: 'manager2@hpl.com',
    firstName: 'Игорь',
    lastName: 'Петров',
    phone: '+7 (495) 100-00-04',
    passwordHash,
    roleId: roles.get(RoleName.MANAGER)!.id,
    teamId: salesTeam.id,
    managerId: head.id,
  });

  await createUser({
    email: 'storekeeper@hpl.com',
    firstName: 'Сергей',
    lastName: 'Орлов',
    phone: '+7 (495) 100-00-05',
    passwordHash,
    roleId: roles.get(RoleName.STOREKEEPER)!.id,
  });

  await createUser({
    email: 'director@hpl.com',
    firstName: 'Ирина',
    lastName: 'Лебедева',
    phone: '+7 (495) 100-00-06',
    passwordHash,
    roleId: roles.get(RoleName.DIRECTOR)!.id,
  });

  await createUser({
    email: 'accountant@hpl.com',
    firstName: 'Ольга',
    lastName: 'Новикова',
    phone: '+7 (495) 100-00-07',
    passwordHash,
    roleId: roles.get(RoleName.ACCOUNTANT)!.id,
  });

  await createUser({
    email: 'installer@hpl.com',
    firstName: 'Павел',
    lastName: 'Кузнецов',
    phone: '+7 (495) 100-00-08',
    passwordHash,
    roleId: roles.get(RoleName.INSTALLER)!.id,
  });

  const supplierByCode = new Map<string, { id: string }>();
  for (const supplierSeed of suppliers) {
    const supplier = await prisma.supplier.create({
      data: {
        code: supplierSeed.code,
        name: supplierSeed.name,
        contacts: supplierSeed.contacts,
      },
      select: { id: true },
    });
    supplierByCode.set(supplierSeed.code, supplier);
  }

  const brandByCode = new Map<string, { id: string }>();
  for (const brandSeed of brands) {
    const brand = await prisma.brand.create({
      data: brandSeed,
      select: { id: true },
    });
    brandByCode.set(brandSeed.code, brand);
  }

  const collectionByKey = new Map<string, { id: string }>();
  for (const collectionSeed of collections) {
    const brand = brandByCode.get(collectionSeed.brandCode)!;
    const collection = await prisma.productCollection.create({
      data: {
        brandId: brand.id,
        name: collectionSeed.name,
      },
      select: { id: true },
    });
    collectionByKey.set(
      `${collectionSeed.brandCode}:${collectionSeed.name}`,
      collection,
    );
  }

  const productBySku = new Map<
    string,
    { id: string; purchase: number; retail: number }
  >();

  const priceValidFrom = daysAgo(30);

  for (const productSeed of products) {
    const brand = brandByCode.get(productSeed.brandCode)!;
    const supplier = supplierByCode.get(productSeed.supplierCode)!;
    const collection = collectionByKey.get(
      `${productSeed.brandCode}:${productSeed.collectionName}`,
    )!;

    const product = await prisma.product.create({
      data: {
        sku: productSeed.sku,
        name: productSeed.name,
        brandId: brand.id,
        collectionId: collection.id,
        supplierId: supplier.id,
        decorCode: productSeed.decorCode,
        colorName: productSeed.colorName,
        surface: productSeed.surface,
        thickness: 12,
        length: SHEET_LENGTH,
        width: SHEET_WIDTH,
        unit: 'm2',
        sheetArea: SHEET_AREA,
        status: ProductStatus.ACTIVE,
        prices: {
          create: [
            {
              type: ProductPriceType.BASE,
              amount: productSeed.base,
              validFrom: priceValidFrom,
            },
            {
              type: ProductPriceType.PURCHASE,
              amount: productSeed.purchase,
              validFrom: priceValidFrom,
            },
            {
              type: ProductPriceType.WHOLESALE,
              amount: productSeed.wholesale,
              validFrom: priceValidFrom,
            },
            {
              type: ProductPriceType.RETAIL,
              amount: productSeed.retail,
              validFrom: priceValidFrom,
            },
          ],
        },
        stockBalance: {
          create: {
            onHand: productSeed.stock,
            reserved: 0,
            available: productSeed.stock,
          },
        },
      },
      select: { id: true },
    });

    productBySku.set(productSeed.sku, {
      id: product.id,
      purchase: productSeed.purchase,
      retail: productSeed.retail,
    });
  }

  const graphite = productBySku.get('HPL-SOL-GRAPHITE-12')!;
  const oak = productBySku.get('HPL-WOOD-OAK-12')!;
  const stone = productBySku.get('HPL-STONE-GREY-12')!;
  const white = productBySku.get('HPL-SOL-WHITE-12')!;
  const anthracite = productBySku.get('HPL-EXT-ANTHRACITE-12')!;

  const clientStroyMontazh = await prisma.client.create({
    data: {
      type: ClientType.COMPANY,
      name: 'ООО «СтройМонтаж Плюс»',
      inn: '7705123456',
      phone: '+7 (495) 755-12-34',
      email: 'zakupki@stroymontazh-plus.ru',
      status: ClientStatus.ACTIVE,
      segment: ClientSegment.CONTRACTOR,
      region: 'Москва',
      address: 'г. Москва, ул. Профсоюзная, д. 56',
      source: 'Рекомендация партнёра',
      comment: 'Генподрядчик, специализация — бизнес-центры класса А',
      ownerId: managerElena.id,
      contacts: {
        create: [
          {
            firstName: 'Андрей',
            lastName: 'Крылов',
            position: 'Директор по закупкам',
            phone: '+7 (916) 200-45-67',
            email: 'krylov@stroymontazh-plus.ru',
            isPrimary: true,
          },
          {
            firstName: 'Марина',
            lastName: 'Белова',
            position: 'Инженер ПТО',
            phone: '+7 (916) 200-45-68',
            email: 'belova@stroymontazh-plus.ru',
          },
        ],
      },
    },
    include: { contacts: true },
  });

  const clientMosProekt = await prisma.client.create({
    data: {
      type: ClientType.COMPANY,
      name: 'АО «МосПроектСтрой»',
      inn: '7701987654',
      phone: '+7 (495) 620-88-90',
      email: 'tender@mosproektstroy.ru',
      status: ClientStatus.ACTIVE,
      segment: ClientSegment.CONTRACTOR,
      region: 'Московская область',
      address: 'г. Химки, Ленинградское ш., д. 39',
      source: 'Тендерная площадка',
      ownerId: managerIgor.id,
      contacts: {
        create: {
          firstName: 'Виктор',
          lastName: 'Назаров',
          position: 'Руководитель отдела снабжения',
          phone: '+7 (903) 111-22-33',
          email: 'nazarov@mosproektstroy.ru',
          isPrimary: true,
        },
      },
    },
    include: { contacts: true },
  });

  const clientSokolova = await prisma.client.create({
    data: {
      type: ClientType.INDIVIDUAL,
      name: 'ИП Соколова Анна Владимировна',
      inn: '772512345678',
      phone: '+7 (926) 555-77-88',
      email: 'anna.sokolova@design.ru',
      status: ClientStatus.ACTIVE,
      segment: ClientSegment.ARCHITECT,
      region: 'Москва',
      source: 'Выставка MosBuild',
      ownerId: managerElena.id,
      contacts: {
        create: {
          firstName: 'Анна',
          lastName: 'Соколова',
          position: 'Архитектор-дизайнер',
          phone: '+7 (926) 555-77-88',
          email: 'anna.sokolova@design.ru',
          isPrimary: true,
        },
      },
    },
    include: { contacts: true },
  });

  const clientDekorFasad = await prisma.client.create({
    data: {
      type: ClientType.COMPANY,
      name: 'ООО «ДекорФасад»',
      inn: '5029123456',
      phone: '+7 (495) 380-44-55',
      email: 'office@dekorfasad.ru',
      status: ClientStatus.ACTIVE,
      segment: ClientSegment.DEALER,
      region: 'Московская область',
      address: 'г. Мытищи, ул. Коммунистическая, д. 12',
      source: 'Холодный обзвон',
      ownerId: managerIgor.id,
      contacts: {
        create: {
          firstName: 'Роман',
          lastName: 'Ефимов',
          position: 'Коммерческий директор',
          phone: '+7 (903) 444-55-66',
          email: 'efimov@dekorfasad.ru',
          isPrimary: true,
        },
      },
    },
    include: { contacts: true },
  });

  const clientBcDev = await prisma.client.create({
    data: {
      type: ClientType.COMPANY,
      name: 'ООО «БизнесЦентр Девелопмент»',
      inn: '7703456789',
      phone: '+7 (495) 900-11-22',
      email: 'procurement@bc-development.ru',
      status: ClientStatus.ACTIVE,
      segment: ClientSegment.END_CUSTOMER,
      region: 'Москва',
      address: 'г. Москва, Пресненская наб., д. 10',
      source: 'Сайт компании',
      ownerId: head.id,
      contacts: {
        create: {
          firstName: 'Ольга',
          lastName: 'Морозова',
          position: 'Директор по развитию',
          phone: '+7 (985) 300-40-50',
          email: 'morozova@bc-development.ru',
          isPrimary: true,
        },
      },
    },
    include: { contacts: true },
  });

  const projectBcVolga = await prisma.projectObject.create({
    data: {
      clientId: clientStroyMontazh.id,
      name: 'Бизнес-центр «Волга Плаза»',
      address: 'г. Москва, ул. Волгоградский проспект, вл. 32',
      type: 'Бизнес-центр',
      stage: 'Отделка лобби и МОП',
      approximateArea: 4200,
      expectedDate: daysFromNow(90),
      description:
        'Комплектация лифтовых холлов, ресепшн и коридоров офисных этажей панелями HPL 12 мм',
      decisionMakerContactId: clientStroyMontazh.contacts[0].id,
    },
  });

  const projectZhKSever = await prisma.projectObject.create({
    data: {
      clientId: clientMosProekt.id,
      name: 'ЖК «Северная Долина»',
      address: 'Московская обл., г.о. Химки, мкр. Северный',
      type: 'Жилой комплекс',
      stage: 'Монтаж входных групп',
      approximateArea: 12800,
      expectedDate: daysFromNow(120),
      description:
        'Облицовка входных групп, колясочных и технических помещений на 4 корпуса',
      decisionMakerContactId: clientMosProekt.contacts[0].id,
    },
  });

  const projectTcGalereya = await prisma.projectObject.create({
    data: {
      clientId: clientBcDev.id,
      name: 'Реконструкция ТЦ «Галерея»',
      address: 'г. Москва, Кутузовский проспект, д. 48',
      type: 'Торговый центр',
      stage: 'Проектирование',
      approximateArea: 2800,
      expectedDate: daysFromNow(60),
      description: 'Обновление навигации, стоек ресепшн и зон фуд-корта',
      decisionMakerContactId: clientBcDev.contacts[0].id,
    },
  });

  const projectShowroom = await prisma.projectObject.create({
    data: {
      clientId: clientSokolova.id,
      name: 'Шоурум дизайн-студии «Линия»',
      address: 'г. Москва, Большая Ордынка, д. 17',
      type: 'Коммерческий интерьер',
      stage: 'Подбор материалов',
      approximateArea: 180,
      expectedDate: daysFromNow(45),
      decisionMakerContactId: clientSokolova.contacts[0].id,
    },
  });

  await prisma.lead.createMany({
    data: [
      {
        title: 'Запрос на HPL для лобби БЦ «Волга Плаза»',
        status: LeadStatus.CONVERTED,
        source: 'Рекомендация партнёра',
        ownerId: managerElena.id,
        clientId: clientStroyMontazh.id,
        contactId: clientStroyMontazh.contacts[0].id,
        projectObjectId: projectBcVolga.id,
        needDescription:
          'Подбор декоров для лобби и МОП, требуется образец и расчёт на 4 200 м²',
        estimatedAmount: new Prisma.Decimal(4_250_000),
        targetDate: daysFromNow(75),
        decisionMakerContact: 'Андрей Крылов',
      },
      {
        title: 'ЖК «Северная Долина» — входные группы',
        status: LeadStatus.QUALIFIED,
        source: 'Тендерная площадка',
        ownerId: managerIgor.id,
        clientId: clientMosProekt.id,
        contactId: clientMosProekt.contacts[0].id,
        projectObjectId: projectZhKSever.id,
        needDescription:
          'Коммерческое предложение на HPL для 4 корпусов, срок поставки — Q3',
        estimatedAmount: new Prisma.Decimal(8_700_000),
        targetDate: daysFromNow(100),
        decisionMakerContact: 'Виктор Назаров',
      },
      {
        title: 'Фасады торгового павильона — ДекорФасад',
        status: LeadStatus.IN_PROGRESS,
        source: 'Холодный обзвон',
        ownerId: managerIgor.id,
        clientId: clientDekorFasad.id,
        contactId: clientDekorFasad.contacts[0].id,
        needDescription:
          'Переговоры по дилерской скидке и срокам поставки фасадного HPL',
        estimatedAmount: new Prisma.Decimal(1_850_000),
        targetDate: daysFromNow(30),
        decisionMakerContact: 'Роман Ефимов',
      },
      {
        title: 'Шоурум на Ордынке — подбор декоров',
        status: LeadStatus.NEW,
        source: 'Выставка MosBuild',
        ownerId: managerElena.id,
        clientId: clientSokolova.id,
        contactId: clientSokolova.contacts[0].id,
        projectObjectId: projectShowroom.id,
        needDescription: 'Нужны образцы Woodline и Stone для презентации заказчику',
        estimatedAmount: new Prisma.Decimal(320_000),
        targetDate: daysFromNow(14),
        decisionMakerContact: 'Анна Соколова',
      },
      {
        title: 'Отель «Метрополь» — ресепшн',
        status: LeadStatus.UNQUALIFIED,
        source: 'Входящий звонок',
        ownerId: managerElena.id,
        needDescription: 'Запрос на премиальные декоры для ресепшн отеля',
        estimatedAmount: new Prisma.Decimal(950_000),
        unqualificationReason:
          'Заказчик выбрал прямого поставщика из Европы с эксклюзивным декором',
      },
      {
        title: 'Офис IT-компании — open space',
        status: LeadStatus.UNQUALIFIED,
        source: 'Сайт',
        ownerId: managerIgor.id,
        needDescription: 'Отделка перегородок и стоек ресепшн',
        estimatedAmount: new Prisma.Decimal(480_000),
        unqualificationReason:
          'Проект заморожен до утверждения финансирования на следующий год',
      },
      {
        title: 'Клиника премиум-класса — стойка администратора',
        status: LeadStatus.UNQUALIFIED,
        source: 'Реклама в отраслевом журнале',
        ownerId: managerElena.id,
        needDescription: 'HPL для мебельных фасадов и стойки ресепшн',
        estimatedAmount: new Prisma.Decimal(210_000),
        unqualificationReason:
          'Спецификация изменена: вместо HPL заказчик перешёл на ЛДСП Egger',
      },
    ],
  });

  const volgaItems = [
    calcDealItem(graphite.id, 180, 5100, graphite.purchase),
    calcDealItem(white.id, 120, 4500, white.purchase),
    calcDealItem(stone.id, 95, 6800, stone.purchase, 15_000),
  ];
  const volgaTotal = volgaItems.reduce((sum, item) => sum + item.totalPriceNumber, 0);
  const volgaMargin = volgaItems.reduce((sum, item) => sum + (item.totalPriceNumber - item.purchaseCost), 0);

  const dealVolga = await prisma.deal.create({
    data: {
      title: 'БЦ «Волга Плаза» — комплектация лобби и МОП',
      stage: DealStage.WON,
      clientId: clientStroyMontazh.id,
      projectObjectId: projectBcVolga.id,
      ownerId: managerElena.id,
      totalAmount: new Prisma.Decimal(volgaTotal),
      margin: new Prisma.Decimal(volgaMargin),
      probability: 100,
      expectedCloseDate: daysAgo(10),
      items: {
        create: volgaItems.map(({ purchaseCost: _, totalPriceNumber: __, ...item }) => item),
      },
      offers: {
        create: {
          version: 1,
          number: 'КП-ВП-2026-01',
          amount: new Prisma.Decimal(volgaTotal),
          validUntil: daysFromNow(30),
          isApproved: true,
        },
      },
      stageHistory: {
        create: {
          oldStage: DealStage.PAYMENT_PREPARATION,
          newStage: DealStage.WON,
          changedById: head.id,
          reason: 'Подписан договор, получена спецификация',
        },
      },
    },
  });

  await prisma.lead.updateMany({
    where: {
      projectObjectId: projectBcVolga.id,
      status: LeadStatus.CONVERTED,
    },
    data: { dealId: dealVolga.id },
  });

  const severItems = [
    calcDealItem(oak.id, 420, 5800, oak.purchase),
    calcDealItem(anthracite.id, 310, 8700, anthracite.purchase, 45_000),
  ];
  const severTotal = severItems.reduce((sum, item) => sum + item.totalPriceNumber, 0);
  const severMargin = severItems.reduce((sum, item) => sum + (item.totalPriceNumber - item.purchaseCost), 0);

  await prisma.deal.create({
    data: {
      title: 'ЖК «Северная Долина» — входные группы, 4 корпуса',
      stage: DealStage.NEGOTIATION,
      clientId: clientMosProekt.id,
      projectObjectId: projectZhKSever.id,
      ownerId: managerIgor.id,
      totalAmount: new Prisma.Decimal(severTotal),
      margin: new Prisma.Decimal(severMargin),
      probability: 65,
      expectedCloseDate: daysFromNow(45),
      nextActionAt: daysFromNow(3),
      items: {
        create: severItems.map(({ purchaseCost: _, totalPriceNumber: __, ...item }) => item),
      },
      offers: {
        create: {
          version: 1,
          number: 'КП-СД-2026-02',
          amount: new Prisma.Decimal(severTotal),
          validUntil: daysFromNow(21),
          isApproved: false,
        },
      },
      stageHistory: {
        create: {
          oldStage: DealStage.OFFER_PREPARATION,
          newStage: DealStage.NEGOTIATION,
          changedById: managerIgor.id,
          reason: 'КП отправлено, ожидаем согласование сметы',
        },
      },
    },
  });

  const galereyaItems = [
    calcDealItem(white.id, 85, 4600, white.purchase),
    calcDealItem(graphite.id, 70, 5200, graphite.purchase),
  ];
  const galereyaTotal = galereyaItems.reduce((sum, item) => sum + item.totalPriceNumber, 0);
  const galereyaMargin = galereyaItems.reduce((sum, item) => sum + (item.totalPriceNumber - item.purchaseCost), 0);

  await prisma.deal.create({
    data: {
      title: 'ТЦ «Галерея» — реконструкция навигации и ресепшн',
      stage: DealStage.OFFER_PREPARATION,
      clientId: clientBcDev.id,
      projectObjectId: projectTcGalereya.id,
      ownerId: head.id,
      totalAmount: new Prisma.Decimal(galereyaTotal),
      margin: new Prisma.Decimal(galereyaMargin),
      probability: 40,
      expectedCloseDate: daysFromNow(55),
      nextActionAt: daysFromNow(5),
      items: {
        create: galereyaItems.map(({ purchaseCost: _, totalPriceNumber: __, ...item }) => item),
      },
      stageHistory: {
        create: {
          oldStage: DealStage.HPL_SELECTION,
          newStage: DealStage.OFFER_PREPARATION,
          changedById: head.id,
          reason: 'Декоры согласованы с девелопером',
        },
      },
    },
  });

  const lostDealItems = [calcDealItem(stone.id, 40, 6900, stone.purchase)];
  const lostTotal = lostDealItems[0].totalPriceNumber;

  await prisma.deal.create({
    data: {
      title: 'Отель «Метрополь» — ресепшн и лифтовые холлы',
      stage: DealStage.LOST,
      clientId: clientDekorFasad.id,
      ownerId: managerIgor.id,
      totalAmount: new Prisma.Decimal(lostTotal),
      margin: new Prisma.Decimal(lostTotal - lostDealItems[0].purchaseCost),
      probability: 0,
      lossReason: 'Проиграли по сроку поставки — конкурент предложил складскую программу',
      competitorName: 'Fundermax Russia',
      items: {
        create: lostDealItems.map(({ purchaseCost: _, totalPriceNumber: __, ...item }) => item),
      },
      stageHistory: {
        create: {
          oldStage: DealStage.NEGOTIATION,
          newStage: DealStage.LOST,
          changedById: managerIgor.id,
          reason: 'Клиент выбрал альтернативного поставщика',
        },
      },
    },
  });

  const reservedQty = volgaItems.reduce((sum, item) => sum + item.quantityM2, 0);

  const orderVolga = await prisma.order.create({
    data: {
      orderNumber: 'ORD-2026-0042',
      dealId: dealVolga.id,
      status: OrderStatus.WAITING_PAYMENT,
      paymentStatus: PaymentStatus.PARTIALLY_PAID,
      totalAmount: new Prisma.Decimal(volgaTotal),
      paidAmount: new Prisma.Decimal(1_500_000),
      remainingAmount: new Prisma.Decimal(volgaTotal - 1_500_000),
      paymentTerms: '50% предоплата, 50% перед отгрузкой',
      promisedDate: daysFromNow(40),
      deliveryAddress: 'г. Москва, ул. Волгоградский проспект, вл. 32, стройплощадка БЦ «Волга Плаза»',
      items: {
        create: volgaItems.map((item) => ({
          productId: item.productId,
          quantity: item.quantityM2,
          reservedQuantity: item.quantityM2,
          unitPrice: item.unitPrice,
          totalPrice: item.totalPrice,
        })),
      },
      payments: {
        create: [
          {
            amount: new Prisma.Decimal(1_500_000),
            paymentDate: daysAgo(3),
            status: PaymentRecordStatus.CONFIRMED,
            comment: 'Предоплата 50% по договору',
            createdById: managerElena.id,
          },
          {
            amount: new Prisma.Decimal(800_000),
            status: PaymentRecordStatus.PENDING,
            comment: 'Второй транш — ожидает подтверждения финслужбы',
            createdById: managerElena.id,
          },
        ],
      },
      reservations: {
        create: volgaItems.map((item) => ({
          productId: item.productId,
          quantity: item.quantityM2,
          status: StockReservationStatus.ACTIVE,
          expiresAt: daysFromNow(3),
        })),
      },
    },
    include: { items: true },
  });

  for (const item of volgaItems) {
    await prisma.stockBalance.update({
      where: { productId: item.productId },
      data: {
        reserved: { increment: item.quantityM2 },
        available: { decrement: item.quantityM2 },
      },
    });
  }

  await prisma.expectedReceipt.create({
    data: {
      supplierId: supplierByCode.get('ARPA')!.id,
      expectedDate: daysFromNow(14),
      comment: 'Пополнение складских остатков Woodline и Stone',
      items: {
        create: [
          { productId: oak.id, quantity: 40 },
          { productId: stone.id, quantity: 30 },
        ],
      },
    },
  });

  await prisma.task.createMany({
    data: [
      {
        title: 'Согласовать финальную спецификацию с ПТО',
        type: TaskType.MEETING,
        status: TaskStatus.PENDING,
        priority: TaskPriority.HIGH,
        dueDate: daysFromNow(2),
        originalDueDate: daysFromNow(2),
        assigneeId: managerElena.id,
        createdById: head.id,
        relatedType: 'Deal',
        relatedId: dealVolga.id,
      },
      {
        title: 'Отправить образцы Woodline заказчику',
        type: TaskType.SAMPLE_SEND,
        status: TaskStatus.IN_PROGRESS,
        priority: TaskPriority.MEDIUM,
        dueDate: daysFromNow(4),
        originalDueDate: daysFromNow(4),
        assigneeId: managerIgor.id,
        createdById: managerIgor.id,
        relatedType: 'Client',
        relatedId: clientMosProekt.id,
      },
      {
        title: 'Проверить поступление предоплаты по БЦ «Волга Плаза»',
        type: TaskType.PAYMENT_CHECK,
        status: TaskStatus.COMPLETED,
        priority: TaskPriority.HIGH,
        dueDate: daysAgo(2),
        originalDueDate: daysAgo(2),
        completedAt: daysAgo(3),
        assigneeId: head.id,
        createdById: admin.id,
        relatedType: 'Order',
        relatedId: orderVolga.id,
        result: 'Предоплата 1 500 000 ₽ подтверждена',
      },
    ],
  });

  const currentMonth = new Date();
  currentMonth.setDate(1);
  currentMonth.setHours(0, 0, 0, 0);

  await prisma.salesPlan.createMany({
    data: [
      {
        userId: managerElena.id,
        period: currentMonth,
        targetAmount: new Prisma.Decimal(6_000_000),
        actualAmount: new Prisma.Decimal(volgaTotal),
      },
      {
        userId: managerIgor.id,
        period: currentMonth,
        targetAmount: new Prisma.Decimal(10_000_000),
        actualAmount: new Prisma.Decimal(0),
      },
      {
        userId: head.id,
        period: currentMonth,
        targetAmount: new Prisma.Decimal(25_000_000),
        actualAmount: new Prisma.Decimal(volgaTotal),
      },
    ],
  });

  await prisma.leadPlan.createMany({
    data: [
      { userId: managerElena.id, period: currentMonth, targetCount: 12, actualCount: 4 },
      { userId: managerIgor.id, period: currentMonth, targetCount: 15, actualCount: 3 },
    ],
  });

  await prisma.kpiSetting.create({
    data: {
      period: currentMonth,
      salesPlanWeight: 40,
      qualifiedLeadsWeight: 15,
      conversionWeight: 15,
      taskOnTimeWeight: 15,
      crmDisciplineWeight: 15,
    },
  });

  console.log('Seed completed');
  }

  await seedServiceAccounts(prisma);
  await seedPanels(prisma);
  await seedCalculatorProduct(prisma);

  if (!isProduction) {
    const director = await prisma.user.findUnique({
      where: { email: 'director@hpl.com' },
      select: { id: true },
    });
    const rateAuthor =
      director ??
      (await prisma.user.findUnique({
        where: { email: 'admin@hpl.com' },
        select: { id: true },
      }));
    if (rateAuthor) {
      await seedFixtureCnyUsdRate(prisma, rateAuthor.id);
    }
  }

  console.log('Panel catalog seed completed');
}

async function bootstrap(): Promise<void> {
  try {
    prisma = await createPrismaClient();
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('not compatible with the provider')
    ) {
      throw new Error(
        'DATABASE_URL не совместим с provider Prisma-клиента. ' +
          'P0 требует PostgreSQL: `docker compose -f docker-compose.dev.yml up -d`, ' +
          'затем `npx prisma migrate dev` и `npm run db:seed`.',
        { cause: error },
      );
    }

    throw error;
  }

  await main();
}

bootstrap()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error(error);
    if (prisma) {
      await prisma.$disconnect();
    }
    process.exit(1);
  });
