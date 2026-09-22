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

export class FacadeCommercialOfferSelectionDto {
  @IsUUID()
  itemId!: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsUUID()
  offerId?: string | null;
}

export class PatchFacadeCommercialDto {
  @IsInt()
  @Min(1)
  expectedRevision!: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => FacadeCommercialOfferSelectionDto)
  selections?: FacadeCommercialOfferSelectionDto[];

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

export class SubmitFacadeCommercialDto {
  @IsInt()
  @Min(1)
  expectedRevision!: number;
}

export class ApproveFacadeCommercialDto {
  @IsInt()
  @Min(1)
  expectedRevision!: number;
}

export class RepriceFacadeCommercialDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  expectedRevision?: number;
}
