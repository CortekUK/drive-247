import { config } from 'dotenv';
config({ path: '.env.local' });

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import * as cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { validateEnv } from './config/env.config';

async function bootstrap() {
  const env = validateEnv();
  const app = await NestFactory.create(AppModule);

  const allowedOrigins = env.ALLOWED_ORIGINS.split(',').map((o) => o.trim());

  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      for (const allowed of allowedOrigins) {
        try {
          const allowedUrl = new URL(allowed);
          const requestUrl = new URL(origin);
          if (
            requestUrl.port === allowedUrl.port &&
            requestUrl.hostname.endsWith(`.${allowedUrl.hostname}`)
          ) {
            return callback(null, true);
          }
        } catch {
          continue;
        }
      }

      callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
  });

  await app.listen(env.BACKEND_PORT);
  console.log(`Backend running on http://localhost:${env.BACKEND_PORT}`);
}

bootstrap();
