import { CatalogChatAdminUseCase, type CatalogAdminUseCase } from '@neo-bot/application';
import {
  CommerceUseCase,
  CustomerDeliveryUseCase,
  DirectServiceUseCase,
  OpsDailySummaryUseCase,
  ProvisioningModeGate,
  ReportingUseCase,
} from '@neo-bot/application';
import {
  PostgresCommerceRepository,
  PostgresCatalogChatAdminRepository,
  PostgresProvisioningRepository,
  PostgresReportingRepository,
} from '@neo-bot/database';
import { PasarGuardClient } from '@neo-bot/pasarguard';
import type { Pool } from 'pg';

import { catalogAdminUseCaseToken } from './catalog.provider.js';
import { loadPilotConfig, loadTelegramConfig } from './config.js';
import { databasePoolToken } from './database.provider.js';
import { TelegramApiClient } from './telegram-api.js';
import { createTelegramDeliveryTransport, TelegramCommerceBot } from './telegram-commerce-bot.js';
import { serviceDeliveredText } from './telegram-menu.js';

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
    const catalogChat = new CatalogChatAdminUseCase(new PostgresCatalogChatAdminRepository(pool));
    const telegramApi = new TelegramApiClient(telegramConfig.botToken);
    try {
      await telegramApi.setMyCommands([
        { command: 'start', description: 'منوی فروشگاه' },
        { command: 'help', description: 'راهنمای خرید' },
      ]);
      await telegramApi.setCommandsMenuButton();
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
    const directService = new DirectServiceUseCase(
      provisioningRepository,
      pasarGuard,
      () => new Date(),
      new ProvisioningModeGate({
        mode: providerConfig.provisioningMode,
        isolatedGroupId: providerConfig.isolatedGroupId,
      }),
    );
    const commerce = new CommerceUseCase(commerceRepository, directService, reporting);
    const dailySummary = new OpsDailySummaryUseCase(commerceRepository, reporting);
    const delivery = new CustomerDeliveryUseCase(
      commerceRepository,
      createTelegramDeliveryTransport(telegramApi, telegramConfig.brandMedia.deliveryPhotoFileId),
      serviceDeliveredText,
    );
    return new TelegramCommerceBot(
      telegramConfig,
      commerce,
      commerceRepository,
      directService,
      telegramApi,
      catalog,
      catalogChat,
      reporting,
      dailySummary,
      delivery,
    );
  },
};
