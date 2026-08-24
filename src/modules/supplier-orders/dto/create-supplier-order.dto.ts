import { Type } from 'class-transformer';
import {
  IsDate,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateSupplierOrderDto {
  @IsUUID()
  supplierId!: string;

  @Type(() => Date)
  @IsDate()
  orderedAt!: Date;

  @Type(() => Date)
  @IsDate()
  expectedReadyAt!: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  expectedShipmentAt?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  expectedArrivalAt?: Date;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  comment?: string;
}
