import { Type } from 'class-transformer';
import {
  IsDate,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateProjectObjectDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  type?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  stage?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  approximateArea?: number;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  expectedDate?: Date;

  @IsOptional()
  @IsUUID()
  decisionMakerContactId?: string;
}
