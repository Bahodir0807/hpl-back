import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  PORT: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .default(() => 3001),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_ACCESS_SECRET: z
    .string()
    .min(32, 'JWT_ACCESS_SECRET must be at least 32 characters')
    .refine(
      (value) => value !== 'change-me-min-32-chars-random-string',
      'JWT secret must not be the default placeholder value',
    ),
  JWT_REFRESH_SECRET: z
    .string()
    .min(32, 'JWT_REFRESH_SECRET must be at least 32 characters')
    .refine(
      (value) => value !== 'change-me-min-32-chars-random-string',
      'JWT secret must not be the default placeholder value',
    ),
  FRONTEND_ORIGIN: z.string().url().optional(),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().optional(),
  SERVICE_ACCOUNT_TOKEN_PEPPER: z
    .string()
    .min(32, 'SERVICE_ACCOUNT_TOKEN_PEPPER must be at least 32 characters'),
  LEAD_POOL_USER_EMAIL: z.string().email().default('lead-pool@hpl.com'),
  SYSTEM_USER_EMAIL: z.string().email().default('system@hpl.com'),
  ADMIN_USER_EMAIL: z.string().email().default('admin@hpl.com'),
  FRONTEND_URL: z.string().url().optional(),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_ADMIN_CHAT_ID: z.string().optional(),
  TELEGRAM_ADMIN_USER_ID: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
}).superRefine((env, ctx) => {
  if (env.NODE_ENV === 'production' && !env.FRONTEND_ORIGIN) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['FRONTEND_ORIGIN'],
      message: 'FRONTEND_ORIGIN is required in production',
    });
  }
});

export type Env = z.infer<typeof envSchema>;
