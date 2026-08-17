import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Permission, Prisma, RoleName, User } from '@prisma/client';
import { hash } from 'bcryptjs';
import {
  assertAdministrativePasswordResetAllowed,
  assertCreatableRoleNames,
} from '../../auth/rbac/role-assignment.policy';
import { hasUserModuleAccess } from '../../common/enums/role.enum';
import type { CurrentUser } from '../../common/interfaces/current-user.interface';
import { PrismaService } from '../prisma/prisma.service';
import { FilterUserDto } from './dto/filter-user.dto';
import { RegisterUserDto } from './dto/register-user.dto';

const PASSWORD_HASH_ROUNDS = 12;

type UserWithAuthz = User & {
  roles: {
    role: {
      name: RoleName;
      permissions: {
        permission: Permission;
      }[];
    };
  }[];
  permissions: {
    permission: Permission;
  }[];
};

type SafeUser = Omit<User, 'passwordHash'>;

type AuthUserRecord = {
  id: string;
  email: string;
  teamId: string | null;
  managerId: string | null;
  isActive: boolean;
  roles: {
    role: {
      name: RoleName;
    };
  }[];
};

const userListSelect = Prisma.validator<Prisma.UserSelect>()({
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  isActive: true,
  teamId: true,
  managerId: true,
  lastLoginAt: true,
  createdAt: true,
  roles: {
    select: {
      role: {
        select: { name: true },
      },
    },
  },
});

type UserListItem = Prisma.UserGetPayload<{
  select: typeof userListSelect;
}>;

type UserListResult = {
  items: UserListItem[];
  total: number;
  page: number;
  limit: number;
};

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    dto: RegisterUserDto,
    actor: Pick<CurrentUser, 'roles'>,
  ): Promise<SafeUser> {
    assertCreatableRoleNames(actor.roles, dto.roleNames);

    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { id: true },
    });

    if (existingUser) {
      throw new BadRequestException('User with this email already exists');
    }

    const roles = await this.prisma.role.findMany({
      where: { name: { in: dto.roleNames } },
      select: { id: true, name: true },
    });

    const foundRoleNames = new Set(roles.map((role) => role.name));
    const missingRoleNames = dto.roleNames.filter(
      (roleName) => !foundRoleNames.has(roleName),
    );

    if (missingRoleNames.length > 0) {
      throw new BadRequestException(
        `Roles not found: ${missingRoleNames.join(', ')}`,
      );
    }

    const passwordHash = await hash(dto.password, PASSWORD_HASH_ROUNDS);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone,
        teamId: dto.teamId,
        managerId: dto.managerId,
        roles: {
          create: roles.map((role) => ({
            role: {
              connect: { id: role.id },
            },
          })),
        },
      },
    });

    return this.excludePasswordHash(user);
  }

  async findByEmail(email: string): Promise<UserWithAuthz | null> {
    return this.prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      include: {
        roles: {
          include: {
            role: {
              include: {
                permissions: {
                  include: {
                    permission: true,
                  },
                },
              },
            },
          },
        },
        permissions: {
          include: {
            permission: true,
          },
        },
      },
    });
  }

  async findById(id: string): Promise<SafeUser | null> {
    const user = await this.prisma.user.findUnique({ where: { id } });

    if (!user) {
      return null;
    }

    return this.excludePasswordHash(user);
  }

  async findAll(filterDto: FilterUserDto = {}): Promise<UserListResult> {
    const page = filterDto.page ?? 1;
    const limit = filterDto.limit ?? 20;
    const where: Prisma.UserWhereInput = {
      ...(filterDto.role && {
        roles: { some: { role: { name: filterDto.role } } },
      }),
      ...(filterDto.search && {
        OR: [
          { firstName: { contains: filterDto.search } },
          { lastName: { contains: filterDto.search } },
          { email: { contains: filterDto.search } },
        ],
      }),
    };

    const [users, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: userListSelect,
      }),
      this.prisma.user.count({ where }),
    ]);

    return { items: users, total, page, limit };
  }

  async updateStatus(id: string, isActive: boolean): Promise<SafeUser> {
    const existingUser = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existingUser) {
      throw new NotFoundException('User not found');
    }

    // Technical disable/enable only. Must not change roles, permissions, or credentials.
    const user = await this.prisma.user.update({
      where: { id },
      data: { isActive },
    });

    return this.excludePasswordHash(user);
  }

  async resetPassword(
    id: string,
    newPassword: string,
    currentUserId: string,
  ): Promise<SafeUser> {
    const existingUser = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        roles: {
          select: {
            role: {
              select: { name: true },
            },
          },
        },
      },
    });

    if (!existingUser) {
      throw new NotFoundException('User not found');
    }

    assertAdministrativePasswordResetAllowed(
      existingUser.roles.map((userRole) => userRole.role.name),
    );

    const passwordHash = await hash(newPassword, PASSWORD_HASH_ROUNDS);

    const user = await this.prisma.$transaction(async (tx) => {
      const updatedUser = await tx.user.update({
        where: { id },
        data: { passwordHash },
      });

      // Все refresh-сессии умирают вместе со сменой пароля
      await tx.session.deleteMany({
        where: { userId: id },
      });

      await tx.auditLog.create({
        data: {
          userId: currentUserId,
          action: 'USER_PASSWORD_RESET',
          entityType: 'User',
          entityId: id,
          newValue: {
            email: existingUser.email,
            resetBy: currentUserId,
          },
        },
      });

      return updatedUser;
    });

    return this.excludePasswordHash(user);
  }

  assertUserModuleAccess(currentUser: Pick<CurrentUser, 'roles'>): void {
    if (!hasUserModuleAccess(currentUser)) {
      throw new ForbiddenException('Access denied');
    }
  }

  async getAuthContext(userId: string): Promise<CurrentUser | null> {
    const user = await this.findAuthUserById(userId);

    if (!user || !user.isActive) {
      return null;
    }

    return this.toCurrentUser(user);
  }

  async findAuthUserById(userId: string): Promise<AuthUserRecord | null> {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        teamId: true,
        managerId: true,
        isActive: true,
        roles: {
          select: {
            role: {
              select: {
                name: true,
              },
            },
          },
        },
      },
    });
  }

  async toCurrentUser(user: AuthUserRecord): Promise<CurrentUser> {
    return {
      id: user.id,
      email: user.email,
      teamId: user.teamId,
      managerId: user.managerId,
      roles: user.roles.map((userRole) => userRole.role.name),
      permissions: await this.getUserPermissions(user.id),
    };
  }

  async getUserPermissions(userId: string): Promise<string[]> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        roles: {
          select: {
            role: {
              select: {
                permissions: {
                  select: {
                    permission: {
                      select: { slug: true },
                    },
                  },
                },
              },
            },
          },
        },
        permissions: {
          select: {
            permission: {
              select: { slug: true },
            },
          },
        },
      },
    });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    const slugs = new Set<string>();

    for (const userRole of user.roles) {
      for (const rolePermission of userRole.role.permissions) {
        slugs.add(rolePermission.permission.slug);
      }
    }

    for (const userPermission of user.permissions) {
      slugs.add(userPermission.permission.slug);
    }

    return Array.from(slugs);
  }

  private excludePasswordHash(user: User): SafeUser {
    const { passwordHash: _passwordHash, ...safeUser } = user;
    void _passwordHash;
    return safeUser;
  }
}
