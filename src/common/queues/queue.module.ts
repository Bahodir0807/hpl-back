import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { BullBoardModule } from '@bull-board/nestjs';
import { ExpressAdapter } from '@bull-board/express';
import { BullModule } from '@nestjs/bullmq';
import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ApiKeyModule } from '../../auth/api-key/api-key.module';
import { UsersModule } from '../../modules/users/users.module';
import { CalculationConvertProcessor } from './processors/calculation-convert.processor';
import { NotificationSendProcessor } from './processors/notification-send.processor';
import { QUEUE_NAMES } from './queue.constants';
import { QueueDashboardAuthMiddleware } from './queue-dashboard-auth.middleware';

const defaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 2000 },
  removeOnComplete: 100,
  removeOnFail: 50,
};

const workerProviders =
  process.env.ENABLE_QUEUE_WORKERS === 'false'
    ? []
    : [NotificationSendProcessor, CalculationConvertProcessor];

@Module({
  imports: [
    ApiKeyModule,
    UsersModule,
    JwtModule.register({}),
    BullModule.registerQueue(
      {
        name: QUEUE_NAMES.TELEGRAM_INCOMING,
        defaultJobOptions,
      },
      {
        name: QUEUE_NAMES.TELEGRAM_ASSIGN_FALLBACK,
        defaultJobOptions,
      },
      {
        name: QUEUE_NAMES.NOTIFICATIONS_SEND,
        defaultJobOptions,
      },
      {
        name: QUEUE_NAMES.CALCULATIONS_CONVERT,
        defaultJobOptions,
      },
    ),
    BullBoardModule.forRoot({
      route: '/admin/queues',
      adapter: ExpressAdapter,
    }),
    BullBoardModule.forFeature(
      {
        name: QUEUE_NAMES.TELEGRAM_INCOMING,
        adapter: BullMQAdapter,
      },
      {
        name: QUEUE_NAMES.TELEGRAM_ASSIGN_FALLBACK,
        adapter: BullMQAdapter,
      },
      {
        name: QUEUE_NAMES.NOTIFICATIONS_SEND,
        adapter: BullMQAdapter,
      },
      {
        name: QUEUE_NAMES.CALCULATIONS_CONVERT,
        adapter: BullMQAdapter,
      },
    ),
  ],
  providers: [QueueDashboardAuthMiddleware, ...workerProviders],
  exports: [BullModule, ApiKeyModule],
})
export class QueueModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(QueueDashboardAuthMiddleware)
      .forRoutes(
        { path: 'admin/queues', method: RequestMethod.ALL },
        { path: 'admin/queues/(.*)', method: RequestMethod.ALL },
      );
  }
}
