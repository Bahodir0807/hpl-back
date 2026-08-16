import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Env } from '../../config/env.schema';
import { RoleName } from '@prisma/client';
import { compare, hash } from 'bcryptjs';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
const REFRESH_TOKEN_HASH_ROUNDS = 10;

type AccessTokenPayload = {
  userId: string;
  sub: string;
  email: string;
  roles: RoleName[];
  permissions: string[];
};

type RefreshTokenPayload = {
  sub: string;
  // sid — id сессии (стабилен при ротации), jti — уникален на каждый выпуск,
  // иначе два refresh в одну секунду дадут идентичный токен
  sid: string;
  jti: string;
  type: 'refresh';
};

type AuthTokens = {
  accessToken: string;
  refreshToken: string;
};

type IssuedTokens = AuthTokens & {
  sessionId: string;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly configService: ConfigService<Env, true>,
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

    const passwordMatches = await compare(dto.password, user.passwordHash);

    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!user.isActive) {
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
          id: tokens.sessionId,
          userId: user.id,
          tokenHash: await this.hashRefreshToken(tokens.refreshToken),
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
    // sid — это id сессии: хеш токена нельзя найти запросом, только сравнением
    const session = await this.prisma.session.findUnique({
      where: { id: payload.sid },
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

    const tokenMatches = await this.compareRefreshToken(
      refreshToken,
      session.tokenHash,
    );

    if (!tokenMatches) {
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
      session.id,
    );

    await this.prisma.session.update({
      where: { id: session.id },
      data: {
        tokenHash: await this.hashRefreshToken(tokens.refreshToken),
        expiresAt: this.getRefreshTokenExpiresAt(),
      },
    });

    return tokens;
  }

  async logout(userId: string, token: string): Promise<void> {
    const payload = this.jwtService.decode<Partial<RefreshTokenPayload>>(token);
    const session = payload?.sid
      ? await this.prisma.session.findFirst({
          where: {
            id: payload.sid,
            userId,
          },
          select: { id: true, tokenHash: true },
        })
      : null;

    if (
      !session ||
      !(await this.compareRefreshToken(token, session.tokenHash))
    ) {
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
    sessionId?: string,
  ): Promise<IssuedTokens> {
    const accessPayload: AccessTokenPayload = {
      userId,
      sub: userId,
      email,
      roles,
      permissions,
    };
    const refreshPayload: RefreshTokenPayload = {
      sub: userId,
      sid: sessionId ?? randomUUID(),
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

    return { accessToken, refreshToken, sessionId: refreshPayload.sid };
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

  // bcrypt обрезает вход до 72 байт, а JWT ~250 символов с общим префиксом —
  // поэтому сначала SHA-256 (64 hex-символа), потом bcrypt
  private hashRefreshToken(token: string): Promise<string> {
    return hash(this.sha256(token), REFRESH_TOKEN_HASH_ROUNDS);
  }

  private compareRefreshToken(
    token: string,
    tokenHash: string,
  ): Promise<boolean> {
    return compare(this.sha256(token), tokenHash);
  }

  private sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private getRefreshTokenExpiresAt(): Date {
    return new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000);
  }

  private getJwtSecret(
    envName: 'JWT_ACCESS_SECRET' | 'JWT_REFRESH_SECRET',
  ): string {
    return this.configService.getOrThrow(envName, { infer: true });
  }
}
