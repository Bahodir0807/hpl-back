import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DealPolicyModule } from '../deals/deal-policy.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SupplierOrderRemindersCronService } from './supplier-order-reminders.cron';
import { SupplierOrdersController } from './supplier-orders.controller';
import { SupplierOrdersService } from './supplier-orders.service';

const scheduleImports = process.env.JEST_WORKER_ID
  ? []
  : [ScheduleModule.forRoot()];

@Module({
  imports: [PrismaModule, DealPolicyModule, ...scheduleImports],
  controllers: [SupplierOrdersController],
  providers: [SupplierOrdersService, SupplierOrderRemindersCronService],
  exports: [SupplierOrdersService],
})
export class SupplierOrdersModule {}
