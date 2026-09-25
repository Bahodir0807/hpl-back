import { IsOptional, IsString, MaxLength } from 'class-validator';

export class MarkCustomerAcceptedDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
