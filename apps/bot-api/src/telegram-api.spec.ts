import { describe, expect, it, vi } from 'vitest';

import { TelegramApiClient } from './telegram-api.js';

describe('TelegramApiClient', () => {
  it('sends forum reports with message_thread_id and returns the message id', async () => {
    const fetchImplementation = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-length': '40' }),
      text: async () => JSON.stringify({ ok: true, result: { message_id: 44 } }),
    });
    const client = new TelegramApiClient('12345:abcdefghijklmnopqrstuvwxyz', fetchImplementation);
    await expect(
      client.send({ chatId: '-100123', messageThreadId: '7', text: 'کاربر جدید' }),
    ).resolves.toEqual({ messageId: '44' });
    const [, options] = fetchImplementation.mock.calls[0] as [URL, { body: string }];
    expect(JSON.parse(options.body)).toMatchObject({
      chat_id: '-100123',
      message_thread_id: 7,
      text: 'کاربر جدید',
    });
  });

  it('maps a deleted forum topic to TELEGRAM_TOPIC_MISSING', async () => {
    const fetchImplementation = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-length': '80' }),
      text: async () => JSON.stringify({ ok: false, description: 'Bad Request: TOPIC_DELETED' }),
    });
    const client = new TelegramApiClient('12345:abcdefghijklmnopqrstuvwxyz', fetchImplementation);
    await expect(client.sendMessage('10001', 'سلام')).rejects.toThrow('TELEGRAM_TOPIC_MISSING');
  });

  it('maps a competing getUpdates session to TELEGRAM_POLLING_CONFLICT', async () => {
    const fetchImplementation = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-length': '120' }),
      text: async () =>
        JSON.stringify({
          ok: false,
          description: 'Conflict: terminated by other getUpdates request',
        }),
    });
    const client = new TelegramApiClient('12345:abcdefghijklmnopqrstuvwxyz', fetchImplementation);
    await expect(client.getUpdates(0, 0)).rejects.toThrow('TELEGRAM_POLLING_CONFLICT');
  });

  it('creates a forum topic and reads is_forum from getChat', async () => {
    const fetchImplementation = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-length': '40' }),
        text: async () => JSON.stringify({ ok: true, result: { is_forum: true } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-length': '60' }),
        text: async () =>
          JSON.stringify({ ok: true, result: { message_thread_id: 17, name: 'سفارش‌ها' } }),
      });
    const client = new TelegramApiClient('12345:abcdefghijklmnopqrstuvwxyz', fetchImplementation);
    await expect(client.inspectForum('-100123')).resolves.toEqual({ isForum: true });
    await expect(client.createTopic('-100123', 'سفارش‌ها')).resolves.toEqual({
      messageThreadId: '17',
    });
  });

  it('creates a topic with a custom emoji icon and lists allowed topic icons', async () => {
    const fetchImplementation = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-length': '80' }),
        text: async () =>
          JSON.stringify({
            ok: true,
            result: [{ custom_emoji_id: 'icon-cart', emoji: '🛒', type: 'custom_emoji' }],
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-length': '40' }),
        text: async () => JSON.stringify({ ok: true, result: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-length': '60' }),
        text: async () =>
          JSON.stringify({ ok: true, result: { message_thread_id: 18, name: 'سفارش‌ها' } }),
      });
    const client = new TelegramApiClient('12345:abcdefghijklmnopqrstuvwxyz', fetchImplementation);
    await expect(client.listTopicIcons()).resolves.toEqual([
      { customEmojiId: 'icon-cart', emoji: '🛒' },
    ]);
    await expect(client.editTopicIcon('-100123', '21', 'icon-cart')).resolves.toBeUndefined();
    await expect(
      client.createTopic('-100123', 'سفارش‌ها', {
        iconCustomEmojiId: 'icon-cart',
        iconColor: 16_766_590,
      }),
    ).resolves.toEqual({ messageThreadId: '18' });
    const [, editOptions] = fetchImplementation.mock.calls[1] as [URL, { body: string }];
    expect(JSON.parse(editOptions.body)).toMatchObject({
      chat_id: '-100123',
      message_thread_id: 21,
      icon_custom_emoji_id: 'icon-cart',
    });
    const [, createOptions] = fetchImplementation.mock.calls[2] as [URL, { body: string }];
    expect(JSON.parse(createOptions.body)).toMatchObject({
      chat_id: '-100123',
      name: 'سفارش‌ها',
      icon_custom_emoji_id: 'icon-cart',
      icon_color: 16_766_590,
    });
  });

  it('parses getUpdates and registers or deletes a webhook without logging the secret', async () => {
    const fetchImplementation = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-length': '80' }),
        text: async () => JSON.stringify({ ok: true, result: [{ update_id: 9, message: {} }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-length': '24' }),
        text: async () => JSON.stringify({ ok: true, result: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-length': '24' }),
        text: async () => JSON.stringify({ ok: true, result: true }),
      });
    const client = new TelegramApiClient('12345:abcdefghijklmnopqrstuvwxyz', fetchImplementation);
    await expect(client.getUpdates(0, 0)).resolves.toEqual([{ update_id: 9, message: {} }]);
    await expect(client.deleteWebhook()).resolves.toBeUndefined();
    await expect(
      client.setWebhook('https://bot.example.com/telegram/webhook', 'safe_webhook_secret_123'),
    ).resolves.toBeUndefined();
    const [, getUpdatesOptions] = fetchImplementation.mock.calls[0] as [URL, { body: string }];
    expect(JSON.parse(getUpdatesOptions.body)).toMatchObject({
      offset: 0,
      timeout: 0,
      allowed_updates: ['message', 'callback_query'],
    });
    const [setWebhookUrl, setWebhookOptions] = fetchImplementation.mock.calls[2] as [
      URL,
      { body: string },
    ];
    expect(setWebhookUrl.pathname.endsWith('/setWebhook')).toBe(true);
    expect(JSON.parse(setWebhookOptions.body)).toMatchObject({
      url: 'https://bot.example.com/telegram/webhook',
      secret_token: 'safe_webhook_secret_123',
    });
  });

  it('reads getWebhookInfo url and last_error_date without keeping Telegram descriptions', async () => {
    const fetchImplementation = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-length': '120' }),
      text: async () =>
        JSON.stringify({
          ok: true,
          result: {
            url: 'https://bot.example.com/telegram/webhook',
            last_error_date: 1_700_000_000,
            last_error_message: 'should-not-be-returned',
          },
        }),
    });
    const client = new TelegramApiClient('12345:abcdefghijklmnopqrstuvwxyz', fetchImplementation);
    await expect(client.getWebhookInfo()).resolves.toEqual({
      url: 'https://bot.example.com/telegram/webhook',
      lastErrorDate: 1_700_000_000,
    });
  });

  it('sends HTML customer menus and edits the same inline keyboard message', async () => {
    const fetchImplementation = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-length': '40' }),
        text: async () => JSON.stringify({ ok: true, result: { message_id: 12 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-length': '24' }),
        text: async () => JSON.stringify({ ok: true, result: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-length': '24' }),
        text: async () => JSON.stringify({ ok: true, result: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-length': '24' }),
        text: async () => JSON.stringify({ ok: true, result: true }),
      });
    const client = new TelegramApiClient('12345:abcdefghijklmnopqrstuvwxyz', fetchImplementation);
    await expect(
      client.sendMessage(
        '10001',
        '<b>خوش آمدی</b>',
        { inline_keyboard: [[{ text: '🛍 خرید سرویس', callback_data: 'shop' }]] },
        { parseMode: 'HTML' },
      ),
    ).resolves.toEqual({ messageId: '12' });
    await expect(
      client.editMessageText('10001', '12', '<b>خرید سرویس</b>', {
        inline_keyboard: [[{ text: 'اقتصادی', callback_data: 'cat:10' }]],
      }),
    ).resolves.toBeUndefined();
    await expect(
      client.setMyCommands([{ command: 'start', description: 'منوی فروشگاه' }]),
    ).resolves.toBeUndefined();
    await expect(client.setChatMenuButton('https://mini.example.com/')).resolves.toBeUndefined();
    const [, sendOptions] = fetchImplementation.mock.calls[0] as [URL, { body: string }];
    expect(JSON.parse(sendOptions.body)).toMatchObject({
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: '🛍 خرید سرویس', callback_data: 'shop' }]] },
    });
    const [editUrl, editOptions] = fetchImplementation.mock.calls[1] as [URL, { body: string }];
    expect(editUrl.pathname.endsWith('/editMessageText')).toBe(true);
    expect(JSON.parse(editOptions.body)).toMatchObject({
      chat_id: '10001',
      message_id: 12,
      parse_mode: 'HTML',
    });
  });
});
