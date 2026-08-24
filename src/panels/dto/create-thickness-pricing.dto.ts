import { Transform } from 'class-transformer';
import { IsNumberString, IsUUID, Matches, MaxLength } from 'class-validator';
import { transformThicknessInput } from '../hpl-thickness';

export class CreateThicknessPricingDto {
  @IsUUID()
  supplierId!: string;

  @IsUUID()
  qualityClassId!: string;

  @IsUUID()
  panelTypeId!: string;

  @Transform(({ value }: { value: unknown }) => transformThicknessInput(value))
  @Matches(/^(?:\d+)(?:\.\d{1,2})?$/, {
    message:
      'thicknessMm must be a positive decimal with up to 2 fraction digits',
  })
  thicknessMm!: string;

  @IsNumberString()
  @MaxLength(32)
  basePricePerM2!: string;
}
