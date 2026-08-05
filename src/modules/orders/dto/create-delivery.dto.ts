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

export class CreateDeliveryItemDto {
  @IsUUID()
  orderItemId!: string;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  quantity!: number;
}

export class CreateDeliveryDto {
  @IsUUID()
  orderId!: string;

  @Type(() => Date)
  @IsDate()
  deliveryDate!: Date;

  @IsOptional()
  @IsString()
  recipient?: string;

  @IsOptional()
  @IsString()
  trackingNumber?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateDeliveryItemDto)
  items!: CreateDeliveryItemDto[];
}
