import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { QUEUE_NAMES } from '../queue.constants';

@Processor(QUEUE_NAMES.CALCULATIONS_CONVERT)
export class CalculationConvertProcessor extends WorkerHost {
  private readonly logger = new Logger(CalculationConvertProcessor.name);

  async process(job: Job<unknown>): Promise<{ status: string }> {
    this.logger.log(`Stub: calculation convert job ${job.id}`);
    // Активируется в P3
    return { status: 'stub' };
  }
}
