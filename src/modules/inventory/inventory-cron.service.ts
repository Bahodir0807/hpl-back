import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InventoryService } from './inventory.service';

@Injectable()
export class InventoryCronService {
  private readonly logger = new Logger(InventoryCronService.name);

  constructor(private readonly inventoryService: InventoryService) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async handleExpiredReservations(): Promise<void> {
    const releasedCount =
      await this.inventoryService.releaseExpiredReservations();

    if (releasedCount > 0) {
      this.logger.log(`Released ${releasedCount} expired stock reservations`);
    }
  }
}
