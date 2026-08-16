import { Global, Module } from '@nestjs/common';
import { PermissionsGuard } from './guards/permissions.guard';

@Global()
@Module({
  providers: [PermissionsGuard],
  exports: [PermissionsGuard],
})
export class CommonModule {}
