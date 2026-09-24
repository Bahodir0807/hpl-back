import { IsUUID } from 'class-validator';

export class QuoteCompositionQueryDto {
  @IsUUID()
  leadId!: string;
}
