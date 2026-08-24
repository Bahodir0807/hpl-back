import { Transform } from 'class-transformer';
import {
  IsString,
  MaxLength,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

export const FORBIDDEN_MANAGER_NOTE_PRICING_KEYS = [
  'purchasePricePerM2Cny',
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
  name: 'noManagerNotePricingFields',
  async: false,
})
export class NoManagerNotePricingFieldsConstraint implements ValidatorConstraintInterface {
  validate(_: unknown, args: ValidationArguments): boolean {
    const obj = args.object as Record<string, unknown>;
    return FORBIDDEN_MANAGER_NOTE_PRICING_KEYS.every(
      (key) => obj[key] === undefined,
    );
  }

  defaultMessage(): string {
    return 'Manager commercial note cannot include FX, coefficient, supplier price or purchase-price fields';
  }
}

export class UpdateLeadManagerCommercialNoteDto {
  @Validate(NoManagerNotePricingFieldsConstraint)
  private readonly pricingIsolationGuard = true;

  @IsString()
  @MaxLength(2000)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  commercialNote!: string;
}
