import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsNumberString,
  IsOptional,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { QuoteClientFacingTermsDto } from './quote-client-facing-terms.dto';

export class QuoteItemPurchasePriceDto {
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsOptional()
  @IsUUID()
  calculationId?: string;

  @IsNumberString()
  @Matches(/^(?:\d+)(?:\.\d{1,4})?$/, {
    message:
      'purchasePricePerM2Cny must be a decimal with up to 4 fraction digits',
  })
  @MaxLength(20)
  purchasePricePerM2Cny!: string;
}

export class PreviewQuotePricingDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => QuoteItemPurchasePriceDto)
  items!: QuoteItemPurchasePriceDto[];
}

export class UpdateQuoteApprovedPricingDto extends PreviewQuotePricingDto {}

export class FinalizeQuoteDto extends QuoteClientFacingTermsDto {}
