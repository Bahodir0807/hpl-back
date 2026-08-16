import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsNumberString,
  IsOptional,
  IsUUID,
  MaxLength,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

export function resolveThicknessMm(dto: {
  thicknessMm?: number;
  thickness?: number;
}): number | undefined {
  return dto.thicknessMm ?? dto.thickness;
}

@ValidatorConstraint({ name: 'thicknessMmRequired', async: false })
class ThicknessMmConstraint implements ValidatorConstraintInterface {
  validate(_: unknown, args: ValidationArguments) {
    const thicknessMm = resolveThicknessMm(
      args.object as { thicknessMm?: number; thickness?: number },
    );
    return Number.isInteger(thicknessMm) && (thicknessMm as number) > 0;
  }

  defaultMessage() {
    return 'thicknessMm (or thickness) must be a positive integer';
  }
}

export class CalculationItemDto {
  @IsUUID()
  @Validate(ThicknessMmConstraint)
  panelTypeId!: string;

  @IsUUID()
  panelSizeId!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  thickness?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  thicknessMm?: number;

  @IsUUID()
  supplierId!: string;

  @IsUUID()
  qualityClassId!: string;

  @IsOptional()
  @IsUUID()
  colorId?: string;

  @Transform(({ value }: { value: unknown }) =>
    value == null ? value : String(value),
  )
  @IsNumberString()
  @MaxLength(20)
  requiredAreaM2!: string;
}

export class PreviewCalculationDto extends CalculationItemDto {
  @IsOptional()
  @IsUUID()
  leadId?: string;
}
