import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDate,
  IsNumberString,
  IsString,
  IsUUID,
  Matches,
  ValidateNested,
} from 'class-validator';

export class SalesPlanFxRateDto {
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  fromCurrency!: string;

  @IsNumberString()
  @Matches(/^(?!0+(?:\.0+)?$)\d+(?:\.\d{1,8})?$/)
  rateToPlanCurrency!: string;
}

export class UpsertSalesPlanDto {
  @IsUUID()
  userId!: string;

  @Type(() => Date)
  @IsDate()
  period!: Date;

  @IsNumberString()
  @Matches(/^(?!0+(?:\.0+)?$)\d+(?:\.\d{1,2})?$/)
  targetAmount!: string;

  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currencyCode!: string;

  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => SalesPlanFxRateDto)
  fxRates!: SalesPlanFxRateDto[];
}
