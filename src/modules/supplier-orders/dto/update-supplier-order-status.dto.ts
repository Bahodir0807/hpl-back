import { SupplierOrderStatus } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class UpdateSupplierOrderStatusDto {
  @IsEnum(SupplierOrderStatus)
  status!: SupplierOrderStatus;
}
