import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Permission, RoleName, User } from '@prisma/client';
import { hash } from 'bcryptjs';
import type { CurrentUser } from '../../common/interfaces/current-user.interface';
import { PrismaService } from '../prisma/prisma.service';
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

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: RegisterUserDto): Promise<SafeUser> {
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

  async findAll(): Promise<SafeUser[]> {
    const users = await this.prisma.user.findMany({
      orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
    });

    return users.map((user) => this.excludePasswordHash(user));
  }

  async updateStatus(id: string, isActive: boolean): Promise<SafeUser> {
    const existingUser = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existingUser) {
      throw new NotFoundException('User not found');
    }

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
      select: { id: true, email: true },
    });

    if (!existingUser) {
      throw new NotFoundException('User not found');
    }

    const passwordHash = await hash(newPassword, PASSWORD_HASH_ROUNDS);

    const user = await this.prisma.$transaction(async (tx) => {
      const updatedUser = await tx.user.update({
        where: { id },
        data: { passwordHash },
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
