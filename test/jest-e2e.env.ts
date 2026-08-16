import { config } from 'dotenv';

config();

process.env.NODE_ENV = 'test';
process.env.ENABLE_QUEUE_WORKERS = 'false';
// Skip live Telegram HTTP in e2e; TelegramBotService no-ops without a token.
process.env.TELEGRAM_BOT_TOKEN = '';
// Must be set before AppModule/ConfigModule.forRoot snapshots env.
process.env.SERVICE_ACCOUNT_TOKEN_PEPPER =
  'test-service-account-pepper-min-32-chars';
process.env.JWT_ACCESS_SECRET = 'test-access-secret-key-min-32-chars';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-key-min-32-chars';
