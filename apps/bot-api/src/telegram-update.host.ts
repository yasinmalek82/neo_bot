import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';

import { loadTelegramConfig } from './config.js';
import { TelegramApiClient } from './telegram-api.js';
import { TelegramCommerceBot } from './telegram-commerce-bot.js';
import { telegramCommerceBotToken } from './telegram.provider.js';
import { TelegramUpdatePoller } from './telegram-update-poller.js';

@Injectable()
export class TelegramUpdateHost implements OnModuleInit, OnModuleDestroy {
  private poller: TelegramUpdatePoller | null = null;

  public constructor(
    @Inject(telegramCommerceBotToken)
    private readonly bot: TelegramCommerceBot | null,
  ) {}

  public async onModuleInit(): Promise<void> {
    const bot = this.bot;
    if (bot === null) {
      return;
    }
    const config = loadTelegramConfig();
    if (!config.enabled) {
      return;
    }
    const api = new TelegramApiClient(config.botToken);
    if (config.webhookUrl !== null) {
      await api.setWebhook(config.webhookUrl, config.webhookSecret);
      return;
    }
    await api.deleteWebhook();
    this.poller = new TelegramUpdatePoller(
      (offset, timeoutSeconds) => api.getUpdates(offset, timeoutSeconds),
      (update) => bot.handleUpdate(update),
      0,
      1_000,
    );
    this.poller.start();
  }

  public async onModuleDestroy(): Promise<void> {
    await this.poller?.stop();
  }
}
