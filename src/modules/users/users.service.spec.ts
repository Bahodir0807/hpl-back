import { ForbiddenException } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { UsersService } from './users.service';

describe('UsersService.assertUserModuleAccess', () => {
  const service = new UsersService({} as never);

  it('allows ADMIN, DIRECTOR, HEAD, and ADMIN combined with business roles', () => {
    expect(() =>
      service.assertUserModuleAccess({ roles: [RoleName.ADMIN] }),
    ).not.toThrow();
    expect(() =>
      service.assertUserModuleAccess({ roles: [RoleName.DIRECTOR] }),
    ).not.toThrow();
    expect(() =>
      service.assertUserModuleAccess({ roles: [RoleName.HEAD] }),
    ).not.toThrow();
    expect(() =>
      service.assertUserModuleAccess({
        roles: [RoleName.DIRECTOR, RoleName.ADMIN],
      }),
    ).not.toThrow();
    expect(() =>
      service.assertUserModuleAccess({
        roles: [RoleName.HEAD, RoleName.ADMIN],
      }),
    ).not.toThrow();
    expect(() =>
      service.assertUserModuleAccess({
        roles: [RoleName.ACCOUNTANT, RoleName.ADMIN],
      }),
    ).not.toThrow();
    expect(() =>
      service.assertUserModuleAccess({
        roles: [RoleName.MANAGER, RoleName.ADMIN],
      }),
    ).not.toThrow();
  });

  it('still denies business-only roles without ADMIN', () => {
    expect(() =>
      service.assertUserModuleAccess({ roles: [RoleName.ACCOUNTANT] }),
    ).toThrow(ForbiddenException);
    expect(() =>
      service.assertUserModuleAccess({ roles: [RoleName.MANAGER] }),
    ).toThrow(ForbiddenException);
    expect(() =>
      service.assertUserModuleAccess({ roles: [RoleName.INSTALLER] }),
    ).toThrow(ForbiddenException);
  });
});
