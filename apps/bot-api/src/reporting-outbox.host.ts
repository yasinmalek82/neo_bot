import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';

import { loadTelegramConfig } from './config.js';
import { ReportingOutboxScheduler } from './reporting-outbox-scheduler.js';
import { TelegramCommerceBot } from './telegram-commerce-bot.js';
import { telegramCommerceBotToken } from './telegram.provider.js';

@Injectable()
export class ReportingOutboxHost implements OnModuleInit, OnModuleDestroy {
  private reportScheduler: ReportingOutboxScheduler | null = null;
  private deliveryScheduler: ReportingOutboxScheduler | null = null;
  private reminderScheduler: ReportingOutboxScheduler | null = null;
  private broadcastScheduler: ReportingOutboxScheduler | null = null;

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
    this.reminderScheduler = new ReportingOutboxScheduler(
      () => bot.dispatchDueReminders(),
      config.reminderDispatchIntervalMs,
    );
    this.broadcastScheduler = new ReportingOutboxScheduler(
      () => bot.dispatchDueBroadcasts(),
      config.broadcastDispatchIntervalMs,
    );
    this.reportScheduler.start();
    this.deliveryScheduler.start();
    this.reminderScheduler.start();
    this.broadcastScheduler.start();
  }

  public async onModuleDestroy(): Promise<void> {
    this.reportScheduler?.stop();
    this.deliveryScheduler?.stop();
    this.reminderScheduler?.stop();
    this.broadcastScheduler?.stop();
    await Promise.all([
      this.reportScheduler?.waitForIdle(),
      this.deliveryScheduler?.waitForIdle(),
      this.reminderScheduler?.waitForIdle(),
      this.broadcastScheduler?.waitForIdle(),
    ]);
  }
}
