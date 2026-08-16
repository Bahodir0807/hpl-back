import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // CSP отключён: иначе Swagger UI (единственный HTML, который отдаёт API)
  // блокируется политикой по умолчанию. JSON-эндпоинты CSP не нужен.
  app.use(helmet({ contentSecurityPolicy: false }));
  const configService = app.get(ConfigService);
  const nodeEnv = configService.get<string>('NODE_ENV');
  const frontendOrigin = configService.get<string>('FRONTEND_ORIGIN');
  const allowedOrigins =
    nodeEnv === 'production'
      ? [frontendOrigin as string]
      : [
          'http://localhost:3001',
          'http://127.0.0.1:3001',
          'http://localhost:3000',
          'http://127.0.0.1:3000',
          ...(frontendOrigin ? [frontendOrigin] : []),
        ];

  app.enableCors({
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
    credentials: true,
  });
  app.enableShutdownHooks();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('HPL CRM API')
    .setDescription('B2B CRM для продажи HPL-панелей')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  if (configService.get<string>('NODE_ENV') !== 'production') {
    SwaggerModule.setup('api/docs', app, swaggerDocument);
  }

  await app.listen(configService.get<number>('PORT') ?? 3005);
}
void bootstrap();
