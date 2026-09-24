import { Type } from 'class-transformer';
import { IsBoolean, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { QuoteClientFacingTermsDto } from './quote-client-facing-terms.dto';

export class ConvertCalculationToQuoteDto extends QuoteClientFacingTermsDto {
  /**
   * Deprecated. Request → QuoteDraft uses CalculationLineItem.supplierId only.
   * Accepted for API compatibility and ignored: it never fills missing items
   * and never overrides per-item suppliers.
   */
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

  @IsOptional()
  @IsBoolean()
  acknowledgeStaleComponents?: boolean;
}
