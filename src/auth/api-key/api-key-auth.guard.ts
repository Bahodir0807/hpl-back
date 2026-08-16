import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { ApiKeyService } from './api-key.service';

type ApiKeyRequest = Request & {
  serviceAccount?: {
    id: string;
    name: string;
    permissions: unknown;
    isActive: boolean;
  };
};

@Injectable()
export class ApiKeyAuthGuard implements CanActivate {
  constructor(private readonly apiKeyService: ApiKeyService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ApiKeyRequest>();
    const token = request.headers['x-api-key'];

    if (!token || typeof token !== 'string') {
      throw new UnauthorizedException('Missing X-API-Key header');
    }

    const account = await this.apiKeyService.findAccountByToken(token);

    if (!account) {
      throw new UnauthorizedException('Invalid API key');
    }

    if (!account.isActive) {
      throw new ForbiddenException('API key is inactive');
    }

    void this.apiKeyService.touchLastUsed(account.id);
    request.serviceAccount = account;
    return true;
  }
}
