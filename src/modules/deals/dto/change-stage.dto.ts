import { DealStage } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class ChangeStageDto {
  @IsEnum(DealStage)
  newStage!: DealStage;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  lossReason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  competitorName?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isException?: boolean;
}
