import { Transform } from 'class-transformer';
import {
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  Validate,
  ValidateIf,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import {
  parseThicknessMm,
  transformThicknessInput,
} from '../../panels/hpl-thickness';

export function resolveThicknessMm(dto: {
  thicknessMm?: string | number | null;
  thickness?: string | number | null;
}): string | number | undefined {
  if (dto.thicknessMm !== undefined && dto.thicknessMm !== null) {
    return dto.thicknessMm;
  }
  if (dto.thickness !== undefined && dto.thickness !== null) {
    return dto.thickness;
  }
  return undefined;
}

@ValidatorConstraint({ name: 'catalogPreviewRequired', async: false })
class CatalogPreviewRequiredConstraint implements ValidatorConstraintInterface {
  validate(_: unknown, args: ValidationArguments) {
    const dto = args.object as PreviewCalculationDto;
    if (dto.leadId) {
      return true;
    }

    const thicknessMm = parseThicknessMm(resolveThicknessMm(dto));
    return Boolean(
      dto.panelTypeId &&
      dto.panelSizeId &&
      dto.supplierId &&
      dto.qualityClassId &&
      dto.requiredAreaM2 &&
      thicknessMm,
    );
  }

  defaultMessage() {
    return 'Catalog preview requires panelTypeId, panelSizeId, thicknessMm, supplierId, qualityClassId and requiredAreaM2';
  }
}

@ValidatorConstraint({ name: 'customDimensionsPair', async: false })
class CustomDimensionsPairConstraint implements ValidatorConstraintInterface {
  validate(_: unknown, args: ValidationArguments) {
    const dto = args.object as CalculationItemDto;
    const widthPresent =
      dto.customWidthMm !== undefined && dto.customWidthMm !== null;
    const heightPresent =
      dto.customHeightMm !== undefined && dto.customHeightMm !== null;
    return widthPresent === heightPresent;
  }

  defaultMessage() {
    return 'customWidthMm and customHeightMm must be provided together';
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
  @Transform(({ value }: { value: unknown }) => transformThicknessInput(value))
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @Matches(/^(?:\d+)(?:\.\d{1,2})?$/, {
    message:
      'thickness must be a positive decimal with up to 2 fraction digits',
  })
  thickness?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => transformThicknessInput(value))
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @Matches(/^(?:\d+)(?:\.\d{1,2})?$/, {
    message:
      'thicknessMm must be a positive decimal with up to 2 fraction digits',
  })
  thicknessMm?: string;

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
  @IsString()
  @MaxLength(64)
  colorCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  colorName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Transform(({ value }: { value: unknown }) => {
    if (value === undefined) {
      return undefined;
    }
    if (value === null || value === '') {
      return undefined;
    }
    return typeof value === 'string' ? value.trim() : value;
  })
  decor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  coating?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  texture?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  customTypeDescription?: string;

  @Validate(CustomDimensionsPairConstraint)
  private readonly customDimensionsGuard = true;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value == null || value === '') {
      return undefined;
    }
    if (typeof value === 'number' || typeof value === 'string') {
      return Number(value);
    }
    return value;
  })
  @IsInt()
  @Min(1)
  customWidthMm?: number;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value == null || value === '') {
      return undefined;
    }
    if (typeof value === 'number' || typeof value === 'string') {
      return Number(value);
    }
    return value;
  })
  @IsInt()
  @Min(1)
  customHeightMm?: number;

  // Optional for backwards-compatible payloads. Backend ignores this and
  // computes sheetsCount from panel size × requiredAreaM2.
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value == null || value === '') {
      return undefined;
    }
    if (typeof value === 'number' || typeof value === 'string') {
      return Number(value);
    }
    return value;
  })
  @IsInt()
  @Min(0)
  sheetsCount?: number;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value == null) {
      return value;
    }
    if (typeof value === 'string' || typeof value === 'number') {
      return String(value);
    }
    return value;
  })
  @IsNumberString()
  @Matches(/^(?:\d+)(?:\.\d{1,4})?$/, {
    message:
      'requiredAreaM2 must be a non-negative decimal with up to 4 fraction digits',
  })
  @MaxLength(20)
  requiredAreaM2?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value == null || value === '') {
      return undefined;
    }
    if (typeof value === 'string' || typeof value === 'number') {
      return String(value);
    }
    return undefined;
  })
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsNumberString()
  @Matches(/^(?:\d+)(?:\.\d{1,4})?$/, {
    message:
      'purchasePricePerM2Cny must be a positive decimal with up to 4 fraction digits',
  })
  @MaxLength(20)
  purchasePricePerM2Cny?: string;
}

export class PreviewCalculationDto extends CalculationItemDto {
  @Validate(CatalogPreviewRequiredConstraint)
  private readonly catalogPreviewGuard = true;

  @IsOptional()
  @IsUUID()
  leadId?: string;
}
