import { ProductPriceType, ProductStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDate,
  IsEnum,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class InitialProductPriceDto {
  @IsEnum(ProductPriceType)
  type!: ProductPriceType;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  validFrom?: Date;
}

export class CreateProductDto {
  @IsString()
  @MaxLength(128)
  sku!: string;

  @IsString()
  @MaxLength(255)
  name!: string;

  @IsUUID()
  brandId!: string;

  @IsOptional()
  @IsUUID()
  collectionId?: string;

  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  decorCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  colorName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  surface?: string;

  @IsNumber()
  @IsPositive()
  thickness!: number;

  @IsNumber()
  @IsPositive()
  length!: number;

  @IsNumber()
  @IsPositive()
  width!: number;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  unit?: string = 'm2';

  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InitialProductPriceDto)
  initialPrices?: InitialProductPriceDto[];
}
