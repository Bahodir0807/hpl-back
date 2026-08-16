import { RoleName } from '@prisma/client';
import type { CurrentUser } from '../../common/interfaces/current-user.interface';
import { ClientsService } from './clients.service';

describe('ClientsService authorization', () => {
  const prisma = {
    client: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const manager: CurrentUser = {
    id: 'manager-id',
    email: 'manager@test.com',
    teamId: null,
    managerId: null,
    roles: [RoleName.MANAGER],
    permissions: ['clients:read'],
  };

  let service: ClientsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ClientsService(prisma as never);
    prisma.client.findMany.mockResolvedValue([]);
    prisma.client.count.mockResolvedValue(0);
    prisma.$transaction.mockImplementation(async (ops: unknown) => {
      if (Array.isArray(ops)) {
        return Promise.all(ops);
      }

      throw new Error('expected array transaction');
    });
  });

  it('ignores ownerId filters for users without clients:read_all', async () => {
    await service.findAll(
      { ownerId: 'other-manager', page: 1, limit: 20 },
      manager.id,
      manager.permissions,
    );

    expect(prisma.client.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ ownerId: manager.id }) as {
          ownerId: string;
        },
      }),
    );
  });

  it('redacts PII for duplicate matches the caller cannot access', async () => {
    prisma.client.findMany.mockResolvedValue([
      {
        id: 'other-client',
        type: 'COMPANY',
        name: 'Other LLC',
        inn: '7700000000',
        phone: '+79990000000',
        email: 'secret@other.test',
        ownerId: 'other-manager',
        status: 'ACTIVE',
        contacts: [],
      },
    ]);

    const matches = await service.checkDuplicates(
      { inn: '7700000000' },
      manager,
    );

    expect(matches[0]?.client).toEqual(
      expect.objectContaining({
        id: 'other-client',
        name: 'Other LLC',
        ownerId: 'other-manager',
        inn: null,
        phone: null,
        email: null,
      }),
    );
  });
});
