import { resolve } from 'node:path';
import { envSchema } from './env.schema';

describe('production file storage environment', () => {
  const base = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://crm:crm@localhost:5432/crm',
    JWT_ACCESS_SECRET: 'a'.repeat(32),
    JWT_REFRESH_SECRET: 'b'.repeat(32),
    SERVICE_ACCOUNT_TOKEN_PEPPER: 'c'.repeat(32),
    FRONTEND_ORIGIN: 'https://crm.example.com',
  } as const;

  it.each([undefined, './uploads'])(
    'rejects a missing or relative production FILE_STORAGE_PATH (%s)',
    (fileStoragePath) => {
      const result = envSchema.safeParse({
        ...base,
        FILE_STORAGE_PATH: fileStoragePath,
      });
      expect(result.success).toBe(false);
    },
  );

  it('accepts an absolute persistent production path', () => {
    const result = envSchema.safeParse({
      ...base,
      FILE_STORAGE_PATH: resolve('persistent-files'),
    });
    expect(result.success).toBe(true);
  });
});
