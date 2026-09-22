import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import {
  InstallationContractorType,
  InstallationWorkCategory,
  InstallationWorkUnit,
} from '@prisma/client';

export class CreateInstallationWorkTypeDto {
  @IsString()
  @MaxLength(64)
  code!: string;

  @IsString()
  @MaxLength(256)
  nameRu!: string;

  @IsString()
  @MaxLength(256)
  nameUz!: string;

  @IsString()
  @MaxLength(256)
  nameEn!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @IsEnum(InstallationWorkUnit)
  unit!: InstallationWorkUnit;

  @IsOptional()
  @IsEnum(InstallationWorkCategory)
  category?: InstallationWorkCategory;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateInstallationWorkTypeDto {
  @IsOptional()
  @IsString()
  @MaxLength(256)
  nameRu?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  nameUz?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  nameEn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @IsOptional()
  @IsEnum(InstallationWorkUnit)
  unit?: InstallationWorkUnit;

  @IsOptional()
  @IsEnum(InstallationWorkCategory)
  category?: InstallationWorkCategory;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateInstallationContractorDto {
  @IsString()
  @MaxLength(256)
  name!: string;

  @IsEnum(InstallationContractorType)
  type!: InstallationContractorType;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  contactName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  phone?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsUUID()
  supplierId?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateInstallationContractorDto {
  @IsOptional()
  @IsString()
  @MaxLength(256)
  name?: string;

  @IsOptional()
  @IsEnum(InstallationContractorType)
  type?: InstallationContractorType;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  contactName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  phone?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsUUID()
  supplierId?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateInstallationRateDto {
  @IsUUID()
  contractorId!: string;

  @IsUUID()
  workTypeId!: string;

  @IsEnum(InstallationWorkUnit)
  unit!: InstallationWorkUnit;

  @IsString()
  pricePerUnit!: string;

  @IsString()
  @MaxLength(8)
  currency!: string;

  @IsDateString()
  validFrom!: string;

  @IsOptional()
  @IsDateString()
  validTo?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string | null;
}

export class UpdateInstallationRateDto {
  @IsOptional()
  @IsEnum(InstallationWorkUnit)
  unit?: InstallationWorkUnit;

  @IsOptional()
  @IsString()
  pricePerUnit?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  currency?: string;

  @IsOptional()
  @IsDateString()
  validFrom?: string;

  @IsOptional()
  @IsDateString()
  validTo?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string | null;
}

export class ListInstallationRatesQueryDto {
  @IsOptional()
  @IsUUID()
  contractorId?: string;

  @IsOptional()
  @IsUUID()
  workTypeId?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  includeInactive?: boolean;
}
