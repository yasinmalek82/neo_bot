import 'reflect-metadata';
import './load-local-env.js';

import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';

import { AppModule } from './app.module.js';
import { loadHttpConfig } from './config.js';
import { RedactingExceptionFilter } from './http-exception.filter.js';
import { RateLimitInterceptor, SecurityHeadersInterceptor } from './http-security.js';
import { SafeLogger } from './safe-log.js';

const logger = new SafeLogger({ colors: false, json: true });
const app = await NestFactory.create<NestFastifyApplication>(
  AppModule,
  new FastifyAdapter({ logger: false, bodyLimit: 1_048_576 }),
  { logger },
);
app.enableShutdownHooks();
app.useGlobalFilters(new RedactingExceptionFilter(logger));
app.useGlobalInterceptors(new RateLimitInterceptor(), new SecurityHeadersInterceptor());
const http = loadHttpConfig();
app.enableCors({ origin: [...http.webOrigins], methods: ['GET', 'PUT', 'POST'] });
await app.listen({ host: http.host, port: http.port });
