import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { CurrentUser } from '../../../common/interfaces/current-user.interface';
import { UsersService } from '../../users/users.service';

type JwtPayload = {
  userId?: string;
  sub?: string;
  email?: string;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly usersService: UsersService) {
    const secretOrKey = process.env.JWT_ACCESS_SECRET;

    if (!secretOrKey) {
      throw new Error('JWT_ACCESS_SECRET is not configured');
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey,
    });
  }

  async validate(payload: JwtPayload): Promise<CurrentUser> {
    const userId = payload.userId ?? payload.sub;

    if (!userId || !payload.email) {
      throw new UnauthorizedException('Invalid access token payload');
    }

    const user = await this.usersService.findAuthUserById(userId);

    if (!user) {
      throw new UnauthorizedException(
        'Authenticated user no longer exists. Please sign in again.',
      );
    }

    if (!user.isActive) {
      throw new UnauthorizedException('Authenticated user is inactive');
    }

    if (user.email !== payload.email) {
      throw new UnauthorizedException(
        'Access token does not match authenticated user',
      );
    }

    return this.usersService.toCurrentUser(user);
  }
}
