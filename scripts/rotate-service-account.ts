import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ApiKeyService } from '../src/auth/api-key/api-key.service';

async function main(): Promise<void> {
  const nameArg = process.argv.find((arg) => arg.startsWith('--name='));
  const name = nameArg?.split('=')[1];

  if (!name) {
    console.error('Usage: npm run service-account:rotate -- --name=telegram-bot');
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const apiKeyService = app.get(ApiKeyService);
    const result = await apiKeyService.rotateToken(name);

    console.log('Service account token rotated successfully.');
    console.log(`name=${name}`);
    console.log(`token=${result.token}`);
    console.log(`tokenHash=${result.tokenHash}`);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
