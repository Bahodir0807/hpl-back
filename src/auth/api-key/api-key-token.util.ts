import { createHash, timingSafeEqual } from 'node:crypto';
import { Prisma } from '@prisma/client';

export function hashApiKeyToken(token: string, pepper: string): string {
  return createHash('sha256')
    .update(token + pepper)
    .digest('hex');
}

export function isTokenHashMatch(
  providedHash: string,
  expectedHash: string,
): boolean {
  const provided = Buffer.from(providedHash, 'hex');
  const expected = Buffer.from(expectedHash, 'hex');

  if (provided.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(provided, expected);
}

export function parseServiceAccountPermissions(
  permissions: Prisma.JsonValue,
): string[] {
  if (Array.isArray(permissions)) {
    return permissions.filter(
      (entry): entry is string => typeof entry === 'string',
    );
  }

  if (typeof permissions === 'string') {
    try {
      const parsed: unknown = JSON.parse(permissions);
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (entry): entry is string => typeof entry === 'string',
        );
      }
    } catch {
      return [];
    }
  }

  return [];
}
