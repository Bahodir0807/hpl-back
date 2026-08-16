import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  // В тестовом окружении (e2e) rate limiting отключён —
  // иначе весь прогон с одного loopback-IP упрётся в 429
  protected async shouldSkip(context: ExecutionContext): Promise<boolean> {
    if (process.env.NODE_ENV === 'test') {
      return true;
    }

    return super.shouldSkip(context);
  }
}
