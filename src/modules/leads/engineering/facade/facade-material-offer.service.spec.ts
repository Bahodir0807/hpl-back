/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Prisma, RoleName } from '@prisma/client';
import { BusinessException } from '../../../../common/exceptions/business.exception';
import type { CurrentUser } from '../../../../common/interfaces/current-user.interface';
import { ROLE_PERMISSION_SLUGS } from '../../../../auth/rbac/permission-matrix';
import { FacadeMaterialOfferService } from './facade-material-offer.service';

function errorCode(error: unknown): string | undefined {
  if (error instanceof BusinessException) {
    const response = error.getResponse();
    if (typeof response === 'object' && response && 'errorCode' in response) {
      return String(response.errorCode);
    }
  }
  return undefined;
}

async function expectBusinessCode(promise: Promise<unknown>, code: string) {
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

function userFor(role: RoleName): CurrentUser {
  return {
    id: `${role.toLowerCase()}-1`,
    email: `${role.toLowerCase()}@test.com`,
    teamId: null,
    managerId: null,
    roles: [role],
    permissions: [...ROLE_PERMISSION_SLUGS[role]],
  };
}

describe('FacadeMaterialOfferService', () => {
  const prisma = {
    facadeMaterialSupplierOffer: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    facadeMaterial: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    supplier: { findMany: jest.fn(), findUnique: jest.fn() },
    activity: { create: jest.fn() },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn(),
  };

  const service = new FacadeMaterialOfferService(prisma as never);
  const head = userFor(RoleName.HEAD);
  const engineer = userFor(RoleName.ENGINEER);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(async (arg: unknown) => {
      if (typeof arg === 'function') {
        return (arg as (tx: typeof prisma) => unknown)(prisma);
      }
      return arg;
    });
    prisma.activity.create.mockResolvedValue({});
    prisma.auditLog.create.mockResolvedValue({});
    prisma.facadeMaterial.findUnique.mockResolvedValue({
      id: 'mat-1',
      code: 'membrane',
      unit: 'M2',
    });
    prisma.supplier.findUnique.mockResolvedValue({
      id: 'sup-1',
      name: 'QA',
      code: 'qa',
    });
  });

  it('stores multiple Decimal offers with distinct currencies on one material', async () => {
    const created: Array<Record<string, unknown>> = [];
    prisma.facadeMaterialSupplierOffer.create.mockImplementation(
      async ({ data }) => {
        const offer = {
          id: `offer-${created.length + 1}`,
          ...data,
          material: {
            code: 'membrane',
            nameRu: 'Мембрана',
            nameEn: 'Membrane',
            nameUz: 'Membrana',
            category: 'MEMBRANE',
            unit: 'M2',
          },
          supplier: { code: 'qa', name: 'QA' },
          createdAt: new Date('2026-09-21T00:00:00.000Z'),
          updatedAt: new Date('2026-09-21T00:00:00.000Z'),
          validFrom: data.validFrom,
          validTo: data.validTo ?? null,
        };
        created.push(offer);
        return offer;
      },
    );

    const first = await service.create(
      {
        materialId: 'mat-1',
        supplierId: 'sup-1',
        purchasePrice: '4.50',
        currency: 'usd',
        unit: 'M2',
        validFrom: '2026-01-01T00:00:00.000Z',
      },
      head,
    );
    prisma.supplier.findUnique.mockResolvedValue({
      id: 'sup-2',
      name: 'CN',
      code: 'cn',
    });
    const second = await service.create(
      {
        materialId: 'mat-1',
        supplierId: 'sup-2',
        purchasePrice: '30.10',
        currency: 'CNY',
        unit: 'M2',
        validFrom: '2026-01-01T00:00:00.000Z',
      },
      head,
    );

    expect(created).toHaveLength(2);
    expect(first.purchasePrice).toBe(new Prisma.Decimal('4.50').toFixed());
    expect(first.currency).toBe('USD');
    expect(second.currency).toBe('CNY');
    expect(first.materialId).toBe(second.materialId);
  });

  it('forbids ENGINEER from managing offers', async () => {
    await expectBusinessCode(
      service.create(
        {
          materialId: 'mat-1',
          supplierId: 'sup-1',
          purchasePrice: '1',
          currency: 'USD',
          unit: 'M2',
          validFrom: '2026-01-01T00:00:00.000Z',
        },
        engineer,
      ),
      'FORBIDDEN',
    );
  });

  it('hides purchase offers from unauthorized users', async () => {
    await expectBusinessCode(
      service.list(userFor(RoleName.MANAGER)),
      'FORBIDDEN',
    );
  });
});
