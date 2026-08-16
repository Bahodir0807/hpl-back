import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_NAMES } from '../../common/queues/queue.constants';
import { TelegramAdminHandlerService } from './services/telegram-admin-handler.service';
import type { TelegramAssignFallbackJob } from './telegram.types';

@Processor(QUEUE_NAMES.TELEGRAM_ASSIGN_FALLBACK, { concurrency: 1 })
export class TelegramAssignFallbackProcessor extends WorkerHost {
  private readonly logger = new Logger(TelegramAssignFallbackProcessor.name);

  constructor(
    private readonly adminHandler: TelegramAdminHandlerService,
  ) {
    super();
  }

  async process(job: Job<TelegramAssignFallbackJob>): Promise<{ status: string }> {
    this.logger.log(`Fallback assign for lead ${job.data.leadId}`);
    await this.adminHandler.assignLeastLoadedManager(job.data.leadId);
    return { status: 'ok' };
  }
}
