export interface TelegramCallbackButton {
  readonly text: string;
  readonly callback_data: string;
}

export type TelegramInlineButton = TelegramCallbackButton;

export interface TelegramInlineKeyboardMarkup {
  readonly inline_keyboard: readonly (readonly TelegramInlineButton[])[];
}

export interface TelegramReplyKeyboardButton {
  readonly text: string;
}

export interface TelegramPersistentKeyboardMarkup {
  readonly keyboard: readonly (readonly TelegramReplyKeyboardButton[])[];
  readonly resize_keyboard: true;
  readonly is_persistent: true;
  readonly input_field_placeholder: string;
}

export type TelegramReplyMarkup = TelegramInlineKeyboardMarkup | TelegramPersistentKeyboardMarkup;

export interface TelegramSendOptions {
  readonly messageThreadId?: string;
  readonly parseMode?: 'HTML';
}

export interface TelegramSentMessage {
  readonly messageId: string;
}

export interface TelegramMessenger {
  sendMessage(
    chatId: string,
    text: string,
    replyMarkup?: TelegramReplyMarkup,
    options?: TelegramSendOptions,
  ): Promise<TelegramSentMessage>;
  sendPhoto(
    chatId: string,
    fileId: string,
    caption: string,
    replyMarkup?: TelegramInlineKeyboardMarkup,
    options?: TelegramSendOptions,
  ): Promise<TelegramSentMessage>;
  sendDocument(
    chatId: string,
    fileId: string,
    caption: string,
    replyMarkup?: TelegramInlineKeyboardMarkup,
    options?: TelegramSendOptions,
  ): Promise<TelegramSentMessage>;
  editMessageText(
    chatId: string,
    messageId: string,
    text: string,
    replyMarkup?: TelegramInlineKeyboardMarkup,
  ): Promise<void>;
  deleteMessage?(chatId: string, messageId: string): Promise<void>;
  answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void>;
}

export class TelegramApiClient implements TelegramMessenger {
  private readonly apiBaseUrl: URL;

  public constructor(
    botToken: string,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {
    this.apiBaseUrl = new URL(`https://api.telegram.org/bot${botToken}/`);
  }

  public sendMessage(
    chatId: string,
    text: string,
    replyMarkup?: TelegramReplyMarkup,
    options?: TelegramSendOptions,
  ): Promise<TelegramSentMessage> {
    return this.requestMessage('sendMessage', {
      chat_id: chatId,
      text,
      ...(replyMarkup === undefined ? {} : { reply_markup: replyMarkup }),
      ...(options?.parseMode === undefined ? {} : { parse_mode: options.parseMode }),
      ...threadIdPayload(options),
    });
  }

  public sendPhoto(
    chatId: string,
    fileId: string,
    caption: string,
    replyMarkup?: TelegramInlineKeyboardMarkup,
    options?: TelegramSendOptions,
  ): Promise<TelegramSentMessage> {
    return this.requestMessage('sendPhoto', {
      chat_id: chatId,
      photo: fileId,
      caption,
      ...(replyMarkup === undefined ? {} : { reply_markup: replyMarkup }),
      ...(options?.parseMode === undefined ? {} : { parse_mode: options.parseMode }),
      ...threadIdPayload(options),
    });
  }

  public sendDocument(
    chatId: string,
    fileId: string,
    caption: string,
    replyMarkup?: TelegramInlineKeyboardMarkup,
    options?: TelegramSendOptions,
  ): Promise<TelegramSentMessage> {
    return this.requestMessage('sendDocument', {
      chat_id: chatId,
      document: fileId,
      caption,
      ...(replyMarkup === undefined ? {} : { reply_markup: replyMarkup }),
      ...(options?.parseMode === undefined ? {} : { parse_mode: options.parseMode }),
      ...threadIdPayload(options),
    });
  }

  public setCommandsMenuButton(): Promise<void> {
    return this.requestOk('setChatMenuButton', {
      menu_button: { type: 'commands' },
    });
  }

  public send(input: {
    readonly chatId: string;
    readonly messageThreadId: string;
    readonly text: string;
  }): Promise<TelegramSentMessage> {
    return this.sendMessage(input.chatId, input.text, undefined, {
      messageThreadId: input.messageThreadId,
    });
  }

  public editMessageText(
    chatId: string,
    messageId: string,
    text: string,
    replyMarkup?: TelegramInlineKeyboardMarkup,
  ): Promise<void> {
    return this.requestOk('editMessageText', {
      chat_id: chatId,
      message_id: Number(messageId),
      text,
      parse_mode: 'HTML',
      ...(replyMarkup === undefined ? {} : { reply_markup: replyMarkup }),
    });
  }

  public deleteMessage(chatId: string, messageId: string): Promise<void> {
    return this.requestOk('deleteMessage', { chat_id: chatId, message_id: Number(messageId) });
  }

  public setMyCommands(
    commands: readonly { readonly command: string; readonly description: string }[],
  ): Promise<void> {
    return this.requestOk('setMyCommands', { commands });
  }

  public async inspectForum(chatId: string): Promise<{ readonly isForum: boolean }> {
    const body = await this.request('getChat', { chat_id: chatId });
    return { isForum: objectResult(body.result)?.['is_forum'] === true };
  }

  public async listTopicIcons(): Promise<
    readonly { readonly customEmojiId: string; readonly emoji: string | null }[]
  > {
    const body = await this.request('getForumTopicIconStickers', {});
    if (!Array.isArray(body.result)) {
      return [];
    }
    const icons: { customEmojiId: string; emoji: string | null }[] = [];
    for (const row of body.result) {
      const sticker = objectResult(row);
      const rawCustomEmojiId = sticker?.['custom_emoji_id'];
      const customEmojiId =
        typeof rawCustomEmojiId === 'string'
          ? rawCustomEmojiId
          : typeof rawCustomEmojiId === 'number'
            ? String(rawCustomEmojiId)
            : '';
      if (customEmojiId.length === 0) {
        continue;
      }
      const emoji = sticker?.['emoji'];
      icons.push({
        customEmojiId,
        emoji: typeof emoji === 'string' ? emoji : null,
      });
    }
    return icons;
  }

  public async createTopic(
    chatId: string,
    name: string,
    style?: { readonly iconCustomEmojiId?: string; readonly iconColor?: number },
  ): Promise<{ readonly messageThreadId: string }> {
    const body = await this.request('createForumTopic', {
      chat_id: chatId,
      name,
      ...(style?.iconCustomEmojiId === undefined
        ? {}
        : { icon_custom_emoji_id: style.iconCustomEmojiId }),
      ...(style?.iconColor === undefined ? {} : { icon_color: style.iconColor }),
    });
    const threadId = objectResult(body.result)?.['message_thread_id'];
    if (typeof threadId !== 'number' || !Number.isInteger(threadId) || threadId <= 0) {
      throw new Error('TELEGRAM_INVALID_RESPONSE');
    }
    return { messageThreadId: String(threadId) };
  }

  public async editTopicIcon(
    chatId: string,
    messageThreadId: string,
    iconCustomEmojiId: string,
  ): Promise<void> {
    await this.requestOk('editForumTopic', {
      chat_id: chatId,
      ...threadIdPayload({ messageThreadId }),
      icon_custom_emoji_id: iconCustomEmojiId,
    });
  }

  public answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
    return this.requestOk('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      ...(text === undefined ? {} : { text }),
    });
  }

  public async getUpdates(offset: number, timeoutSeconds: number): Promise<readonly unknown[]> {
    if (!Number.isInteger(offset) || offset < 0 || timeoutSeconds < 0 || timeoutSeconds > 50) {
      throw new Error('TELEGRAM_INVALID_RESPONSE');
    }
    const body = await this.request(
      'getUpdates',
      {
        offset,
        timeout: timeoutSeconds,
        allowed_updates: ['message', 'callback_query'],
      },
      (timeoutSeconds + 5) * 1_000,
    );
    const rows = body.result;
    if (!Array.isArray(rows)) {
      return [];
    }
    const updates: unknown[] = [];
    for (const row of rows) {
      updates.push(row);
    }
    return updates;
  }

  public deleteWebhook(): Promise<void> {
    return this.requestOk('deleteWebhook', { drop_pending_updates: false });
  }

  public setWebhook(url: string, secretToken: string): Promise<void> {
    return this.requestOk('setWebhook', {
      url,
      secret_token: secretToken,
      allowed_updates: ['message', 'callback_query'],
    });
  }

  public async getWebhookInfo(): Promise<{
    readonly url: string;
    readonly lastErrorDate: number | null;
  }> {
    const body = await this.request('getWebhookInfo', {});
    const result = objectResult(body.result);
    const url = result?.['url'];
    const lastErrorDate = result?.['last_error_date'];
    return {
      url: typeof url === 'string' ? url : '',
      lastErrorDate:
        typeof lastErrorDate === 'number' && Number.isInteger(lastErrorDate) && lastErrorDate > 0
          ? lastErrorDate
          : null,
    };
  }

  private async requestMessage(
    method: string,
    payload: Record<string, unknown>,
  ): Promise<TelegramSentMessage> {
    const body = await this.request(method, payload);
    const messageId = objectResult(body.result)?.['message_id'];
    if (typeof messageId !== 'number' || !Number.isInteger(messageId) || messageId < 0) {
      throw new Error('TELEGRAM_INVALID_RESPONSE');
    }
    return { messageId: String(messageId) };
  }

  private async requestOk(method: string, payload: Record<string, unknown>): Promise<void> {
    await this.request(method, payload);
  }

  private async request(
    method: string,
    payload: Record<string, unknown>,
    timeoutMs = 10_000,
  ): Promise<{
    readonly ok?: unknown;
    readonly result?: unknown;
    readonly description?: unknown;
  }> {
    const response = await this.fetchImplementation(new URL(method, this.apiBaseUrl), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Connection: 'close',
      },
      body: JSON.stringify(payload),
      keepalive: false,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const contentLength = Number(response.headers.get('content-length') ?? '0');
    if (Number.isFinite(contentLength) && contentLength > 1_048_576) {
      throw new Error('TELEGRAM_RESPONSE_TOO_LARGE');
    }
    const rawBody = await response.text();
    if (Buffer.byteLength(rawBody, 'utf8') > 1_048_576) {
      throw new Error('TELEGRAM_RESPONSE_TOO_LARGE');
    }
    let body: {
      readonly ok?: unknown;
      readonly result?: unknown;
      readonly description?: unknown;
    };
    try {
      body = JSON.parse(rawBody) as {
        readonly ok?: unknown;
        readonly result?: unknown;
        readonly description?: unknown;
      };
    } catch {
      throw new Error(
        response.ok ? 'TELEGRAM_INVALID_RESPONSE' : `TELEGRAM_HTTP_${String(response.status)}`,
      );
    }
    if (!response.ok) {
      throw new Error(
        mappedTelegramError(body.description) ?? `TELEGRAM_HTTP_${String(response.status)}`,
      );
    }
    if (body.ok !== true) {
      throw new Error(mappedTelegramError(body.description) ?? 'TELEGRAM_API_ERROR');
    }
    return body;
  }
}

function objectResult(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function threadIdPayload(options: TelegramSendOptions | undefined): Record<string, number> {
  if (options?.messageThreadId === undefined) {
    return {};
  }
  if (!/^\d{1,20}$/u.test(options.messageThreadId)) {
    throw new Error('TELEGRAM_INVALID_TOPIC');
  }
  return { message_thread_id: Number(options.messageThreadId) };
}

function mappedTelegramError(description: unknown): string | null {
  if (typeof description !== 'string') {
    return null;
  }
  const normalized = description.toLowerCase();
  if (normalized.includes('message is not modified')) {
    return 'TELEGRAM_MESSAGE_UNCHANGED';
  }
  if (normalized.includes('terminated by other getupdates')) {
    return 'TELEGRAM_POLLING_CONFLICT';
  }
  if (
    normalized.includes('thread not found') ||
    normalized.includes('topic not found') ||
    normalized.includes('topic_closed') ||
    normalized.includes('topic_deleted')
  ) {
    return 'TELEGRAM_TOPIC_MISSING';
  }
  if (
    normalized.includes('not a forum') ||
    normalized.includes('forums_disabled') ||
    normalized.includes('topics feature')
  ) {
    return 'TELEGRAM_FORUM_DISABLED';
  }
  if (normalized.includes('not enough rights') || normalized.includes('can_manage_topics')) {
    return 'TELEGRAM_FORUM_RIGHTS_MISSING';
  }
  return null;
}
