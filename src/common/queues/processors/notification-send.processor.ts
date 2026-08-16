import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { QUEUE_NAMES } from '../queue.constants';

@Processor(QUEUE_NAMES.NOTIFICATIONS_SEND)
export class NotificationSendProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationSendProcessor.name);

  async process(job: Job<unknown>): Promise<{ status: string }> {
    this.logger.log(`Processing notification job ${job.id}`);
    // Реализация в PR-3
    return { status: 'ok' };
  }
}
