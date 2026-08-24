import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SupplierOrdersService } from './supplier-orders.service';

@Injectable()
export class SupplierOrderRemindersCronService {
  private readonly logger = new Logger(SupplierOrderRemindersCronService.name);

  constructor(private readonly supplierOrdersService: SupplierOrdersService) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async remindReadiness(): Promise<void> {
    const createdCount =
      await this.supplierOrdersService.processReadinessReminders();

    if (createdCount > 0) {
      this.logger.log(
        `Created ${createdCount} supplier readiness reminder notifications`,
      );
    }
  }
}
