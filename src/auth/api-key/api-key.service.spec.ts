import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { ServiceAccount } from '@prisma/client';
import { PrismaService } from '../../modules/prisma/prisma.service';
import { ApiKeyService } from './api-key.service';

describe('ApiKeyService', () => {
  let service: ApiKeyService;
  let prisma: {
    serviceAccount: {
      findUnique: jest.Mock;
      update: jest.Mock;
    };
  };

  const pepper = 'test-service-account-pepper-min-32-chars';
  const activeAccount: ServiceAccount = {
    id: 'sa-1',
    name: 'telegram-bot',
    tokenHash: 'abc',
    permissions: ['leads:create'],
    isActive: true,
    lastUsedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    prisma = {
      serviceAccount: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue(activeAccount),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApiKeyService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue(pepper),
          },
        },
      ],
    }).compile();

    service = module.get(ApiKeyService);
  });

  it('validateToken returns ServiceAccount for a valid active token', async () => {
    const token = 'valid-token';
    const tokenHash = service.hashToken(token);
    prisma.serviceAccount.findUnique.mockResolvedValue({
      ...activeAccount,
      tokenHash,
    });

    const result = await service.validateToken(token);

    expect(result).not.toBeNull();
    expect(result?.name).toBe('telegram-bot');
  });

  it('validateToken returns null for an invalid token', async () => {
    prisma.serviceAccount.findUnique.mockResolvedValue(null);

    const result = await service.validateToken('invalid-token');

    expect(result).toBeNull();
  });

  it('validateToken returns null for an inactive account', async () => {
    const token = 'inactive-token';
    const tokenHash = service.hashToken(token);
    prisma.serviceAccount.findUnique.mockResolvedValue({
      ...activeAccount,
      tokenHash,
      isActive: false,
    });

    const result = await service.validateToken(token);

    expect(result).toBeNull();
  });

  it('rotateToken updates tokenHash in the database', async () => {
    prisma.serviceAccount.findUnique.mockResolvedValue(activeAccount);

    const result = await service.rotateToken('telegram-bot');

    expect(result.token).toHaveLength(64);
    expect(result.tokenHash).toBe(service.hashToken(result.token));
    expect(prisma.serviceAccount.update).toHaveBeenCalledWith({
      where: { name: 'telegram-bot' },
      data: { tokenHash: result.tokenHash },
    });
  });

  it('rotateToken throws when service account is missing', async () => {
    prisma.serviceAccount.findUnique.mockResolvedValue(null);

    await expect(service.rotateToken('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
