import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export enum FileRelatedType {
  CLIENT = 'CLIENT',
  DEAL = 'DEAL',
  ORDER = 'ORDER',
  PRODUCT = 'PRODUCT',
  TASK = 'TASK',
  QUOTE = 'QUOTE',
}

export class UploadFileDto {
  @IsEnum(FileRelatedType)
  relatedType: FileRelatedType;

  @IsUUID()
  relatedId: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}
