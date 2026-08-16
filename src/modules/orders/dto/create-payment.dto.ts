import {
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
} from 'class-validator';

export class CreatePaymentDto {
  @IsUUID()
  orderId!: string;

  // Сумма — строго строкой, чтобы не терять точность через IEEE-754 number
  @IsString()
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message: 'amount must be a positive decimal string with up to 2 decimals',
  })
  amount!: string;

  @IsOptional()
  @IsDateString()
  paymentDate?: string | Date;

  @IsOptional()
  @IsString()
  comment?: string;

  @IsOptional()
  @IsUUID()
  fileId?: string;
}
