import { Module } from '@nestjs/common';
import { PrismaModule } from '../../modules/prisma/prisma.module';
import { ApiKeyAuthGuard } from './api-key-auth.guard';
import { ApiKeyPermissionsGuard } from './api-key-permissions.guard';
import { ApiKeyService } from './api-key.service';

@Module({
  imports: [PrismaModule],
  providers: [ApiKeyService, ApiKeyAuthGuard, ApiKeyPermissionsGuard],
  exports: [ApiKeyService, ApiKeyAuthGuard, ApiKeyPermissionsGuard],
})
export class ApiKeyModule {}
