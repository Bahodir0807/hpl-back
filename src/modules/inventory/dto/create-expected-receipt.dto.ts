import { Type } from 'class-transformer';
import {
  IsArray,
  IsDate,
  IsNumber,
  IsOptional,
  IsPositive,
  IsUUID,
  ValidateNested,
} from 'class-validator';

export class CreateExpectedReceiptItemDto {
  @IsUUID()
  productId!: string;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  quantity!: number;
}

export class CreateExpectedReceiptDto {
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @Type(() => Date)
  @IsDate()
  expectedDate!: Date;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateExpectedReceiptItemDto)
  items!: CreateExpectedReceiptItemDto[];
}
