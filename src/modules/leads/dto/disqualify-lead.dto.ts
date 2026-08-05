import { IsString, MaxLength, MinLength } from 'class-validator';

export class DisqualifyLeadDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  reason!: string;
}
