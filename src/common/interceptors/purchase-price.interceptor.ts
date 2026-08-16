import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request } from 'express';
import { Observable, map } from 'rxjs';
import { CurrentUser } from '../interfaces/current-user.interface';

const PURCHASE_PRICE_PERMISSION = 'products:read_purchase_price';

const COST_FIELDS = new Set([
  'purchasePrice',
  'purchasePriceSnapshot',
  'margin',
  'marginPercent',
  'supplierPricePerM2',
  'basePricePerM2',
]);

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
    // P0-FIX: preserve Decimal/Date serialization
    if (value instanceof Prisma.Decimal) {
      return value;
    }

    if (value instanceof Date) {
      return value;
    }

    if (Buffer.isBuffer(value)) {
      return value;
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.sanitizeUnknown(item));
    }

    if (!this.isJsonObject(value)) {
      return value;
    }

    const sanitized: JsonObject = {};

    for (const [key, nestedValue] of Object.entries(value)) {
      if (COST_FIELDS.has(key)) {
        continue;
      }

      sanitized[key] = this.sanitizeUnknown(nestedValue) as JsonValue;
    }

    return sanitized;
  }

  private isJsonObject(value: unknown): value is JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
