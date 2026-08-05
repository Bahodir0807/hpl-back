import { PartialType } from '@nestjs/swagger';
import { CreateProductCollectionDto } from './create-product-collection.dto';

export class UpdateProductCollectionDto extends PartialType(
  CreateProductCollectionDto,
) {}
