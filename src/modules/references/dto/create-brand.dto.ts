import { IsString, MaxLength } from 'class-validator';

export class CreateBrandDto {
  @IsString()
  @MaxLength(255)
  name!: string;

  @IsString()
  @MaxLength(64)
  code!: string;
}
