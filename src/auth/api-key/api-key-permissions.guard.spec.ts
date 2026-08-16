import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ServiceAccount } from '@prisma/client';
import { ApiKeyPermissionsGuard } from './api-key-permissions.guard';
import { API_KEY_PERMISSIONS_KEY } from './require-api-key-permissions.decorator';

describe('ApiKeyPermissionsGuard', () => {
  let guard: ApiKeyPermissionsGuard;
  let reflector: Reflector;

  const account: ServiceAccount = {
    id: 'sa-1',
    name: 'telegram-bot',
    tokenHash: 'hash',
    permissions: ['leads:create', 'clients:create'],
    isActive: true,
    lastUsedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const createContext = (
    serviceAccount?: ServiceAccount,
  ): ExecutionContext => {
    const request = { serviceAccount };

    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as ExecutionContext;
  };

  beforeEach(() => {
    reflector = new Reflector();
    guard = new ApiKeyPermissionsGuard(reflector);
  });

  it('allows when required permissions are present', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['leads:create']);
    const context = createContext(account);

    expect(guard.canActivate(context)).toBe(true);
  });

  it('throws ForbiddenException when permissions are missing', () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue(['leads:delete']);
    const context = createContext(account);

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('throws ForbiddenException when service account is missing', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['leads:create']);
    const context = createContext(undefined);

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('allows when no permissions metadata is set', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    const context = createContext(undefined);

    expect(guard.canActivate(context)).toBe(true);
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(
      API_KEY_PERMISSIONS_KEY,
      expect.any(Array),
    );
  });
});
