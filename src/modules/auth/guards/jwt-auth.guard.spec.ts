import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new JwtAuthGuard(reflector);
  });

  it('allows public endpoints without a JWT', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => {
      return key === IS_PUBLIC_KEY;
    });

    expect(
      guard.canActivate({
        getHandler: () => ({}),
        getClass: () => ({}),
      } as ExecutionContext),
    ).toBe(true);
  });

  it('rejects unauthenticated requests', () => {
    expect(() => guard.handleRequest(null, null, null)).toThrow(
      UnauthorizedException,
    );
  });

  it('returns the authenticated user when present', () => {
    const user = { id: 'user-id' };

    expect(guard.handleRequest(null, user, null)).toBe(user);
  });
});
