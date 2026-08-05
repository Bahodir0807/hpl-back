import { Type } from 'class-transformer';
import {
  IsArray,
  IsDate,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { CreateDealItemDto } from './create-deal-item.dto';

export class CreateDealDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title!: string;

  @IsUUID()
  clientId!: string;

  @IsOptional()
  @IsUUID()
  projectObjectId?: string;

  @IsOptional()
  @IsUUID()
  ownerId?: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  expectedCloseDate?: Date;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateDealItemDto)
  items?: CreateDealItemDto[];
}
