import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';

import { loadTelegramConfig } from './config.js';
import { ReportingOutboxScheduler } from './reporting-outbox-scheduler.js';
import { TelegramCommerceBot } from './telegram-commerce-bot.js';
import { telegramCommerceBotToken } from './telegram.provider.js';

const DAILY_SUMMARY_INTERVAL_MS = 3_600_000;

@Injectable()
export class DailySummaryHost implements OnModuleInit, OnModuleDestroy {
  private scheduler: ReportingOutboxScheduler | null = null;

  public constructor(
    @Inject(telegramCommerceBotToken)
    private readonly bot: TelegramCommerceBot | null,
  ) {}

  public onModuleInit(): void {
    const bot = this.bot;
    if (bot === null) {
      return;
    }
    const config = loadTelegramConfig();
    if (!config.enabled) {
      return;
    }
    this.scheduler = new ReportingOutboxScheduler(async () => {
      await bot.publishDailySummary();
    }, DAILY_SUMMARY_INTERVAL_MS);
    this.scheduler.start();
  }

  public async onModuleDestroy(): Promise<void> {
    this.scheduler?.stop();
    await this.scheduler?.waitForIdle();
  }
}
