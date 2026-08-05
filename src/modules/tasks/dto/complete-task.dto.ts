import { Type } from 'class-transformer';
import {
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { CreateTaskDto } from './create-task.dto';

export class CompleteTaskDto {
  @IsString()
  @MinLength(1)
  result!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => CreateTaskDto)
  createNextTask?: CreateTaskDto;
}
