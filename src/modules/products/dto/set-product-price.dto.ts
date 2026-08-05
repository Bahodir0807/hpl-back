import { ProductPriceType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsEnum,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

export class SetProductPriceDto {
  @IsEnum(ProductPriceType)
  type!: ProductPriceType;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @Type(() => Date)
  @IsDate()
  validFrom!: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  validTo?: Date;
}
