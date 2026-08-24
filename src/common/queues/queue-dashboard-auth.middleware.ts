import { Injectable, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { NextFunction, Request, Response } from 'express';
import type { Env } from '../../config/env.schema';
import { UsersService } from '../../modules/users/users.service';

type AccessTokenPayload = {
  userId?: string;
  sub?: string;
};

@Injectable()
export class QueueDashboardAuthMiddleware implements NestMiddleware {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<Env, true>,
    private readonly usersService: UsersService,
  ) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    const authorization = req.headers.authorization;

    if (!authorization?.startsWith('Bearer ')) {
      res
        .status(401)
        .json({ message: 'Missing or invalid Authorization header' });
      return;
    }

    const token = authorization.slice('Bearer '.length);

    try {
      const payload = this.jwtService.verify<AccessTokenPayload>(token, {
        secret: this.configService.get('JWT_ACCESS_SECRET', { infer: true }),
      });
      const userId = payload.userId ?? payload.sub;

      if (!userId) {
        res.status(401).json({ message: 'Access token is missing or invalid' });
        return;
      }

      const user = await this.usersService.findAuthUserById(userId);

      if (!user || !user.isActive) {
        res.status(401).json({ message: 'Access token is missing or invalid' });
        return;
      }

      const permissions = await this.usersService.getUserPermissions(user.id);

      if (!permissions.includes('admin:queues')) {
        res.status(403).json({ message: 'Insufficient permissions' });
        return;
      }

      next();
    } catch {
      res.status(401).json({ message: 'Access token is missing or invalid' });
    }
  }
}
