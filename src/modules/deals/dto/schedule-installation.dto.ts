import { Type } from 'class-transformer';
import { IsDate } from 'class-validator';

export class ScheduleInstallationDto {
  @Type(() => Date)
  @IsDate()
  expectedInstallationAt!: Date;

  @Type(() => Date)
  @IsDate()
  expectedCompletionAt!: Date;
}
