import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateInstallationAssessmentDto {
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  assessmentComment?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  workComment?: string;
}
