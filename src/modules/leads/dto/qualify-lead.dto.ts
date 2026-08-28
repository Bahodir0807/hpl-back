import { Transform, Type } from 'class-transformer';
import {
  IsDate,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  Validate,
  ValidateIf,
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

  @IsOptional()
  @IsUUID()
  contactId?: string;

  @IsUUID()
  projectObjectId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Transform(({ value }: { value: unknown }) => {
    if (value === undefined) {
      return undefined;
    }
    if (value === null) {
      return null;
    }
    return typeof value === 'string' ? value.trim() : value;
  })
  objectStage?: string | null;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === undefined) {
      return undefined;
    }
    if (value === null || value === '') {
      return null;
    }
    if (value instanceof Date) {
      return value;
    }
    if (typeof value === 'string' || typeof value === 'number') {
      return new Date(value);
    }
    return value;
  })
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsDate()
  objectExpectedDate?: Date | null;

  @IsString()
  @MinLength(1)
  needDescription!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  decisionMakerContact!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => UpsertLeadQualificationDto)
  qualification?: UpsertLeadQualificationDto;
}
