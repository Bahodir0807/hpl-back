import { TaskPriority, TaskType } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsDate,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateTaskDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  @Transform(({ value }: { value: string }) => value.trim())
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsEnum(TaskType)
  type!: TaskType;

  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @Type(() => Date)
  @IsDate()
  dueDate!: Date;

  @IsUUID()
  assigneeId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  relatedType!: string;

  @IsUUID()
  relatedId!: string;
}
