import { IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateProductCollectionDto {
  @IsString()
  @MaxLength(255)
  name!: string;

  @IsUUID()
  brandId!: string;
}
