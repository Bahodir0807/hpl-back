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

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  orderedAt?: Date;

  @Type(() => Date)
  @IsDate()
  expectedDate!: Date;

  @IsOptional()
  @IsString()
  comment?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateExpectedReceiptItemDto)
  items!: CreateExpectedReceiptItemDto[];
}
