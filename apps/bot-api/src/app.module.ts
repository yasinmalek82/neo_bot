import { Module } from '@nestjs/common';

import { CatalogController } from './catalog.controller.js';
import { catalogAdminUseCaseProvider } from './catalog.provider.js';
import { CustomerController } from './customer.controller.js';
import { customerOrderServiceProvider } from './customer.provider.js';
import { DailySummaryHost } from './daily-summary.host.js';
import { databasePoolProvider, DatabasePoolHost } from './database.provider.js';
import { HealthController } from './health.controller.js';
import { ReportingOutboxHost } from './reporting-outbox.host.js';
import { telegramCommerceBotProvider } from './telegram.provider.js';
import { TelegramController } from './telegram.controller.js';
import { TelegramUpdateHost } from './telegram-update.host.js';

@Module({
  controllers: [HealthController, TelegramController, CatalogController, CustomerController],
  providers: [
    databasePoolProvider,
    DatabasePoolHost,
    telegramCommerceBotProvider,
    catalogAdminUseCaseProvider,
    customerOrderServiceProvider,
    ReportingOutboxHost,
    DailySummaryHost,
    TelegramUpdateHost,
  ],
})
export class AppModule {}
