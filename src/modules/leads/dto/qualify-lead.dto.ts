import { Type } from 'class-transformer';
import {
  IsDate,
  IsNumber,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class QualifyLeadDto {
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
}
