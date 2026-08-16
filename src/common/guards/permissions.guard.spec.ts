import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RoleName } from '@prisma/client';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { REQUIRED_PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import type { CurrentUser } from '../interfaces/current-user.interface';
import { PermissionsGuard } from './permissions.guard';

describe('PermissionsGuard', () => {
  let guard: PermissionsGuard;
  let reflector: Reflector;

  const user: CurrentUser = {
    id: 'user-id',
    email: 'user@test.com',
    teamId: null,
    managerId: null,
    roles: [RoleName.MANAGER],
    permissions: ['leads:read'],
  };

  const createContext = (requestUser?: CurrentUser): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ user: requestUser }),
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    }) as ExecutionContext;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new PermissionsGuard(reflector);
  });

  it('allows public endpoints without a user', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => {
      if (key === IS_PUBLIC_KEY) {
        return true;
      }

      return undefined;
    });

    expect(guard.canActivate(createContext())).toBe(true);
  });

  it('rejects authenticated users missing the required permission', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => {
      if (key === REQUIRED_PERMISSIONS_KEY) {
        return ['leads:delete'];
      }

      return false;
    });

    expect(() => guard.canActivate(createContext(user))).toThrow(
      ForbiddenException,
    );
  });

  it('rejects requests with no required permission metadata', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);

    expect(() => guard.canActivate(createContext(user))).toThrow(
      ForbiddenException,
    );
  });

  it('allows users who have every required permission', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => {
      if (key === REQUIRED_PERMISSIONS_KEY) {
        return ['leads:read'];
      }

      return false;
    });

    expect(guard.canActivate(createContext(user))).toBe(true);
  });
});
