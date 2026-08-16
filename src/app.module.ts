import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { BullModule } from '@nestjs/bullmq';
import { TerminusModule } from '@nestjs/terminus';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { CommonModule } from './common/common.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { AppThrottlerGuard } from './common/guards/app-throttler.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { envSchema, type Env } from './config/env.schema';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { ClientsModule } from './modules/clients/clients.module';
import { DealsModule } from './modules/deals/deals.module';
import { FilesModule } from './modules/files/files.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { LeadsModule } from './modules/leads/leads.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { OrdersModule } from './modules/orders/orders.module';
import { PrismaModule } from './modules/prisma/prisma.module';
import { ProductsModule } from './modules/products/products.module';
import { ReferencesModule } from './modules/references/references.module';
import { ReportsModule } from './modules/reports/reports.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { UsersModule } from './modules/users/users.module';
import { QueueModule } from './common/queues/queue.module';
import { TestIntegrationsModule } from './integrations/test/test-integrations.module';
import { TelegramModule } from './integrations/telegram/telegram.module';
import { PanelsModule } from './panels/panels.module';
import { CalculationsModule } from './calculations/calculations.module';
import { QuotesModule } from './quotes/quotes.module';
import { SupplierOrdersModule } from './modules/supplier-orders/supplier-orders.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (config: Record<string, unknown>) => envSchema.parse(config),
    }),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService<Env, true>) => {
        const isTest = process.env.NODE_ENV === 'test';

        return {
          connection: {
            host: configService.get('REDIS_HOST', { infer: true }),
            port: configService.get('REDIS_PORT', { infer: true }),
            password: configService.get('REDIS_PASSWORD', { infer: true }),
            ...(isTest
              ? {
                  lazyConnect: true,
                  maxRetriesPerRequest: 1,
                  connectTimeout: 2_000,
                  retryStrategy: () => null,
                }
              : {}),
          },
          defaultJobOptions: {
            attempts: 3,
            backoff: { type: 'exponential', delay: 2000 },
            removeOnComplete: 100,
            removeOnFail: 50,
          },
        };
      },
      inject: [ConfigService],
    }),
    CommonModule,
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 120 }],
    }),
    TerminusModule,
    PrismaModule,
    AuditModule,
    UsersModule,
    AuthModule,
    ProductsModule,
    ReferencesModule,
    ClientsModule,
    LeadsModule,
    TasksModule,
    DealsModule,
    InventoryModule,
    OrdersModule,
    ReportsModule,
    FilesModule,
    NotificationsModule,
    QueueModule,
    ...(process.env.NODE_ENV === 'test' ? [TestIntegrationsModule] : []),
    TelegramModule,
    PanelsModule,
    CalculationsModule,
    QuotesModule,
    SupplierOrdersModule,
  ],
  controllers: [AppController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: AppThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: PermissionsGuard,
    },
    // Через APP_FILTER, а не useGlobalFilters в main.ts — иначе фильтр не работает в e2e
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
  ],
})
export class AppModule implements NestModule {
  // Через NestModule, а не app.use в main.ts — иначе middleware не работает в e2e
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
