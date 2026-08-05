import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
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
