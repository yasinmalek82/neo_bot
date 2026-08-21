import { z } from 'zod';

const telegramUserSchema = z
  .object({
    id: z.number().int().positive(),
    first_name: z.string().min(1).max(200),
    last_name: z.string().max(200).optional(),
    username: z.string().max(64).optional(),
  })
  .loose();

const telegramChatSchema = z
  .object({
    id: z.number().int(),
    type: z.enum(['private', 'group', 'supergroup', 'channel']),
  })
  .loose();

const telegramPhotoSchema = z
  .object({
    file_id: z.string().min(1).max(512),
    file_unique_id: z.string().min(1).max(128),
    width: z.number().int().nonnegative(),
    height: z.number().int().nonnegative(),
  })
  .loose();

const telegramDocumentSchema = z
  .object({
    file_id: z.string().min(1).max(512),
    file_unique_id: z.string().min(1).max(128),
    mime_type: z.string().max(200).optional(),
    file_name: z.string().max(200).optional(),
  })
  .loose();

const telegramMessageSchema = z
  .object({
    message_id: z.number().int().nonnegative(),
    from: telegramUserSchema.optional(),
    chat: telegramChatSchema,
    text: z.string().max(4_096).optional(),
    photo: z.array(telegramPhotoSchema).min(1).optional(),
    document: telegramDocumentSchema.optional(),
    video: z.unknown().optional(),
    voice: z.unknown().optional(),
    audio: z.unknown().optional(),
    sticker: z.unknown().optional(),
    animation: z.unknown().optional(),
  })
  .loose();

const telegramCallbackQuerySchema = z
  .object({
    id: z.string().min(1).max(200),
    from: telegramUserSchema,
    message: telegramMessageSchema.optional(),
    data: z.string().min(1).max(64).optional(),
  })
  .loose();

export const telegramUpdateSchema = z
  .object({
    update_id: z.number().int().nonnegative(),
    message: telegramMessageSchema.optional(),
    callback_query: telegramCallbackQuerySchema.optional(),
  })
  .loose();

export type TelegramUpdate = z.infer<typeof telegramUpdateSchema>;

export function readTelegramUpdateId(update: unknown): number | undefined {
  if (typeof update !== 'object' || update === null) {
    return undefined;
  }
  const updateId = (update as { update_id?: unknown }).update_id;
  if (typeof updateId !== 'number' || !Number.isInteger(updateId) || updateId < 0) {
    return undefined;
  }
  return updateId;
}

export function isImageReceiptDocument(
  document: TelegramUpdate['message'] extends infer Message
    ? Message extends { document?: infer Document }
      ? Document
      : never
    : never,
): boolean {
  if (document === undefined) {
    return false;
  }
  const mime = document.mime_type?.toLowerCase() ?? '';
  if (mime.startsWith('image/')) {
    return true;
  }
  const name = document.file_name?.toLowerCase() ?? '';
  return /\.(png|jpe?g|webp|gif)$/u.test(name);
}

export function hasUnsupportedReceiptMedia(
  message: NonNullable<TelegramUpdate['message']>,
): boolean {
  if (message.photo !== undefined || isImageReceiptDocument(message.document)) {
    return false;
  }
  return (
    message.document !== undefined ||
    message.video !== undefined ||
    message.voice !== undefined ||
    message.audio !== undefined ||
    message.sticker !== undefined ||
    message.animation !== undefined
  );
}
