import { DomainConflictError } from './errors.js';

export const CONVERSATION_FLOW_IDS = [
  'commerce.purchase',
  'commerce.renewal',
  'wallet.topup',
  'support.ticket',
  'admin.broadcast',
  'admin.ops',
] as const;

export type ConversationFlowId = (typeof CONVERSATION_FLOW_IDS)[number];

export const CONVERSATION_STEPS = [
  'naming',
  'coupon',
  'confirm',
  'amount',
  'create',
  'followup',
  'settings',
] as const;

export type ConversationStep = (typeof CONVERSATION_STEPS)[number];

export const CONVERSATION_SESSION_STATUSES = [
  'pending',
  'canceled',
  'completed',
  'expired',
] as const;

export type ConversationSessionStatus = (typeof CONVERSATION_SESSION_STATUSES)[number];

export const CONVERSATION_SESSION_SCHEMA_VERSION = 1;
export const CONVERSATION_SESSION_TTL_MS = 30 * 60 * 1000;

const FORBIDDEN_PAYLOAD_KEYS = [
  'body',
  'ticketBody',
  'message',
  'text',
  'subscriptionUrl',
  'token',
  'apiKey',
  'fileId',
  'receipt',
] as const;

export const DISCOUNT_CODE_PATTERN = /^[A-Z0-9_-]{3,32}$/u;

export interface CommercePurchasePayload {
  readonly variantId: string;
  readonly variantName: string;
  readonly usernameBase?: string;
  readonly discountCode?: string;
}

export interface CommerceRenewalPayload {
  readonly discountCode?: string;
}

export interface WalletTopUpPayload {
  readonly amountIrr?: string;
  readonly discountCode?: string;
}

export interface SupportTicketPayload {
  readonly mode: 'create' | 'followup';
  readonly ticketId?: string;
}

export interface AdminBroadcastPayload {
  readonly mode: 'create';
}

export const ADMIN_OPS_FIELDS = [
  'channel',
  'reminderDays',
  'trialVariant',
  'blockCustomer',
] as const;

export type AdminOpsField = (typeof ADMIN_OPS_FIELDS)[number];

export interface AdminOpsPayload {
  readonly field: AdminOpsField;
}

export type ConversationPayload =
  | CommercePurchasePayload
  | CommerceRenewalPayload
  | WalletTopUpPayload
  | SupportTicketPayload
  | AdminBroadcastPayload
  | AdminOpsPayload;

export interface DurableConversationSession {
  readonly id: string;
  readonly telegramUserId: string;
  readonly flowId: ConversationFlowId;
  readonly step: ConversationStep;
  readonly schemaVersion: number;
  readonly payload: ConversationPayload;
  readonly status: ConversationSessionStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly expiresAt: Date;
}

export function isConversationFlowId(value: string): value is ConversationFlowId {
  return CONVERSATION_FLOW_IDS.some((id) => id === value);
}

export function isConversationStep(value: string): value is ConversationStep {
  return CONVERSATION_STEPS.some((step) => step === value);
}

export function normalizeDiscountCode(code: string): string {
  return code.trim().toUpperCase();
}

export function validateDiscountCode(code: string): string {
  const normalized = normalizeDiscountCode(code);
  if (!DISCOUNT_CODE_PATTERN.test(normalized)) {
    throw new DomainConflictError('INVALID_DISCOUNT_CODE');
  }
  return normalized;
}

export function parseWalletAmountIrr(raw: string): bigint {
  const digits = normalizeAmountDigits(raw);
  if (digits.length === 0 || digits.length > 15) {
    throw new DomainConflictError('INVALID_WALLET_AMOUNT');
  }
  const amount = BigInt(digits);
  if (amount <= 0n) {
    throw new DomainConflictError('INVALID_WALLET_AMOUNT');
  }
  return amount;
}

export function validateTicketBody(body: string): string {
  const trimmed = body.trim();
  if (trimmed.length === 0 || trimmed.length > 4000) {
    throw new DomainConflictError('INVALID_TICKET_BODY');
  }
  return trimmed;
}

export function parseConversationPayload(
  flowId: ConversationFlowId,
  step: ConversationStep,
  payload: unknown,
): ConversationPayload {
  if (!isPlainObject(payload)) {
    throw new DomainConflictError('MALFORMED_CONVERSATION_SESSION');
  }
  for (const key of FORBIDDEN_PAYLOAD_KEYS) {
    if (key in payload) {
      throw new DomainConflictError('MALFORMED_CONVERSATION_SESSION');
    }
  }
  switch (flowId) {
    case 'commerce.purchase':
      return parsePurchasePayload(step, payload);
    case 'commerce.renewal':
      return parseRenewalPayload(step, payload);
    case 'wallet.topup':
      return parseWalletPayload(step, payload);
    case 'support.ticket':
      return parseSupportPayload(step, payload);
    case 'admin.broadcast':
      return parseBroadcastPayload(step, payload);
    case 'admin.ops':
      return parseAdminOpsPayload(step, payload);
  }
}

export function parseDurableConversationSession(input: {
  readonly id: string;
  readonly telegramUserId: string;
  readonly flowId: string;
  readonly step: string;
  readonly schemaVersion: number;
  readonly payload: unknown;
  readonly status: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly expiresAt: Date;
}): DurableConversationSession {
  if (!/^[0-9a-f-]{36}$/iu.test(input.id)) {
    throw new DomainConflictError('MALFORMED_CONVERSATION_SESSION');
  }
  if (!/^\d{1,20}$/u.test(input.telegramUserId)) {
    throw new DomainConflictError('MALFORMED_CONVERSATION_SESSION');
  }
  if (!isConversationFlowId(input.flowId) || !isConversationStep(input.step)) {
    throw new DomainConflictError('MALFORMED_CONVERSATION_SESSION');
  }
  if (input.schemaVersion !== CONVERSATION_SESSION_SCHEMA_VERSION) {
    throw new DomainConflictError('MALFORMED_CONVERSATION_SESSION');
  }
  const status = CONVERSATION_SESSION_STATUSES.find((candidate) => candidate === input.status);
  if (status === undefined) {
    throw new DomainConflictError('MALFORMED_CONVERSATION_SESSION');
  }
  return {
    id: input.id,
    telegramUserId: input.telegramUserId,
    flowId: input.flowId,
    step: input.step,
    schemaVersion: input.schemaVersion,
    payload: parseConversationPayload(input.flowId, input.step, input.payload),
    status,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    expiresAt: input.expiresAt,
  };
}

function parsePurchasePayload(
  step: ConversationStep,
  payload: Record<string, unknown>,
): CommercePurchasePayload {
  if (step !== 'naming' && step !== 'coupon') {
    throw new DomainConflictError('MALFORMED_CONVERSATION_SESSION');
  }
  const variantId = requiredId(payload['variantId']);
  const variantName = requiredName(payload['variantName']);
  const usernameBase =
    payload['usernameBase'] === undefined ? undefined : requiredUsername(payload['usernameBase']);
  const discountCode =
    payload['discountCode'] === undefined
      ? undefined
      : validateDiscountCode(requiredString(payload['discountCode']));
  if (step === 'coupon' && usernameBase === undefined) {
    throw new DomainConflictError('MALFORMED_CONVERSATION_SESSION');
  }
  return {
    variantId,
    variantName,
    ...(usernameBase === undefined ? {} : { usernameBase }),
    ...(discountCode === undefined ? {} : { discountCode }),
  };
}

function parseRenewalPayload(
  step: ConversationStep,
  payload: Record<string, unknown>,
): CommerceRenewalPayload {
  if (step !== 'coupon' && step !== 'confirm') {
    throw new DomainConflictError('MALFORMED_CONVERSATION_SESSION');
  }
  const discountCode =
    payload['discountCode'] === undefined
      ? undefined
      : validateDiscountCode(requiredString(payload['discountCode']));
  return discountCode === undefined ? {} : { discountCode };
}

function parseWalletPayload(
  step: ConversationStep,
  payload: Record<string, unknown>,
): WalletTopUpPayload {
  if (step !== 'amount' && step !== 'coupon') {
    throw new DomainConflictError('MALFORMED_CONVERSATION_SESSION');
  }
  const amountIrr =
    payload['amountIrr'] === undefined
      ? undefined
      : parseWalletAmountIrr(requiredString(payload['amountIrr'])).toString();
  const discountCode =
    payload['discountCode'] === undefined
      ? undefined
      : validateDiscountCode(requiredString(payload['discountCode']));
  if (step === 'coupon' && amountIrr === undefined) {
    throw new DomainConflictError('MALFORMED_CONVERSATION_SESSION');
  }
  return {
    ...(amountIrr === undefined ? {} : { amountIrr }),
    ...(discountCode === undefined ? {} : { discountCode }),
  };
}

function parseSupportPayload(
  step: ConversationStep,
  payload: Record<string, unknown>,
): SupportTicketPayload {
  if (step === 'create') {
    if (payload['mode'] !== 'create') {
      throw new DomainConflictError('MALFORMED_CONVERSATION_SESSION');
    }
    return { mode: 'create' };
  }
  if (step === 'followup') {
    if (payload['mode'] !== 'followup') {
      throw new DomainConflictError('MALFORMED_CONVERSATION_SESSION');
    }
    return { mode: 'followup', ticketId: requiredId(payload['ticketId']) };
  }
  throw new DomainConflictError('MALFORMED_CONVERSATION_SESSION');
}

function parseBroadcastPayload(
  step: ConversationStep,
  payload: Record<string, unknown>,
): AdminBroadcastPayload {
  if (step !== 'create' || payload['mode'] !== 'create') {
    throw new DomainConflictError('MALFORMED_CONVERSATION_SESSION');
  }
  return { mode: 'create' };
}

function parseAdminOpsPayload(
  step: ConversationStep,
  payload: Record<string, unknown>,
): AdminOpsPayload {
  if (step !== 'settings') {
    throw new DomainConflictError('MALFORMED_CONVERSATION_SESSION');
  }
  const field = payload['field'];
  if (typeof field !== 'string' || !ADMIN_OPS_FIELDS.some((item) => item === field)) {
    throw new DomainConflictError('MALFORMED_CONVERSATION_SESSION');
  }
  return { field: field as AdminOpsField };
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string') {
    throw new DomainConflictError('MALFORMED_CONVERSATION_SESSION');
  }
  return value;
}

function requiredId(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{1,20}$/u.test(value)) {
    throw new DomainConflictError('MALFORMED_CONVERSATION_SESSION');
  }
  return value;
}

function requiredName(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 120) {
    throw new DomainConflictError('MALFORMED_CONVERSATION_SESSION');
  }
  return value;
}

function requiredUsername(value: unknown): string {
  if (typeof value !== 'string') {
    throw new DomainConflictError('MALFORMED_CONVERSATION_SESSION');
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeAmountDigits(raw: string): string {
  const persian = '۰۱۲۳۴۵۶۷۸۹';
  return raw
    .trim()
    .replace(/[۰-۹]/gu, (digit) => String(persian.indexOf(digit)))
    .replace(/[,٬_\s]/gu, '')
    .replace(/[^\d]/gu, '');
}
