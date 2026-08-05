import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TasksService } from './tasks.service';

@Injectable()
export class TasksCronService {
  private readonly logger = new Logger(TasksCronService.name);

  constructor(private readonly tasksService: TasksService) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async escalateCriticalOverdues(): Promise<void> {
    const createdCount = await this.tasksService.escalateCriticalOverdues();

    if (createdCount > 0) {
      this.logger.log(`Created ${createdCount} critical overdue notifications`);
    }
  }
}
