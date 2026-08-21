import type { CatalogAdminUseCase } from '@neo-bot/application';
import {
  CommerceUseCase,
  DirectServiceUseCase,
  OpsDailySummaryUseCase,
  ReportingUseCase,
} from '@neo-bot/application';
import {
  PostgresCommerceRepository,
  PostgresProvisioningRepository,
  PostgresReportingRepository,
} from '@neo-bot/database';
import { PasarGuardClient } from '@neo-bot/pasarguard';
import type { Pool } from 'pg';

import { catalogAdminUseCaseToken } from './catalog.provider.js';
import { loadPilotConfig, loadTelegramConfig } from './config.js';
import { databasePoolToken } from './database.provider.js';
import { TelegramApiClient } from './telegram-api.js';
import { TelegramCommerceBot } from './telegram-commerce-bot.js';

export const telegramCommerceBotToken = Symbol('telegramCommerceBot');

export const telegramCommerceBotProvider = {
  provide: telegramCommerceBotToken,
  inject: [databasePoolToken, catalogAdminUseCaseToken],
  useFactory: async (
    pool: Pool,
    catalog: CatalogAdminUseCase,
  ): Promise<TelegramCommerceBot | null> => {
    const telegramConfig = loadTelegramConfig();
    if (!telegramConfig.enabled) {
      return null;
    }
    const providerConfig = loadPilotConfig();
    const provisioningRepository = new PostgresProvisioningRepository(pool);
    const commerceRepository = new PostgresCommerceRepository(pool);
    const reportingRepository = new PostgresReportingRepository(pool);
    const telegramApi = new TelegramApiClient(telegramConfig.botToken);
    try {
      await telegramApi.setMyCommands([
        { command: 'start', description: 'منوی فروشگاه' },
        { command: 'help', description: 'راهنمای خرید' },
      ]);
      if (telegramConfig.miniAppUrl !== null) {
        await telegramApi.setChatMenuButton(telegramConfig.miniAppUrl);
      }
    } catch {
      // Menu commands are optional; the inline keyboard still works if Telegram rejects this call.
    }
    const reporting = new ReportingUseCase(
      reportingRepository,
      telegramApi,
      () => new Date(),
      telegramApi,
    );
    if (telegramConfig.reporting !== null) {
      await reporting.ensureForumTopics(
        telegramConfig.reporting.groupChatId,
        telegramApi,
        telegramConfig.reporting.topics,
      );
    }
    const pasarGuard = new PasarGuardClient({
      baseUrl: providerConfig.baseUrl,
      apiKey: providerConfig.apiKey,
    });
    const directService = new DirectServiceUseCase(provisioningRepository, pasarGuard);
    const commerce = new CommerceUseCase(commerceRepository, directService, reporting);
    const dailySummary = new OpsDailySummaryUseCase(commerceRepository, reporting);
    return new TelegramCommerceBot(
      telegramConfig,
      commerce,
      commerceRepository,
      directService,
      telegramApi,
      catalog,
      reporting,
      dailySummary,
    );
  },
};
