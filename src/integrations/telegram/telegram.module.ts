import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ApiKeyModule } from '../../auth/api-key/api-key.module';
import { QueueModule } from '../../common/queues/queue.module';
import { NotificationsModule } from '../../modules/notifications/notifications.module';
import { PrismaModule } from '../../modules/prisma/prisma.module';
import { IdempotencyService } from './services/idempotency.service';
import { TelegramAdminHandlerService } from './services/telegram-admin-handler.service';
import { TelegramBotService } from './services/telegram-bot.service';
import { TelegramEscalationService } from './services/telegram-escalation.service';
import { TelegramLeadFactory } from './services/telegram-lead-factory.service';
import { TelegramPollingService } from './services/telegram-polling.service';
import { WebhookReaperService } from './services/webhook-reaper.service';
import { TelegramIncomingProcessor } from './telegram-incoming.processor';
import { TelegramAssignFallbackProcessor } from './telegram-assign-fallback.processor';
import { TelegramWebhookController } from './telegram-webhook.controller';

const telegramWorkerProviders =
  process.env.ENABLE_QUEUE_WORKERS === 'false'
    ? []
    : [TelegramIncomingProcessor, TelegramAssignFallbackProcessor];

@Module({
  imports: [
    HttpModule,
    ConfigModule,
    PrismaModule,
    ApiKeyModule,
    QueueModule,
    NotificationsModule,
    ScheduleModule.forRoot(),
  ],
  controllers: [TelegramWebhookController],
  providers: [
    IdempotencyService,
    TelegramLeadFactory,
    TelegramBotService,
    TelegramAdminHandlerService,
    TelegramEscalationService,
    TelegramPollingService,
    WebhookReaperService,
    ...telegramWorkerProviders,
  ],
  exports: [
    TelegramBotService,
    TelegramLeadFactory,
    TelegramAdminHandlerService,
    IdempotencyService,
  ],
})
export class TelegramModule {}
