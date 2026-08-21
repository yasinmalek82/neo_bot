import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';

import { loadTelegramConfig } from './config.js';
import { ReportingOutboxScheduler } from './reporting-outbox-scheduler.js';
import { TelegramApiClient } from './telegram-api.js';
import { TelegramCommerceBot } from './telegram-commerce-bot.js';
import {
  applyWebhookInfo,
  configureTelegramIntake,
  recordTelegramIntakeFailure,
  recordTelegramIntakeSuccess,
} from './telegram-intake.js';
import { telegramCommerceBotToken } from './telegram.provider.js';
import { TelegramUpdatePoller } from './telegram-update-poller.js';

const WEBHOOK_INFO_INTERVAL_MS = 60_000;

@Injectable()
export class TelegramUpdateHost implements OnModuleInit, OnModuleDestroy {
  private poller: TelegramUpdatePoller | null = null;
  private webhookMonitor: ReportingOutboxScheduler | null = null;

  public constructor(
    @Inject(telegramCommerceBotToken)
    private readonly bot: TelegramCommerceBot | null,
  ) {}

  public async onModuleInit(): Promise<void> {
    const bot = this.bot;
    if (bot === null) {
      configureTelegramIntake('disabled');
      return;
    }
    const config = loadTelegramConfig();
    if (!config.enabled) {
      configureTelegramIntake('disabled');
      return;
    }
    const api = new TelegramApiClient(config.botToken);
    if (config.webhookUrl !== null) {
      const webhookUrl = config.webhookUrl;
      configureTelegramIntake('webhook');
      await api.setWebhook(webhookUrl, config.webhookSecret);
      this.webhookMonitor = new ReportingOutboxScheduler(async () => {
        try {
          applyWebhookInfo(webhookUrl, await api.getWebhookInfo());
        } catch (error: unknown) {
          recordTelegramIntakeFailure(error);
        }
      }, WEBHOOK_INFO_INTERVAL_MS);
      this.webhookMonitor.start();
      return;
    }
    await api.deleteWebhook();
    configureTelegramIntake('polling');
    this.poller = new TelegramUpdatePoller(
      (offset, timeoutSeconds) => api.getUpdates(offset, timeoutSeconds),
      (update) => bot.handleUpdate(update),
      0,
      1_000,
      false,
      (ok, error) => {
        if (ok) {
          recordTelegramIntakeSuccess();
          return;
        }
        recordTelegramIntakeFailure(error);
      },
    );
    this.poller.start();
  }

  public async onModuleDestroy(): Promise<void> {
    this.webhookMonitor?.stop();
    await this.webhookMonitor?.waitForIdle();
    await this.poller?.stop();
  }
}
