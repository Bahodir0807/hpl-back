import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '../prisma/prisma.module';
import { InventoryController } from './inventory.controller';
import { InventoryCronService } from './inventory-cron.service';
import { InventoryService } from './inventory.service';
import { ReserveTtlTask } from './tasks/reserve-ttl.task';

const scheduleImports = process.env.JEST_WORKER_ID
  ? []
  : [ScheduleModule.forRoot()];

@Module({
  imports: [PrismaModule, ...scheduleImports],
  controllers: [InventoryController],
  providers: [InventoryService, InventoryCronService, ReserveTtlTask],
  exports: [InventoryService],
})
export class InventoryModule {}
