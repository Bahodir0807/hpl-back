import { InjectQueue } from '@nestjs/bullmq';
import { Body, Controller, Post, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import type { Response } from 'express';
import { ApiKeyAuthGuard } from '../../auth/api-key/api-key-auth.guard';
import { ApiKeyPermissionsGuard } from '../../auth/api-key/api-key-permissions.guard';
import { RequireApiKeyPermissions } from '../../auth/api-key/require-api-key-permissions.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { QUEUE_NAMES } from '../../common/queues/queue.constants';
import { TelegramUpdateDto } from './dto/telegram-webhook.dto';
import { IdempotencyService } from './services/idempotency.service';

const TELEGRAM_SOURCE = 'telegram';

@ApiTags('integrations/telegram')
@Public()
@Controller('integrations/telegram')
@UseGuards(ApiKeyAuthGuard, ApiKeyPermissionsGuard)
export class TelegramWebhookController {
  constructor(
    @InjectQueue(QUEUE_NAMES.TELEGRAM_INCOMING)
    private readonly queue: Queue<TelegramUpdateDto>,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Post('webhook')
  @RequireApiKeyPermissions('leads:create')
  @ApiOperation({ summary: 'Telegram bot webhook ingress' })
  async handleWebhook(
    @Body() update: TelegramUpdateDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ status: string }> {
    const externalId = String(update.update_id);
    const existing = await this.idempotency.check(TELEGRAM_SOURCE, externalId);

    if (existing?.processedAt) {
      res.status(200);
      return { status: 'already_processed' };
    }

    if (existing && !existing.processedAt) {
      res.status(202);
      return { status: 'processing' };
    }

    try {
      await this.idempotency.create(TELEGRAM_SOURCE, externalId, update);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const duplicate = await this.idempotency.check(
          TELEGRAM_SOURCE,
          externalId,
        );

        if (duplicate?.processedAt) {
          res.status(200);
          return { status: 'already_processed' };
        }

        res.status(202);
        return { status: 'processing' };
      }

      throw error;
    }

    await this.queue.add('process-update', update, {
      jobId: `telegram-${externalId}`,
    });

    res.status(202);
    return { status: 'accepted' };
  }
}
