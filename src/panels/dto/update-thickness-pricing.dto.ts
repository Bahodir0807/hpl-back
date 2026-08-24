import {
  IsBoolean,
  IsNumberString,
  IsOptional,
  MaxLength,
} from 'class-validator';

export class UpdateThicknessPricingDto {
  @IsOptional()
  @IsNumberString()
  @MaxLength(32)
  basePricePerM2?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
