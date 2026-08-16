import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class TelegramUserDto {
  @IsInt()
  id!: number;

  @IsOptional()
  @IsString()
  username?: string;

  @IsOptional()
  @IsString()
  first_name?: string;
}

export class TelegramContactDto {
  @IsString()
  phone_number!: string;

  @IsString()
  first_name!: string;
}

export class TelegramMessageDto {
  @IsInt()
  message_id!: number;

  @ValidateNested()
  @Type(() => TelegramUserDto)
  from!: TelegramUserDto;

  @IsOptional()
  @IsString()
  text?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => TelegramContactDto)
  contact?: TelegramContactDto;
}

export class TelegramCallbackChatDto {
  @IsInt()
  id!: number;
}

export class TelegramCallbackMessageDto {
  @IsInt()
  message_id!: number;

  @ValidateNested()
  @Type(() => TelegramCallbackChatDto)
  chat!: TelegramCallbackChatDto;
}

export class TelegramCallbackQueryDto {
  @IsString()
  id!: string;

  @ValidateNested()
  @Type(() => TelegramUserDto)
  from!: TelegramUserDto;

  @IsString()
  data!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => TelegramCallbackMessageDto)
  message?: TelegramCallbackMessageDto;
}

export class TelegramUpdateDto {
  @IsInt()
  update_id!: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => TelegramMessageDto)
  message?: TelegramMessageDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => TelegramCallbackQueryDto)
  callback_query?: TelegramCallbackQueryDto;
}
