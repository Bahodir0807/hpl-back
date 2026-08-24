import { Type } from 'class-transformer';
import {
  IsArray,
  IsDate,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

export class UpdateWarehousePurchaseItemDto {
  @IsUUID()
  itemId!: string;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  orderedQuantity!: number;
}

export class UpdateWarehousePurchaseDto {
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  expectedDate?: Date;

  @IsOptional()
  @IsString()
  comment?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateWarehousePurchaseItemDto)
  items?: UpdateWarehousePurchaseItemDto[];
}
