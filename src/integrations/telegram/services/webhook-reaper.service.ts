import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Queue } from 'bullmq';
import { QUEUE_NAMES } from '../../../common/queues/queue.constants';
import { PrismaService } from '../../../modules/prisma/prisma.service';
import { TelegramUpdateDto } from '../dto/telegram-webhook.dto';
import { IdempotencyService } from './idempotency.service';

const TELEGRAM_SOURCE = 'telegram';
const STUCK_THRESHOLD_MS = 10 * 60 * 1000;
const MAX_REAP_ATTEMPTS = 3;

@Injectable()
export class WebhookReaperService {
  private readonly logger = new Logger(WebhookReaperService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
    @InjectQueue(QUEUE_NAMES.TELEGRAM_INCOMING)
    private readonly queue: Queue<TelegramUpdateDto>,
  ) {}

  @Cron('0 */1 * * *')
  async reapStuckEvents(): Promise<void> {
    const stuckBefore = new Date(Date.now() - STUCK_THRESHOLD_MS);

    const stuck = await this.prisma.inboundWebhookEvent.findMany({
      where: {
        source: TELEGRAM_SOURCE,
        processedAt: null,
        createdAt: { lt: stuckBefore },
      },
    });

    for (const event of stuck) {
      if (event.attempts >= MAX_REAP_ATTEMPTS) {
        await this.idempotency.markProcessed(
          event.id,
          'Max retries exceeded',
        );
        this.logger.warn(
          `Webhook event ${event.id} (${event.externalId}) marked failed after ${MAX_REAP_ATTEMPTS} attempts`,
        );
        continue;
      }

      if (!event.payload) {
        await this.idempotency.markProcessed(
          event.id,
          'Missing payload — cannot requeue',
        );
        this.logger.warn(
          `Webhook event ${event.id} (${event.externalId}) has no payload to requeue`,
        );
        continue;
      }

      await this.queue.add(
        'process-update',
        event.payload as unknown as TelegramUpdateDto,
        { jobId: `telegram-${event.externalId}` },
      );

      await this.prisma.inboundWebhookEvent.update({
        where: { id: event.id },
        data: {
          attempts: { increment: 1 },
          lastAttemptAt: new Date(),
        },
      });

      this.logger.log(
        `Requeued stuck webhook event ${event.id} (${event.externalId}), attempt ${event.attempts + 1}`,
      );
    }
  }
}
