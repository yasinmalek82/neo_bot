import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Post,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';

import { recordTelegramIntakeFailure, recordTelegramIntakeSuccess } from './telegram-intake.js';
import { telegramCommerceBotToken } from './telegram.provider.js';
import type { TelegramCommerceBot } from './telegram-commerce-bot.js';

@Controller('telegram')
export class TelegramController {
  public constructor(
    @Inject(telegramCommerceBotToken)
    private readonly bot: TelegramCommerceBot | null,
  ) {}

  @Post('webhook')
  @HttpCode(200)
  public async receiveUpdate(
    @Headers('x-telegram-bot-api-secret-token') secret: string | undefined,
    @Body() body: unknown,
  ): Promise<{ readonly ok: true }> {
    if (this.bot === null) {
      throw new ServiceUnavailableException('TELEGRAM_DISABLED');
    }
    if (!this.bot.isWebhookSecretValid(secret)) {
      throw new UnauthorizedException('INVALID_TELEGRAM_WEBHOOK_SECRET');
    }
    try {
      await this.bot.handleUpdate(body);
      recordTelegramIntakeSuccess();
      return { ok: true };
    } catch (error: unknown) {
      recordTelegramIntakeFailure(error);
      throw error;
    }
  }
}
