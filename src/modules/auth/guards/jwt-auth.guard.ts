import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    return super.canActivate(context);
  }

  handleRequest<TUser = unknown>(
    error: unknown,
    user: TUser,
    info: unknown,
  ): TUser {
    if (error) {
      throw error;
    }

    if (!user) {
      throw new UnauthorizedException(this.getUnauthorizedMessage(info));
    }

    return user;
  }

  private getUnauthorizedMessage(info: unknown): string {
    if (info instanceof Error) {
      if (info.name === 'TokenExpiredError') {
        return 'Access token expired. Please refresh or sign in again.';
      }

      if (info.message) {
        return info.message;
      }
    }

    return 'Access token is missing or invalid';
  }
}
