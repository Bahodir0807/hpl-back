import { Type } from 'class-transformer';
import {
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { QuoteClientFacingTermsDto } from './quote-client-facing-terms.dto';

export class ConvertCalculationToQuoteDto extends QuoteClientFacingTermsDto {
  /** Required when converting a manager CalculationRequest; ignored for legacy priced calculations. */
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  clientComment?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  deliveryCost?: number;
}
