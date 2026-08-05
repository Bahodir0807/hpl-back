import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

export class CheckDuplicatesDto {
  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;

  @IsOptional()
  @IsEmail()
  @Transform(({ value }: { value: string }) => value.toLowerCase().trim())
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  inn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Transform(({ value }: { value: string }) => value.trim())
  name?: string;
}
