import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { InstallationQuantitySource } from '@prisma/client';

export class InstallationSaveItemDto {
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsUUID()
  workTypeId!: string;

  @IsString()
  quantity!: string;

  @IsOptional()
  @IsEnum(InstallationQuantitySource)
  quantitySource?: InstallationQuantitySource;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class InstallationSaveDraftDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedRevision?: number;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  note?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => InstallationSaveItemDto)
  items?: InstallationSaveItemDto[];
}

export class InstallationCompleteDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedRevision!: number;
}
