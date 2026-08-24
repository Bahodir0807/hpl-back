import { Type } from 'class-transformer';
import { IsDate, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateSupplierOrderDatesDto {
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  expectedReadyAt?: Date;

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
