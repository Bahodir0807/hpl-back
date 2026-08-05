"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UsersService = void 0;
const common_1 = require("@nestjs/common");
const bcryptjs_1 = require("bcryptjs");
const prisma_service_1 = require("../prisma/prisma.service");
const PASSWORD_HASH_ROUNDS = 12;
let UsersService = class UsersService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async create(dto) {
        const existingUser = await this.prisma.user.findUnique({
            where: { email: dto.email },
            select: { id: true },
        });
        if (existingUser) {
            throw new common_1.BadRequestException('User with this email already exists');
        }
        const roles = await this.prisma.role.findMany({
            where: { name: { in: dto.roleNames } },
            select: { id: true, name: true },
        });
        const foundRoleNames = new Set(roles.map((role) => role.name));
        const missingRoleNames = dto.roleNames.filter((roleName) => !foundRoleNames.has(roleName));
        if (missingRoleNames.length > 0) {
            throw new common_1.BadRequestException(`Roles not found: ${missingRoleNames.join(', ')}`);
        }
        const passwordHash = await (0, bcryptjs_1.hash)(dto.password, PASSWORD_HASH_ROUNDS);
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
    async findByEmail(email) {
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
    async findById(id) {
        const user = await this.prisma.user.findUnique({ where: { id } });
        if (!user) {
            return null;
        }
        return this.excludePasswordHash(user);
    }
    async findAll() {
        const users = await this.prisma.user.findMany({
            orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
        });
        return users.map((user) => this.excludePasswordHash(user));
    }
    async updateStatus(id, isActive) {
        const existingUser = await this.prisma.user.findUnique({
            where: { id },
            select: { id: true },
        });
        if (!existingUser) {
            throw new common_1.NotFoundException('User not found');
        }
        const user = await this.prisma.user.update({
            where: { id },
            data: { isActive },
        });
        return this.excludePasswordHash(user);
    }
    async resetPassword(id, newPassword, currentUserId) {
        const existingUser = await this.prisma.user.findUnique({
            where: { id },
            select: { id: true, email: true },
        });
        if (!existingUser) {
            throw new common_1.NotFoundException('User not found');
        }
        const passwordHash = await (0, bcryptjs_1.hash)(newPassword, PASSWORD_HASH_ROUNDS);
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
    async getAuthContext(userId) {
        const user = await this.findAuthUserById(userId);
        if (!user || !user.isActive) {
            return null;
        }
        return this.toCurrentUser(user);
    }
    async findAuthUserById(userId) {
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
    async toCurrentUser(user) {
        return {
            id: user.id,
            email: user.email,
            teamId: user.teamId,
            managerId: user.managerId,
            roles: user.roles.map((userRole) => userRole.role.name),
            permissions: await this.getUserPermissions(user.id),
        };
    }
    async getUserPermissions(userId) {
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
            throw new common_1.BadRequestException('User not found');
        }
        const slugs = new Set();
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
    excludePasswordHash(user) {
        const { passwordHash: _passwordHash, ...safeUser } = user;
        void _passwordHash;
        return safeUser;
    }
};
exports.UsersService = UsersService;
exports.UsersService = UsersService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], UsersService);
//# sourceMappingURL=users.service.js.map