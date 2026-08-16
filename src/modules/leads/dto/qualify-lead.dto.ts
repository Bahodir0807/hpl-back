import { Type } from 'class-transformer';
import {
  IsDate,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  Validate,
  ValidateNested,
} from 'class-validator';
import {
  NoCommercialQualificationFieldsConstraint,
  UpsertLeadQualificationDto,
} from './upsert-lead-qualification.dto';

export class QualifyLeadDto {
  @Validate(NoCommercialQualificationFieldsConstraint)
  private readonly commercialIsolationGuard = true;

  @IsUUID()
  clientId!: string;

  @IsUUID()
  projectObjectId!: string;

  @IsString()
  @MinLength(1)
  needDescription!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  estimatedAmount!: number;

  @Type(() => Date)
  @IsDate()
  targetDate!: Date;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  decisionMakerContact!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => UpsertLeadQualificationDto)
  qualification?: UpsertLeadQualificationDto;
}
