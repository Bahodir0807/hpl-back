import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ServiceAccount } from '@prisma/client';
import { Request } from 'express';
import { parseServiceAccountPermissions } from './api-key-token.util';
import { API_KEY_PERMISSIONS_KEY } from './require-api-key-permissions.decorator';

type ApiKeyRequest = Request & {
  serviceAccount?: ServiceAccount;
};

@Injectable()
export class ApiKeyPermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(
      API_KEY_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<ApiKeyRequest>();
    const account = request.serviceAccount;

    if (!account) {
      throw new ForbiddenException('Service account not authenticated');
    }

    const permissions = parseServiceAccountPermissions(account.permissions);
    const hasAll = required.every((permission) =>
      permissions.includes(permission),
    );

    if (!hasAll) {
      throw new ForbiddenException(
        `Required permissions: ${required.join(', ')}`,
      );
    }

    return true;
  }
}
