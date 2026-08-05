import { Type } from 'class-transformer';
import { IsDate, IsString, MinLength } from 'class-validator';

export class RescheduleTaskDto {
  @Type(() => Date)
  @IsDate()
  newDueDate!: Date;

  @IsString()
  @MinLength(1)
  reason!: string;
}
