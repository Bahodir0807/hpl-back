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
exports.AuthService = void 0;
const common_1 = require("@nestjs/common");
const jwt_1 = require("@nestjs/jwt");
const bcryptjs_1 = require("bcryptjs");
const node_crypto_1 = require("node:crypto");
const prisma_service_1 = require("../prisma/prisma.service");
const users_service_1 = require("../users/users.service");
const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
let AuthService = class AuthService {
    jwtService;
    prisma;
    usersService;
    constructor(jwtService, prisma, usersService) {
        this.jwtService = jwtService;
        this.prisma = prisma;
        this.usersService = usersService;
    }
    async login(dto, ip, userAgent) {
        const user = await this.usersService.findByEmail(dto.email);
        if (!user) {
            throw new common_1.UnauthorizedException('Invalid email or password');
        }
        if (!user.isActive) {
            throw new common_1.ForbiddenException('User is inactive');
        }
        const passwordMatches = await (0, bcryptjs_1.compare)(dto.password, user.passwordHash);
        if (!passwordMatches) {
            throw new common_1.UnauthorizedException('Invalid email or password');
        }
        const permissions = await this.usersService.getUserPermissions(user.id);
        const roles = user.roles.map((userRole) => userRole.role.name);
        const tokens = await this.createTokens(user.id, user.email, roles, permissions);
        await this.prisma.$transaction([
            this.prisma.session.create({
                data: {
                    userId: user.id,
                    token: tokens.refreshToken,
                    ipAddress: ip,
                    userAgent,
                    expiresAt: this.getRefreshTokenExpiresAt(),
                },
            }),
            this.prisma.userActivityLog.create({
                data: {
                    userId: user.id,
                    action: 'LOGIN',
                    metadata: {
                        ip,
                        userAgent,
                    },
                },
            }),
            this.prisma.user.update({
                where: { id: user.id },
                data: { lastLoginAt: new Date() },
            }),
        ]);
        return tokens;
    }
    async refreshTokens(refreshToken) {
        const payload = await this.verifyRefreshToken(refreshToken);
        const session = await this.prisma.session.findUnique({
            where: { token: refreshToken },
            include: {
                user: {
                    include: {
                        roles: {
                            include: {
                                role: true,
                            },
                        },
                    },
                },
            },
        });
        if (!session || session.userId !== payload.sub) {
            throw new common_1.UnauthorizedException('Invalid refresh token');
        }
        if (session.expiresAt <= new Date()) {
            await this.prisma.session.delete({ where: { id: session.id } });
            throw new common_1.UnauthorizedException('Refresh token expired');
        }
        if (!session.user.isActive) {
            throw new common_1.ForbiddenException('User is inactive');
        }
        const permissions = await this.usersService.getUserPermissions(session.userId);
        const roles = session.user.roles.map((userRole) => userRole.role.name);
        const tokens = await this.createTokens(session.user.id, session.user.email, roles, permissions);
        await this.prisma.session.update({
            where: { id: session.id },
            data: {
                token: tokens.refreshToken,
                expiresAt: this.getRefreshTokenExpiresAt(),
            },
        });
        return tokens;
    }
    async logout(userId, token) {
        const session = await this.prisma.session.findFirst({
            where: {
                userId,
                token,
            },
            select: { id: true },
        });
        if (!session) {
            throw new common_1.BadRequestException('Session not found');
        }
        await this.prisma.$transaction([
            this.prisma.session.delete({ where: { id: session.id } }),
            this.prisma.userActivityLog.create({
                data: {
                    userId,
                    action: 'LOGOUT',
                    metadata: {
                        sessionId: session.id,
                    },
                },
            }),
        ]);
    }
    async createTokens(userId, email, roles, permissions) {
        const accessPayload = {
            userId,
            sub: userId,
            email,
            roles,
            permissions,
        };
        const refreshPayload = {
            sub: userId,
            jti: (0, node_crypto_1.randomUUID)(),
            type: 'refresh',
        };
        const [accessToken, refreshToken] = await Promise.all([
            this.jwtService.signAsync(accessPayload, {
                secret: this.getJwtSecret('JWT_ACCESS_SECRET'),
                expiresIn: ACCESS_TOKEN_TTL_SECONDS,
            }),
            this.jwtService.signAsync(refreshPayload, {
                secret: this.getJwtSecret('JWT_REFRESH_SECRET'),
                expiresIn: REFRESH_TOKEN_TTL_SECONDS,
            }),
        ]);
        return { accessToken, refreshToken };
    }
    async verifyRefreshToken(refreshToken) {
        try {
            const payload = await this.jwtService.verifyAsync(refreshToken, {
                secret: this.getJwtSecret('JWT_REFRESH_SECRET'),
            });
            if (payload.type !== 'refresh') {
                throw new common_1.UnauthorizedException('Invalid refresh token');
            }
            return payload;
        }
        catch (error) {
            if (error instanceof common_1.UnauthorizedException) {
                throw error;
            }
            throw new common_1.UnauthorizedException('Invalid refresh token');
        }
    }
    getRefreshTokenExpiresAt() {
        return new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000);
    }
    getJwtSecret(envName) {
        const secret = process.env[envName];
        if (!secret) {
            throw new common_1.BadRequestException(`${envName} is not configured`);
        }
        return secret;
    }
};
exports.AuthService = AuthService;
exports.AuthService = AuthService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [jwt_1.JwtService,
        prisma_service_1.PrismaService,
        users_service_1.UsersService])
], AuthService);
//# sourceMappingURL=auth.service.js.map