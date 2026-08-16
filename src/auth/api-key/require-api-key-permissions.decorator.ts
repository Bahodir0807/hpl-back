import { SetMetadata } from '@nestjs/common';

export const API_KEY_PERMISSIONS_KEY = 'apiKeyPermissions';

export const RequireApiKeyPermissions = (...permissions: string[]) =>
  SetMetadata(API_KEY_PERMISSIONS_KEY, permissions);
