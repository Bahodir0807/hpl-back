import { IsUUID } from 'class-validator';

export class AssignEngineerDto {
  @IsUUID()
  engineerId!: string;
}
