import { Type } from 'class-transformer';
import { IsDate, IsNumberString, IsOptional, MaxLength } from 'class-validator';

export class CreateCurrencyRateDto {
  @IsNumberString()
  @MaxLength(32)
  rate!: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  effectiveFrom?: Date;
}
