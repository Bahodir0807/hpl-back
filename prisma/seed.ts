import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  PrismaClient,
  ProductPriceType,
  ProductStatus,
  RoleName,
} from '@prisma/client';
import { hash } from 'bcryptjs';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is not configured');
}

const adapter = new PrismaPg({
  connectionString: resolvePgConnectionString(connectionString),
});
const prisma = new PrismaClient({ adapter });

const PASSWORD = 'Password123!';
const PASSWORD_HASH_ROUNDS = 12;

const permissionDefinitions = [
  ['auth:me', 'Read own profile'],
  ['users:read', 'Read users'],
  ['users:create', 'Create users'],
  ['users:write', 'Update users'],
  ['users:manage', 'Manage user status'],
  ['references:read', 'Read reference data'],
  ['references:create', 'Create reference data'],
  ['references:update', 'Update reference data'],
  ['references:delete', 'Delete reference data'],
  ['products:read', 'Read products'],
  ['products:create', 'Create products'],
  ['products:update', 'Update products'],
  ['products:delete', 'Delete products'],
  ['products:manage_prices', 'Manage product prices'],
  ['products:read_purchase_price', 'Read purchase prices and margins'],
  ['clients:read', 'Read clients'],
  ['clients:read_all', 'Read all clients'],
  ['clients:create', 'Create clients'],
  ['clients:update', 'Update clients'],
  ['clients:delete', 'Delete clients'],
  ['leads:read', 'Read leads'],
  ['leads:read_all', 'Read all leads'],
  ['leads:create', 'Create leads'],
  ['leads:update', 'Update leads'],
  ['leads:delete', 'Delete leads'],
  ['leads:qualify', 'Qualify leads'],
  ['leads:assign', 'Assign leads'],
  ['tasks:read', 'Read tasks'],
  ['tasks:read_all', 'Read all tasks'],
  ['tasks:create', 'Create tasks'],
  ['tasks:update', 'Update tasks'],
  ['tasks:delete', 'Delete tasks'],
  ['deals:read', 'Read deals'],
  ['deals:read_all', 'Read all deals'],
  ['deals:create', 'Create deals'],
  ['deals:update', 'Update deals'],
  ['deals:delete', 'Delete deals'],
  ['deals:create_offer', 'Create deal offers'],
  ['deals:approve_offer', 'Approve deal offers'],
  ['deals:stage_exception', 'Approve deal stage exceptions'],
  ['orders:read', 'Read orders'],
  ['orders:create', 'Create orders'],
  ['payments:create', 'Create payments'],
  ['payments:confirm', 'Confirm payments'],
  ['deliveries:create', 'Create deliveries'],
  ['inventory:read', 'Read inventory'],
  ['inventory:manage', 'Manage inventory'],
  ['reports:read', 'Read reports'],
  ['audit:read', 'Read audit timeline'],
] as const;

const readPermissions = permissionDefinitions
  .map(([slug]) => slug)
  .filter(
    (slug) =>
      slug.endsWith(':read') ||
      slug.endsWith(':read_all') ||
      slug === 'auth:me' ||
      slug === 'audit:read',
  );

const rolePermissionSlugs: Record<RoleName, string[]> = {
  [RoleName.ADMIN]: permissionDefinitions.map(([slug]) => slug),
  [RoleName.HEAD]: permissionDefinitions.map(([slug]) => slug),
  [RoleName.MANAGER]: [
    'auth:me',
    'references:read',
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
    'reports:read',
    'audit:read',
  ],
  [RoleName.STOREKEEPER]: [
    'auth:me',
    'references:read',
    'products:read',
    'orders:read',
    'deliveries:create',
    'inventory:read',
    'inventory:manage',
  ],
  [RoleName.OBSERVER]: readPermissions,
};

const suppliers = [
  { code: 'SLOTEX', name: 'Slotex HPL Supply' },
  { code: 'ARPA', name: 'Arpa Industriale' },
];

const brands = [
  { code: 'HPLPRO', name: 'HPL Pro' },
  { code: 'ARCHSKIN', name: 'Arch Skin' },
];

const collections = [
  { brandCode: 'HPLPRO', name: 'Solid Colors' },
  { brandCode: 'HPLPRO', name: 'Woodline' },
  { brandCode: 'ARCHSKIN', name: 'Stone' },
];

const products = [
  {
    sku: 'HPL-SOL-WHITE-12',
    name: 'HPL Solid White 12mm',
    brandCode: 'HPLPRO',
    collectionName: 'Solid Colors',
    supplierCode: 'SLOTEX',
    decorCode: 'SW-100',
    colorName: 'White',
    surface: 'Matte',
    base: 4200,
    purchase: 2850,
    wholesale: 3900,
    retail: 4600,
  },
  {
    sku: 'HPL-SOL-GRAPHITE-12',
    name: 'HPL Solid Graphite 12mm',
    brandCode: 'HPLPRO',
    collectionName: 'Solid Colors',
    supplierCode: 'SLOTEX',
    decorCode: 'SG-210',
    colorName: 'Graphite',
    surface: 'Soft Touch',
    base: 4700,
    purchase: 3200,
    wholesale: 4350,
    retail: 5200,
  },
  {
    sku: 'HPL-WOOD-OAK-12',
    name: 'HPL Woodline Oak 12mm',
    brandCode: 'HPLPRO',
    collectionName: 'Woodline',
    supplierCode: 'ARPA',
    decorCode: 'WO-310',
    colorName: 'Natural Oak',
    surface: 'Woodgrain',
    base: 5300,
    purchase: 3650,
    wholesale: 4900,
    retail: 5900,
  },
  {
    sku: 'HPL-STONE-GREY-12',
    name: 'HPL Stone Grey 12mm',
    brandCode: 'ARCHSKIN',
    collectionName: 'Stone',
    supplierCode: 'ARPA',
    decorCode: 'ST-420',
    colorName: 'Grey Stone',
    surface: 'Textured',
    base: 6100,
    purchase: 4300,
    wholesale: 5650,
    retail: 6900,
  },
];

async function main(): Promise<void> {
  const passwordHash = await hash(PASSWORD, PASSWORD_HASH_ROUNDS);

  const roles = new Map<RoleName, { id: string }>();

  for (const roleName of Object.values(RoleName)) {
    const role = await prisma.role.upsert({
      where: { name: roleName },
      update: {
        description: `${roleName} role`,
      },
      create: {
        name: roleName,
        description: `${roleName} role`,
      },
      select: { id: true },
    });
    roles.set(roleName, role);
  }

  const permissions = new Map<string, { id: string }>();

  for (const [slug, description] of permissionDefinitions) {
    const permission = await prisma.permission.upsert({
      where: { slug },
      update: { description },
      create: { slug, description },
      select: { id: true },
    });
    permissions.set(slug, permission);
  }

  for (const [roleName, slugs] of Object.entries(rolePermissionSlugs) as [
    RoleName,
    string[],
  ][]) {
    const role = roles.get(roleName);

    if (!role) {
      throw new Error(`Role not seeded: ${roleName}`);
    }

    await prisma.rolePermission.deleteMany({
      where: { roleId: role.id },
    });

    for (const slug of slugs) {
      const permission = permissions.get(slug);

      if (!permission) {
        throw new Error(`Permission not seeded: ${slug}`);
      }

      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: role.id,
            permissionId: permission.id,
          },
        },
        update: {},
        create: {
          roleId: role.id,
          permissionId: permission.id,
        },
      });
    }
  }

  const admin = await upsertUser({
    email: 'admin@hpl.com',
    firstName: 'Admin',
    lastName: 'HPL',
    phone: '77000000001',
    passwordHash,
    roleName: RoleName.ADMIN,
  });

  const head = await upsertUser({
    email: 'head@hpl.com',
    firstName: 'Head',
    lastName: 'Sales',
    phone: '77000000002',
    passwordHash,
    roleName: RoleName.HEAD,
  });

  const salesTeam = await prisma.team.upsert({
    where: { name: 'Sales Team' },
    update: { leaderId: head.id },
    create: { name: 'Sales Team', leaderId: head.id },
  });

  await prisma.user.update({
    where: { id: head.id },
    data: { teamId: salesTeam.id },
  });

  await upsertUser({
    email: 'manager1@hpl.com',
    firstName: 'Manager',
    lastName: 'One',
    phone: '77000000003',
    passwordHash,
    roleName: RoleName.MANAGER,
    teamId: salesTeam.id,
    managerId: head.id,
  });

  await upsertUser({
    email: 'storekeeper@hpl.com',
    firstName: 'Store',
    lastName: 'Keeper',
    phone: '77000000004',
    passwordHash,
    roleName: RoleName.STOREKEEPER,
  });

  void admin;

  const supplierByCode = new Map<string, { id: string }>();

  for (const supplierSeed of suppliers) {
    const supplier = await prisma.supplier.upsert({
      where: { code: supplierSeed.code },
      update: { name: supplierSeed.name },
      create: supplierSeed,
      select: { id: true },
    });
    supplierByCode.set(supplierSeed.code, supplier);
  }

  const brandByCode = new Map<string, { id: string }>();

  for (const brandSeed of brands) {
    const brand = await prisma.brand.upsert({
      where: { code: brandSeed.code },
      update: { name: brandSeed.name },
      create: brandSeed,
      select: { id: true },
    });
    brandByCode.set(brandSeed.code, brand);
  }

  const collectionByKey = new Map<string, { id: string }>();

  for (const collectionSeed of collections) {
    const brand = getFromMap(brandByCode, collectionSeed.brandCode);
    const collection = await prisma.productCollection.upsert({
      where: {
        brandId_name: {
          brandId: brand.id,
          name: collectionSeed.name,
        },
      },
      update: {},
      create: {
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

  for (const productSeed of products) {
    const brand = getFromMap(brandByCode, productSeed.brandCode);
    const supplier = getFromMap(supplierByCode, productSeed.supplierCode);
    const collection = getFromMap(
      collectionByKey,
      `${productSeed.brandCode}:${productSeed.collectionName}`,
    );
    const sheetArea = (3050 * 1300) / 1_000_000;

    const product = await prisma.product.upsert({
      where: { sku: productSeed.sku },
      update: {
        name: productSeed.name,
        brandId: brand.id,
        collectionId: collection.id,
        supplierId: supplier.id,
        decorCode: productSeed.decorCode,
        colorName: productSeed.colorName,
        surface: productSeed.surface,
        thickness: 12,
        length: 3050,
        width: 1300,
        unit: 'm2',
        sheetArea,
        status: ProductStatus.ACTIVE,
        deletedAt: null,
      },
      create: {
        sku: productSeed.sku,
        name: productSeed.name,
        brandId: brand.id,
        collectionId: collection.id,
        supplierId: supplier.id,
        decorCode: productSeed.decorCode,
        colorName: productSeed.colorName,
        surface: productSeed.surface,
        thickness: 12,
        length: 3050,
        width: 1300,
        unit: 'm2',
        sheetArea,
        status: ProductStatus.ACTIVE,
      },
      select: { id: true },
    });

    await prisma.productPrice.deleteMany({
      where: { productId: product.id },
    });

    await prisma.productPrice.createMany({
      data: [
        {
          productId: product.id,
          type: ProductPriceType.BASE,
          amount: productSeed.base,
          validFrom: new Date(),
        },
        {
          productId: product.id,
          type: ProductPriceType.PURCHASE,
          amount: productSeed.purchase,
          validFrom: new Date(),
        },
        {
          productId: product.id,
          type: ProductPriceType.WHOLESALE,
          amount: productSeed.wholesale,
          validFrom: new Date(),
        },
        {
          productId: product.id,
          type: ProductPriceType.RETAIL,
          amount: productSeed.retail,
          validFrom: new Date(),
        },
      ],
    });

    await prisma.stockBalance.upsert({
      where: { productId: product.id },
      update: {
        onHand: 50,
        reserved: 0,
        available: 50,
      },
      create: {
        productId: product.id,
        onHand: 50,
        reserved: 0,
        available: 50,
      },
    });
  }

  console.log('Seed completed');
  console.log(`Initial admin: admin@hpl.com / ${PASSWORD}`);
}

async function upsertUser(input: {
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  passwordHash: string;
  roleName: RoleName;
  teamId?: string;
  managerId?: string;
}): Promise<{ id: string }> {
  const role = await prisma.role.findUnique({
    where: { name: input.roleName },
    select: { id: true },
  });

  if (!role) {
    throw new Error(`Role not seeded: ${input.roleName}`);
  }

  const user = await prisma.user.upsert({
    where: { email: input.email },
    update: {
      passwordHash: input.passwordHash,
      firstName: input.firstName,
      lastName: input.lastName,
      phone: input.phone,
      isActive: true,
      teamId: input.teamId,
      managerId: input.managerId,
    },
    create: {
      email: input.email,
      passwordHash: input.passwordHash,
      firstName: input.firstName,
      lastName: input.lastName,
      phone: input.phone,
      isActive: true,
      teamId: input.teamId,
      managerId: input.managerId,
    },
    select: { id: true },
  });

  await prisma.userRole.deleteMany({
    where: { userId: user.id },
  });

  await prisma.userRole.create({
    data: {
      userId: user.id,
      roleId: role.id,
    },
  });

  return user;
}

function getFromMap<T>(map: Map<string, T>, key: string): T {
  const value = map.get(key);

  if (!value) {
    throw new Error(`Seed dependency not found: ${key}`);
  }

  return value;
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

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
