import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class InstallationCommercialRateSelectionDto {
  @IsUUID()
  itemId!: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsUUID()
  rateId?: string | null;
}

export class PatchInstallationCommercialDto {
  @IsInt()
  @Min(1)
  expectedRevision!: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => InstallationCommercialRateSelectionDto)
  selections?: InstallationCommercialRateSelectionDto[];

  @IsOptional()
  @IsString()
  proposedCustomerAmount?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  proposedCurrency?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  commercialNote?: string | null;
}

export class SubmitInstallationCommercialDto {
  @IsInt()
  @Min(1)
  expectedRevision!: number;
}

export class ApproveInstallationCommercialDto {
  @IsInt()
  @Min(1)
  expectedRevision!: number;
}

export class RepriceInstallationCommercialDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  expectedRevision?: number;
}
