import { Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiKeyAuthGuard } from '../../auth/api-key/api-key-auth.guard';
import { ApiKeyPermissionsGuard } from '../../auth/api-key/api-key-permissions.guard';
import { RequireApiKeyPermissions } from '../../auth/api-key/require-api-key-permissions.decorator';
import { Public } from '../../common/decorators/public.decorator';

@Public()
@Controller('test/webhook')
@UseGuards(ApiKeyAuthGuard, ApiKeyPermissionsGuard)
export class TestWebhookController {
  @Post()
  @HttpCode(200)
  @RequireApiKeyPermissions('leads:create')
  test(): { status: string } {
    return { status: 'ok' };
  }
}
