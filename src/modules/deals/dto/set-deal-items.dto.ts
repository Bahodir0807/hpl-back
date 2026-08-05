import { Type } from 'class-transformer';
import { IsArray, ValidateNested } from 'class-validator';
import { CreateDealItemDto } from './create-deal-item.dto';

export class SetDealItemsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateDealItemDto)
  items!: CreateDealItemDto[];
}
