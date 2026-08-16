import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RoleName } from '@prisma/client';
import { UsersService } from '../../users/users.service';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  const usersService = {
    findAuthUserById: jest.fn(),
    toCurrentUser: jest.fn(),
  };
  const configService = {
    get: jest.fn().mockReturnValue('test-secret'),
  };

  let strategy: JwtStrategy;

  beforeEach(() => {
    jest.clearAllMocks();
    strategy = new JwtStrategy(
      usersService as unknown as UsersService,
      configService as unknown as ConfigService,
    );
  });

  it('rejects inactive users', async () => {
    usersService.findAuthUserById.mockResolvedValue({
      id: 'user-id',
      email: 'user@test.com',
      isActive: false,
    });

    await expect(
      strategy.validate({ userId: 'user-id', email: 'user@test.com' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('returns a fresh authorization context for an active user', async () => {
    const authUser = {
      id: 'user-id',
      email: 'user@test.com',
      isActive: true,
    };
    const currentUser = {
      id: 'user-id',
      email: 'user@test.com',
      teamId: null,
      managerId: null,
      roles: [RoleName.MANAGER],
      permissions: ['leads:read'],
    };

    usersService.findAuthUserById.mockResolvedValue(authUser);
    usersService.toCurrentUser.mockResolvedValue(currentUser);

    await expect(
      strategy.validate({ userId: 'user-id', email: 'user@test.com' }),
    ).resolves.toEqual(currentUser);
  });
});
