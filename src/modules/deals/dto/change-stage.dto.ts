import { DealStage } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  NotEquals,
  IsString,
  MaxLength,
} from 'class-validator';

export class ChangeStageDto {
  @IsEnum(DealStage)
  @NotEquals(DealStage.LOST, {
    message: 'Use the explicit Deal loss action for LOST transitions',
  })
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
