import { createParamDecorator } from '@nestjs/common';
import { Request } from 'express';
import type { CurrentUser } from '../interfaces/current-user.interface';

type AuthenticatedRequest = Request & {
  user?: CurrentUser;
};

export const CurrentUserDecorator = createParamDecorator<
  keyof CurrentUser | undefined,
  CurrentUser | CurrentUser[keyof CurrentUser] | undefined
>((data, ctx): CurrentUser | CurrentUser[keyof CurrentUser] | undefined => {
  const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
  const user = request.user;

  if (!user) {
    return undefined;
  }

  return data ? user[data] : user;
});

export { CurrentUserDecorator as CurrentUser };
