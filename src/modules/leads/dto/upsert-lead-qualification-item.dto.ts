import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { HplApplication } from '@prisma/client';
import { canonicalizeHplApplication } from '../../../panels/hpl-catalog';
import { transformThicknessInput } from '../../../panels/hpl-thickness';

export class UpsertLeadQualificationItemDto {
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsOptional()
  @IsEnum(HplApplication)
  @Transform(({ value }: { value: unknown }) => {
    if (value === undefined || value === null || value === '') {
      return value;
    }
    return typeof value === 'string'
      ? (canonicalizeHplApplication(value) ?? value)
      : value;
  })
  application?: HplApplication | null;

  @IsOptional()
  @IsUUID()
  panelTypeId?: string | null;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => transformThicknessInput(value))
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @Matches(/^(?:\d+)(?:\.\d{1,2})?$/, {
    message:
      'thicknessMm must be a positive decimal with up to 2 fraction digits',
  })
  thicknessMm?: string | null;

  @IsOptional()
  @IsUUID()
  panelSizeId?: string | null;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === undefined) {
      return undefined;
    }
    if (value === null || value === '') {
      return null;
    }
    return Number(value);
  })
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsInt()
  @Min(1)
  customWidthMm?: number | null;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === undefined) {
      return undefined;
    }
    if (value === null || value === '') {
      return null;
    }
    return Number(value);
  })
  @ValidateIf((_, value) => value !== null && value !== undefined)
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
  @IsString()
  @MaxLength(120)
  @Transform(({ value }: { value: unknown }) => {
    if (value === undefined) {
      return undefined;
    }
    if (value === null || value === '') {
      return null;
    }
    return typeof value === 'string' ? value.trim() : value;
  })
  coating?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(({ value }: { value: unknown }) => {
    if (value === undefined) {
      return undefined;
    }
    if (value === null || value === '') {
      return null;
    }
    return typeof value === 'string' ? value.trim() : value;
  })
  texture?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @IsPositive()
  requiredAreaM2?: number | null;
}
