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
    await this.bot.handleUpdate(body);
    return { ok: true };
  }
}
