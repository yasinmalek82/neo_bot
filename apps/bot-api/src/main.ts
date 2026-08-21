import 'reflect-metadata';
import './load-local-env.js';

import { ConsoleLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';

import { AppModule } from './app.module.js';
import { loadHttpConfig } from './config.js';
import { RateLimitInterceptor, SecurityHeadersInterceptor } from './http-security.js';

const app = await NestFactory.create<NestFastifyApplication>(
  AppModule,
  new FastifyAdapter({ bodyLimit: 1_048_576 }),
  {
    logger: new ConsoleLogger({ colors: false, json: true }),
  },
);
app.enableShutdownHooks();
app.useGlobalInterceptors(new RateLimitInterceptor(), new SecurityHeadersInterceptor());
const http = loadHttpConfig();
app.enableCors({ origin: [...http.webOrigins], methods: ['GET', 'PUT', 'POST'] });
await app.listen({ host: http.host, port: http.port });
