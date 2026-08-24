import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { ServiceAccount } from '@prisma/client';
import { ApiKeyAuthGuard } from './api-key-auth.guard';
import { ApiKeyService } from './api-key.service';

describe('ApiKeyAuthGuard', () => {
  let guard: ApiKeyAuthGuard;
  let apiKeyService: {
    findAccountByToken: jest.Mock;
    touchLastUsed: jest.Mock;
  };

  const account: ServiceAccount = {
    id: 'sa-1',
    name: 'telegram-bot',
    tokenHash: 'hash',
    permissions: ['leads:create'],
    isActive: true,
    lastUsedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const createContext = (headers: Record<string, string>): ExecutionContext => {
    const request: {
      headers: Record<string, string>;
      serviceAccount?: ServiceAccount;
    } = { headers };

    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as ExecutionContext;
  };

  beforeEach(() => {
    apiKeyService = {
      findAccountByToken: jest.fn(),
      touchLastUsed: jest.fn().mockResolvedValue(undefined),
    };
    guard = new ApiKeyAuthGuard(apiKeyService as unknown as ApiKeyService);
  });

  it('allows requests with a valid X-API-Key', async () => {
    apiKeyService.findAccountByToken.mockResolvedValue(account);
    const context = createContext({ 'x-api-key': 'valid-token' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('throws UnauthorizedException when header is missing', async () => {
    const context = createContext({});

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('throws UnauthorizedException for an invalid token', async () => {
    apiKeyService.findAccountByToken.mockResolvedValue(null);
    const context = createContext({ 'x-api-key': 'invalid-token' });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('throws ForbiddenException for an inactive account', async () => {
    apiKeyService.findAccountByToken.mockResolvedValue({
      ...account,
      isActive: false,
    });
    const context = createContext({ 'x-api-key': 'inactive-token' });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
