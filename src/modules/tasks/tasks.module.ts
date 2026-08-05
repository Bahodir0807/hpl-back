import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TasksController } from './tasks.controller';
import { TasksCronService } from './tasks-cron.service';
import { TasksService } from './tasks.service';

const scheduleImports = process.env.JEST_WORKER_ID
  ? []
  : [ScheduleModule.forRoot()];

@Module({
  imports: scheduleImports,
  controllers: [TasksController],
  providers: [TasksService, TasksCronService],
  exports: [TasksService],
})
export class TasksModule {}
