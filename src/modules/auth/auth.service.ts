import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { RoleName } from '@prisma/client';
import { compare } from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

type AccessTokenPayload = {
  userId: string;
  sub: string;
  email: string;
  roles: RoleName[];
  permissions: string[];
};

type RefreshTokenPayload = {
  sub: string;
  jti: string;
  type: 'refresh';
};

type AuthTokens = {
  accessToken: string;
  refreshToken: string;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
  ) {}

  async login(
    dto: LoginDto,
    ip: string | undefined,
    userAgent: string | undefined,
  ): Promise<AuthTokens> {
    const user = await this.usersService.findByEmail(dto.email);

    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!user.isActive) {
      throw new ForbiddenException('User is inactive');
    }

    const passwordMatches = await compare(dto.password, user.passwordHash);

    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const permissions = await this.usersService.getUserPermissions(user.id);
    const roles = user.roles.map((userRole) => userRole.role.name);
    const tokens = await this.createTokens(
      user.id,
      user.email,
      roles,
      permissions,
    );

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

  async refreshTokens(refreshToken: string): Promise<AuthTokens> {
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
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (session.expiresAt <= new Date()) {
      await this.prisma.session.delete({ where: { id: session.id } });
      throw new UnauthorizedException('Refresh token expired');
    }

    if (!session.user.isActive) {
      throw new ForbiddenException('User is inactive');
    }

    const permissions = await this.usersService.getUserPermissions(
      session.userId,
    );
    const roles = session.user.roles.map((userRole) => userRole.role.name);
    const tokens = await this.createTokens(
      session.user.id,
      session.user.email,
      roles,
      permissions,
    );

    await this.prisma.session.update({
      where: { id: session.id },
      data: {
        token: tokens.refreshToken,
        expiresAt: this.getRefreshTokenExpiresAt(),
      },
    });

    return tokens;
  }

  async logout(userId: string, token: string): Promise<void> {
    const session = await this.prisma.session.findFirst({
      where: {
        userId,
        token,
      },
      select: { id: true },
    });

    if (!session) {
      throw new BadRequestException('Session not found');
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

  private async createTokens(
    userId: string,
    email: string,
    roles: RoleName[],
    permissions: string[],
  ): Promise<AuthTokens> {
    const accessPayload: AccessTokenPayload = {
      userId,
      sub: userId,
      email,
      roles,
      permissions,
    };
    const refreshPayload: RefreshTokenPayload = {
      sub: userId,
      jti: randomUUID(),
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

  private async verifyRefreshToken(
    refreshToken: string,
  ): Promise<RefreshTokenPayload> {
    try {
      const payload = await this.jwtService.verifyAsync<RefreshTokenPayload>(
        refreshToken,
        {
          secret: this.getJwtSecret('JWT_REFRESH_SECRET'),
        },
      );

      if (payload.type !== 'refresh') {
        throw new UnauthorizedException('Invalid refresh token');
      }

      return payload;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }

      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  private getRefreshTokenExpiresAt(): Date {
    return new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000);
  }

  private getJwtSecret(
    envName: 'JWT_ACCESS_SECRET' | 'JWT_REFRESH_SECRET',
  ): string {
    const secret = process.env[envName];

    if (!secret) {
      throw new BadRequestException(`${envName} is not configured`);
    }

    return secret;
  }
}
