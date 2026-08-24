import { LossReason } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class LoseOpportunityDto {
  @IsEnum(LossReason)
  reason!: LossReason;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}
