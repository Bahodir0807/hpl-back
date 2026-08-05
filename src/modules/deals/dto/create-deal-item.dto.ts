import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsPositive, IsUUID, Min } from 'class-validator';

export class CreateDealItemDto {
  @IsUUID()
  productId!: string;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  quantitySheets!: number;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  quantityM2!: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  unitPrice!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  discount?: number;
}
