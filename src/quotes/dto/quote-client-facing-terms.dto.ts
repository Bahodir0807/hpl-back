import { Type } from 'class-transformer';
import {
  IsDate,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

@ValidatorConstraint({ name: 'quoteDayRange', async: false })
class QuoteDayRangeConstraint implements ValidatorConstraintInterface {
  validate(_: unknown, args: ValidationArguments) {
    const dto = args.object as QuoteClientFacingTermsDto;
    const fromKey = args.constraints[0] as
      'productionDaysFrom' | 'deliveryDaysFrom';
    const toKey = args.constraints[1] as 'productionDaysTo' | 'deliveryDaysTo';
    const from = dto[fromKey];
    const to = dto[toKey];
    if (from === undefined && to === undefined) {
      return true;
    }
    if (from === undefined || to === undefined) {
      return false;
    }
    return from > 0 && to > 0 && from <= to;
  }

  defaultMessage(args: ValidationArguments) {
    const fromKey = args.constraints[0] as string;
    return `${fromKey} and matching to-value must both be integers > 0 with from <= to`;
  }
}

/** Client-facing КП table fields. Does not accept documentDate or internal pricing. */
export class QuoteClientFacingTermsDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  commercialNote?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  internalCommercialNote?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  productionTerms?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  deliveryTerms?: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  validUntil?: Date;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  productionDaysFrom?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  productionDaysTo?: number;

  @Validate(QuoteDayRangeConstraint, ['productionDaysFrom', 'productionDaysTo'])
  private readonly productionRangeGuard = true;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  deliveryDaysFrom?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  deliveryDaysTo?: number;

  @Validate(QuoteDayRangeConstraint, ['deliveryDaysFrom', 'deliveryDaysTo'])
  private readonly deliveryRangeGuard = true;
}
