import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { HplApplication } from '@prisma/client';

export const FORBIDDEN_COMMERCIAL_QUALIFICATION_KEYS = [
  'supplierId',
  'supplierPrice',
  'supplierPricePerM2',
  'currencyRate',
  'cnyUsdRate',
  'CurrencyRate',
  'coefficient',
  'sellingCoefficient',
  'discount',
  'finalPrice',
  'qualityClassId',
  'clientPricePerM2',
  'pricePerM2',
  'totalPrice',
] as const;

@ValidatorConstraint({
  name: 'noCommercialQualificationFields',
  async: false,
})
export class NoCommercialQualificationFieldsConstraint
  implements ValidatorConstraintInterface
{
  validate(_: unknown, args: ValidationArguments): boolean {
    const obj = args.object as Record<string, unknown>;
    return FORBIDDEN_COMMERCIAL_QUALIFICATION_KEYS.every(
      (key) => obj[key] === undefined,
    );
  }

  defaultMessage(): string {
    return 'Stage-1 qualification cannot include supplier, price, FX, coefficient or discount fields';
  }
}

export class UpsertLeadQualificationDto {
  @Validate(NoCommercialQualificationFieldsConstraint)
  private readonly commercialIsolationGuard = true;

  @IsOptional()
  @IsEnum(HplApplication)
  application?: HplApplication | null;

  @IsOptional()
  @IsUUID()
  panelTypeId?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  thicknessMm?: number | null;

  @IsOptional()
  @IsUUID()
  panelSizeId?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  customWidthMm?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  customHeightMm?: number | null;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  colorCode?: string | null;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  colorName?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @IsPositive()
  requiredAreaM2?: number | null;

  @IsOptional()
  @IsBoolean()
  installationRequired?: boolean | null;

  @IsOptional()
  @IsBoolean()
  stockOnly?: boolean | null;

  @IsOptional()
  @IsBoolean()
  urgent?: boolean | null;

  @IsOptional()
  @IsBoolean()
  willingToWait?: boolean | null;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  customerRequirements?: string | null;
}
