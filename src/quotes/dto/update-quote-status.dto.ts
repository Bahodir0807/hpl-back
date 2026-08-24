import { IsIn, IsString, MaxLength, ValidateIf } from 'class-validator';
import { QUOTE_STATUS } from '../quote.constants';

const PATCHABLE_STATUSES = [
  QUOTE_STATUS.SENT,
  QUOTE_STATUS.APPROVED,
  QUOTE_STATUS.REJECTED,
] as const;

export class UpdateQuoteStatusDto {
  @IsIn(PATCHABLE_STATUSES)
  status!: (typeof PATCHABLE_STATUSES)[number];

  @ValidateIf(
    (dto: UpdateQuoteStatusDto) => dto.status === QUOTE_STATUS.REJECTED,
  )
  @IsString()
  @MaxLength(1000)
  rejectionReason?: string;
}
