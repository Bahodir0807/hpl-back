import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Request } from 'express';
import { Observable, map } from 'rxjs';
import { CurrentUser } from '../interfaces/current-user.interface';

const PURCHASE_PRICE_PERMISSION = 'products:read_purchase_price';

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
type JsonObject = {
  [key: string]: JsonValue | undefined;
};

type AuthenticatedRequest = Request & {
  user?: CurrentUser;
};

@Injectable()
export class PurchasePriceInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const permissions = request.user?.permissions ?? [];

    if (permissions.includes(PURCHASE_PRICE_PERMISSION)) {
      return next.handle();
    }

    return next
      .handle()
      .pipe(map((data: unknown): unknown => this.sanitizeUnknown(data)));
  }

  private sanitizeUnknown(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value
        .filter((item) => !this.isPurchasePriceObject(item))
        .map((item) => this.sanitizeUnknown(item));
    }

    if (!this.isJsonObject(value)) {
      return value;
    }

    const sanitized: JsonObject = {};

    for (const [key, nestedValue] of Object.entries(value)) {
      if (key === 'purchasePriceSnapshot' || key === 'margin') {
        continue;
      }

      sanitized[key] = this.sanitizeUnknown(nestedValue) as JsonValue;
    }

    return sanitized;
  }

  private isPurchasePriceObject(value: unknown): boolean {
    return this.isJsonObject(value) && value.type === 'PURCHASE';
  }

  private isJsonObject(value: unknown): value is JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
