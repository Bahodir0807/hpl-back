import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

export const FORBIDDEN_STAGE2_PRICING_KEYS = [
  'supplierPrice',
  'supplierPricePerM2',
  'currencyRate',
  'cnyUsdRate',
  'CurrencyRate',
  'coefficient',
  'sellingCoefficient',
  'discount',
  'finalPrice',
  'clientPricePerM2',
  'pricePerM2',
  'totalPrice',
] as const;

@ValidatorConstraint({
  name: 'noStage2PricingFields',
  async: false,
})
export class NoStage2PricingFieldsConstraint
  implements ValidatorConstraintInterface
{
  validate(_: unknown, args: ValidationArguments): boolean {
    const obj = args.object as Record<string, unknown>;
    return FORBIDDEN_STAGE2_PRICING_KEYS.every((key) => obj[key] === undefined);
  }

  defaultMessage(): string {
    return 'Stage-2 commercial qualification cannot include FX, coefficient, supplier price or discount fields';
  }
}

export class UpsertLeadCommercialQualificationDto {
  @Validate(NoStage2PricingFieldsConstraint)
  private readonly pricingIsolationGuard = true;

  @IsUUID()
  supplierId!: string;

  @IsUUID()
  qualityClassId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  decisionComment?: string | null;
}
