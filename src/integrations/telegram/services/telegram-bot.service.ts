import { HttpService } from '@nestjs/axios';
import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Lead } from '@prisma/client';
import { firstValueFrom } from 'rxjs';
import type { Env } from '../../../config/env.schema';
import {
  compactUuid,
  ManagerListItem,
  TelegramFormData,
} from '../telegram.types';

type TelegramApiMessage = {
  message_id: number;
};

type TelegramInlineKeyboard = {
  inline_keyboard: Array<Array<Record<string, string>>>;
};

export type TelegramPollingUpdate = {
  update_id: number;
  callback_query?: {
    id: string;
    data?: string;
    from?: { id: number | string };
    message?: {
      message_id: number;
      chat?: { id: number };
    };
  };
};

@Injectable()
export class TelegramBotService {
  private readonly logger = new Logger(TelegramBotService.name);
  private readonly botToken?: string;
  private readonly apiUrl = 'https://api.telegram.org/bot';
  private readonly isProduction: boolean;

  constructor(
    private readonly http: HttpService,
    private readonly configService: ConfigService<Env, true>,
  ) {
    this.botToken = this.configService.get('TELEGRAM_BOT_TOKEN', {
      infer: true,
    });
    this.isProduction =
      this.configService.get('NODE_ENV', { infer: true }) === 'production';

    if (this.isProduction && !this.botToken) {
      throw new Error('TELEGRAM_BOT_TOKEN is required in production');
    }
  }

  async sendLeadToAdmin(
    chatId: string,
    lead: Lead,
    formData: TelegramFormData,
    managers: ManagerListItem[],
  ): Promise<TelegramApiMessage> {
    const text = this.buildAdminMessage(lead, formData);
    const keyboard = this.buildInlineKeyboard(lead.id, managers);

    return this.postTelegram<TelegramApiMessage>('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard },
    });
  }

  async sendMessageToAdmin(
    text: string,
    inlineKeyboard?: TelegramInlineKeyboard,
  ): Promise<TelegramApiMessage | undefined> {
    const adminUserId = this.configService.get('TELEGRAM_ADMIN_USER_ID', {
      infer: true,
    });

    if (!adminUserId) {
      this.logger.warn(
        'TELEGRAM_ADMIN_USER_ID is not configured — skipping admin DM',
      );
      return undefined;
    }

    return this.postTelegram<TelegramApiMessage>('sendMessage', {
      chat_id: adminUserId,
      text,
      parse_mode: 'HTML',
      ...(inlineKeyboard ? { reply_markup: inlineKeyboard } : {}),
    });
  }

  async editAdminMessage(
    messageId: number,
    text: string,
    inlineKeyboard?: TelegramInlineKeyboard,
  ): Promise<void> {
    const adminUserId = this.configService.get('TELEGRAM_ADMIN_USER_ID', {
      infer: true,
    });

    if (!adminUserId) {
      return;
    }

    await this.postTelegram('editMessageText', {
      chat_id: adminUserId,
      message_id: messageId,
      text,
      parse_mode: 'HTML',
      reply_markup: inlineKeyboard ?? { inline_keyboard: [] },
    });
  }

  async sendMessage(chatId: string, text: string): Promise<void> {
    await this.postTelegram('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
    });
  }

  async editMessageText(
    chatId: string,
    messageId: string,
    text: string,
    inlineKeyboard?: TelegramInlineKeyboard,
  ): Promise<void> {
    await this.postTelegram('editMessageText', {
      chat_id: chatId,
      message_id: Number.parseInt(messageId, 10),
      text,
      parse_mode: 'HTML',
      reply_markup: inlineKeyboard ?? { inline_keyboard: [] },
    });
  }

  buildAdminAssignmentKeyboard(
    leadId: string,
    managers: ManagerListItem[],
    offset = 0,
  ): TelegramInlineKeyboard {
    const compactLeadId = compactUuid(leadId);
    const page = managers.slice(offset, offset + 3);
    const rows: Array<Array<Record<string, string>>> = page.map(
      (manager, index) => [
        {
          text:
            offset === 0 && page.length === 1
              ? 'Назначить на менеджера'
              : `Назначить: ${manager.displayName}`,
          callback_data: `assign:${compactLeadId}:${offset + index}`,
        },
      ],
    );

    if (managers.length > offset + 3) {
      rows.push([
        {
          text: 'Ещё менеджеры',
          callback_data: `more_managers:${compactLeadId}`,
        },
      ]);
    }

    rows.push([
      {
        text: 'Пропустить',
        callback_data: `skip:${compactLeadId}`,
      },
    ]);

    return { inline_keyboard: rows };
  }

  async answerCallbackQuery(
    callbackQueryId: string,
    text?: string,
  ): Promise<void> {
    await this.postTelegram('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      text,
    });
  }

  hasBotToken(): boolean {
    return Boolean(this.botToken);
  }

  async deleteWebhook(): Promise<void> {
    await this.postTelegram('deleteWebhook', { drop_pending_updates: false });
  }

  async getUpdates(offset: number): Promise<TelegramPollingUpdate[]> {
    const result = await this.postTelegram<TelegramPollingUpdate[]>(
      'getUpdates',
      {
        offset,
        timeout: 25,
        allowed_updates: ['callback_query'],
      },
    );

    return result ?? [];
  }

  private buildAdminMessage(lead: Lead, formData: TelegramFormData): string {
    const frontendUrl =
      this.configService.get('FRONTEND_URL', { infer: true }) ??
      this.configService.get('FRONTEND_ORIGIN', { infer: true }) ??
      'http://localhost:3005';

    return [
      '🔔 <b>Новая заявка из Telegram (сайт)</b>',
      '',
      `👤 Имя: ${this.escapeHtml(formData.name || '—')}`,
      `📞 Телефон: ${this.escapeHtml(formData.phone || '—')}`,
      `💬 Сообщение: ${this.escapeHtml(formData.message || '—')}`,
      `🏷️ Предпочтение: ${this.escapeHtml(formData.panelTypePreference || 'не указано')}`,
      `🔗 Лид в CRM: ${frontendUrl}/leads/${lead.id}`,
      '',
      'Назначить менеджера:',
    ].join('\n');
  }

  private buildInlineKeyboard(
    leadId: string,
    managers: ManagerListItem[],
  ): Array<Array<Record<string, string>>> {
    const rows: Array<Array<Record<string, string>>> = [];
    const compactLeadId = compactUuid(leadId);
    const visibleManagers = managers.slice(0, 3);

    for (let index = 0; index < visibleManagers.length; index += 2) {
      const row = visibleManagers
        .slice(index, index + 2)
        .map((manager, offset) => ({
          text: `👤 ${manager.displayName}`,
          callback_data: `a|${compactLeadId}|${index + offset}`,
        }));
      rows.push(row);
    }

    if (managers.length > 3) {
      rows.push([
        {
          text: 'Ещё ▶️',
          callback_data: `more|${compactLeadId}|2`,
        },
      ]);
    }

    const frontendUrl =
      this.configService.get('FRONTEND_URL', { infer: true }) ??
      this.configService.get('FRONTEND_ORIGIN', { infer: true }) ??
      'http://localhost:3005';

    rows.push([
      { text: '⏭ Пропустить', callback_data: `s|${compactLeadId}` },
      { text: '🔗 Открыть в CRM', url: `${frontendUrl}/leads/${leadId}` },
    ]);

    return rows;
  }

  private escapeHtml(value: string): string {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;');
  }

  private async postTelegram<T>(
    method: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    if (!this.botToken) {
      if (this.isProduction) {
        this.logger.error('TELEGRAM_BOT_TOKEN missing, cannot notify admin');
        throw new InternalServerErrorException('Bot token not configured');
      }

      this.logger.warn(
        `TELEGRAM_BOT_TOKEN is not configured — skipping ${method}`,
      );

      if (method === 'sendMessage') {
        return { message_id: 0 } as T;
      }

      return undefined as T;
    }

    const response = await firstValueFrom(
      this.http.post<{ ok: boolean; result: T; description?: string }>(
        `${this.apiUrl}${this.botToken}/${method}`,
        body,
      ),
    ).catch((error: unknown) => {
      const description =
        error &&
        typeof error === 'object' &&
        'response' in error &&
        error.response &&
        typeof error.response === 'object' &&
        'data' in error.response
          ? JSON.stringify(error.response.data)
          : error instanceof Error
            ? error.message
            : String(error);

      this.logger.error(`Telegram ${method} failed: ${description}`);
      throw error;
    });

    return response.data.result;
  }
}
