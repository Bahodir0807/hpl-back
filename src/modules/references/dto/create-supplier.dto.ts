import { Prisma } from '@prisma/client';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateSupplierDto {
  @IsString()
  @MaxLength(255)
  name!: string;

  @IsString()
  @MaxLength(64)
  code!: string;

  @IsOptional()
  contacts?: Prisma.InputJsonObject;
}
