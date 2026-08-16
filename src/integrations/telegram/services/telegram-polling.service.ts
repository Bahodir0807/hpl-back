import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env.schema';
import { TelegramAdminHandlerService } from './telegram-admin-handler.service';
import { TelegramBotService } from './telegram-bot.service';

@Injectable()
export class TelegramPollingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramPollingService.name);
  private running = false;
  private offset = 0;

  constructor(
    private readonly botService: TelegramBotService,
    private readonly adminHandler: TelegramAdminHandlerService,
    private readonly configService: ConfigService<Env, true>,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.configService.get('NODE_ENV', { infer: true }) === 'test') {
      return;
    }

    if (!this.botService.hasBotToken()) {
      this.logger.warn(
        'Telegram polling disabled: TELEGRAM_BOT_TOKEN is not set',
      );
      return;
    }

    try {
      await this.botService.deleteWebhook();
    } catch (error) {
      this.logger.warn(
        `Could not delete Telegram webhook: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    this.running = true;
    this.logger.log(
      'Telegram callback polling started — button clicks will be handled via getUpdates',
    );
    void this.loop();
  }

  onModuleDestroy(): void {
    this.running = false;
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        const updates = await this.botService.getUpdates(this.offset);

        for (const update of updates) {
          this.offset = update.update_id + 1;
          const callback = update.callback_query;

          if (!callback?.data) {
            continue;
          }

          this.logger.log(`Callback received: ${callback.data}`);

          await this.adminHandler.handleCallbackData(callback.data, {
            adminChatId: String(callback.message?.chat?.id ?? ''),
            adminMessageId: String(callback.message?.message_id ?? ''),
            callbackQueryId: callback.id,
          });
        }
      } catch (error) {
        this.logger.error(
          `Telegram polling error: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        await this.sleep(2000);
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
