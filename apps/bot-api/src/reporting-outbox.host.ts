import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';

import { loadTelegramConfig } from './config.js';
import { ReportingOutboxScheduler } from './reporting-outbox-scheduler.js';
import { TelegramCommerceBot } from './telegram-commerce-bot.js';
import { telegramCommerceBotToken } from './telegram.provider.js';

@Injectable()
export class ReportingOutboxHost implements OnModuleInit, OnModuleDestroy {
  private reportScheduler: ReportingOutboxScheduler | null = null;
  private deliveryScheduler: ReportingOutboxScheduler | null = null;

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
    this.reportScheduler = new ReportingOutboxScheduler(
      () => bot.dispatchDueReports(),
      config.reportDispatchIntervalMs,
    );
    this.deliveryScheduler = new ReportingOutboxScheduler(
      () => bot.dispatchDueDeliveries(),
      config.deliveryDispatchIntervalMs,
    );
    this.reportScheduler.start();
    this.deliveryScheduler.start();
  }

  public async onModuleDestroy(): Promise<void> {
    this.reportScheduler?.stop();
    this.deliveryScheduler?.stop();
    await Promise.all([this.reportScheduler?.waitForIdle(), this.deliveryScheduler?.waitForIdle()]);
  }
}
