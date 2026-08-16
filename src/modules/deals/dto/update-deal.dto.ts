import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateDealDto } from './create-deal.dto';

// ownerId исключён: переназначение владельца сделки через update запрещено
export class UpdateDealDto extends PartialType(
  OmitType(CreateDealDto, ['ownerId'] as const),
) {}
