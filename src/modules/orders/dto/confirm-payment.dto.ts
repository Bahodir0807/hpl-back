import { PaymentRecordStatus } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class ConfirmPaymentDto {
  @IsEnum(PaymentRecordStatus)
  status!: PaymentRecordStatus;
}
