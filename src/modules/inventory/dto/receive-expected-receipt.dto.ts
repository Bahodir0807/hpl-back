import { Type } from 'class-transformer';
import {
  IsArray,
  IsNumber,
  IsPositive,
  IsUUID,
  ValidateNested,
} from 'class-validator';

export class ReceiveExpectedReceiptItemDto {
  @IsUUID()
  itemId!: string;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  receivedQuantity!: number;
}

export class ReceiveExpectedReceiptDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReceiveExpectedReceiptItemDto)
  items!: ReceiveExpectedReceiptItemDto[];
}
