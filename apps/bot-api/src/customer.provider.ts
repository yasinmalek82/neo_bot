import type { CatalogAdminUseCase } from '@neo-bot/application';
import { CommerceUseCase, DirectServiceUseCase, ReportingUseCase } from '@neo-bot/application';
import {
  PostgresCommerceRepository,
  PostgresProvisioningRepository,
  PostgresReportingRepository,
} from '@neo-bot/database';
import { PasarGuardClient } from '@neo-bot/pasarguard';
import type { Pool } from 'pg';

import { catalogAdminUseCaseToken } from './catalog.provider.js';
import { loadPilotConfig, loadTelegramConfig } from './config.js';
import { CustomerOrderService } from './customer-order.service.js';
import { databasePoolToken } from './database.provider.js';

export const customerOrderServiceToken = Symbol('customerOrderService');

export const customerOrderServiceProvider = {
  provide: customerOrderServiceToken,
  inject: [databasePoolToken, catalogAdminUseCaseToken],
  useFactory: (pool: Pool, catalog: CatalogAdminUseCase): CustomerOrderService | null => {
    const telegramConfig = loadTelegramConfig();
    if (!telegramConfig.enabled) {
      return null;
    }
    const providerConfig = loadPilotConfig();
    const commerceRepository = new PostgresCommerceRepository(pool);
    const reporting = new ReportingUseCase(new PostgresReportingRepository(pool));
    const pasarGuard = new PasarGuardClient({
      baseUrl: providerConfig.baseUrl,
      apiKey: providerConfig.apiKey,
    });
    const directService = new DirectServiceUseCase(
      new PostgresProvisioningRepository(pool),
      pasarGuard,
    );
    const commerce = new CommerceUseCase(commerceRepository, directService, reporting);
    return new CustomerOrderService(commerce, catalog, telegramConfig.botToken);
  },
};
