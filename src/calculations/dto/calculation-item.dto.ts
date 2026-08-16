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

@ValidatorConstraint({ name: 'catalogPreviewRequired', async: false })
class CatalogPreviewRequiredConstraint implements ValidatorConstraintInterface {
  validate(_: unknown, args: ValidationArguments) {
    const dto = args.object as PreviewCalculationDto;
    if (dto.leadId) {
      return true;
    }

    const thicknessMm = resolveThicknessMm(dto);
    return Boolean(
      dto.panelTypeId &&
        dto.panelSizeId &&
        dto.supplierId &&
        dto.qualityClassId &&
        dto.requiredAreaM2 &&
        Number.isInteger(thicknessMm) &&
        (thicknessMm as number) > 0,
    );
  }

  defaultMessage() {
    return 'Catalog preview requires panelTypeId, panelSizeId, thicknessMm, supplierId, qualityClassId and requiredAreaM2';
  }
}

export class CalculationItemDto {
  @IsOptional()
  @IsUUID()
  panelTypeId?: string;

  @IsOptional()
  @IsUUID()
  panelSizeId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  thickness?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  thicknessMm?: number;

  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @IsOptional()
  @IsUUID()
  qualityClassId?: string;

  @IsOptional()
  @IsUUID()
  colorId?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value == null ? value : String(value),
  )
  @IsNumberString()
  @MaxLength(20)
  requiredAreaM2?: string;
}

export class PreviewCalculationDto extends CalculationItemDto {
  @Validate(CatalogPreviewRequiredConstraint)
  private readonly catalogPreviewGuard = true;

  @IsOptional()
  @IsUUID()
  leadId?: string;
}
