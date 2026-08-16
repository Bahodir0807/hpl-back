import { Module } from '@nestjs/common';
import { ApiKeyModule } from '../../auth/api-key/api-key.module';
import { TestWebhookController } from './test-webhook.controller';

@Module({
  imports: [ApiKeyModule],
  controllers: [TestWebhookController],
})
export class TestIntegrationsModule {}
