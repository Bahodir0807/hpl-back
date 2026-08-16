import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdatePanelColorDto {
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
