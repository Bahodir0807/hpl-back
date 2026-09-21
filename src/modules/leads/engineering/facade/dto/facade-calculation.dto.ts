import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class FacadeCalculateDto {
  @IsString()
  @MaxLength(128)
  configCode!: string;

  @IsString()
  claddingAreaM2!: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  areaSource?: 'ENGINEER_ENTERED' | 'HPL_QUALIFICATION';

  @IsOptional()
  @IsBoolean()
  confirmRecalculate?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  expectedRevision?: number;
}

export class FacadeSaveItemDto {
  @IsUUID()
  id!: string;

  @IsString()
  finalQty!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string | null;
}

export class FacadeSaveDraftDto {
  @IsInt()
  @Min(1)
  expectedRevision!: number;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => FacadeSaveItemDto)
  items?: FacadeSaveItemDto[];
}

export class FacadeAddItemDto {
  @IsUUID()
  materialId!: string;

  @IsString()
  finalQty!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string | null;

  @IsInt()
  @Min(1)
  expectedRevision!: number;
}
