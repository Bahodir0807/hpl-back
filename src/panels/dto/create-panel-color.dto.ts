import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

export function resolvePanelColorCode(dto: {
  code?: string;
  colorCode?: string;
}): string | undefined {
  const value = dto.colorCode ?? dto.code;
  return typeof value === 'string' ? value.trim() : undefined;
}

export function resolvePanelColorName(dto: {
  name?: string;
  colorName?: string;
}): string | undefined {
  const value = dto.colorName ?? dto.name;
  return typeof value === 'string' ? value.trim() : undefined;
}

@ValidatorConstraint({ name: 'panelColorFields', async: false })
class PanelColorFieldsConstraint implements ValidatorConstraintInterface {
  validate(_: unknown, args: ValidationArguments) {
    const dto = args.object as CreatePanelColorDto;
    const colorCode = resolvePanelColorCode(dto);
    const colorName = resolvePanelColorName(dto);

    return Boolean(
      colorCode &&
      colorCode.length <= 50 &&
      colorName &&
      colorName.length <= 100,
    );
  }

  defaultMessage() {
    return 'colorCode (or code) and colorName (or name) are required strings';
  }
}

export class CreatePanelColorDto {
  @IsUUID()
  @Validate(PanelColorFieldsConstraint)
  supplierId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  colorCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  colorName?: string;
}
