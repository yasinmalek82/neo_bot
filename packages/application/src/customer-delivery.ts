import {
  DomainConflictError,
  type ClaimedDeliveryJob,
  type CustomerDeliveryJob,
} from '@neo-bot/domain';

import type { CommerceRepository } from './commerce-ports.js';

const MAX_DELIVERY_ATTEMPTS = 8;
const MAX_BACKOFF_MS = 15 * 60_000;

export interface CustomerDeliveryTransport {
  /** Returns false when optional brand media is not configured; throws on Telegram failure. */
  sendBrandPhoto(chatId: string): Promise<boolean>;
  sendAnchorMessage(chatId: string): Promise<{ readonly messageId: string }>;
  editMessageText(chatId: string, messageId: string, text: string): Promise<void>;
}

export class CustomerDeliveryUseCase {
  public constructor(
    private readonly repository: CommerceRepository,
    private readonly transport: CustomerDeliveryTransport | null,
    private readonly composeDeliveryText: (subscriptionUrl: string) => string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Dispatches due delivery jobs. Every claim is committed before Telegram I/O and
   * every Telegram call happens outside a database transaction. The subscription URL
   * is resolved from persisted records only at dispatch time and never stored on
   * the job.
   */
  public async dispatchDue(limit = 10): Promise<void> {
    await this.repository.backfillMissingDeliveryJobs(this.now());
    const claimed = await this.repository.claimDueDeliveryJobs(limit, this.now());
    for (const job of claimed) {
      await this.dispatchOne(job);
    }
  }

  /**
   * Administrator-only retry of a failed or stuck delivery. It rewinds only the
   * delivery job; provisioning is never re-run and PasarGuard is never called.
   */
  public async resetForOrder(orderId: string): Promise<CustomerDeliveryJob> {
    const job = await this.repository.getDeliveryJobForOrder(orderId);
    if (job === null) {
      throw new DomainConflictError('DELIVERY_JOB_NOT_FOUND');
    }
    if (job.stage === 'delivered') {
      throw new DomainConflictError('DELIVERY_ALREADY_COMPLETED');
    }
    return this.repository.resetDeliveryJob(orderId, this.now());
  }

  public async getJobForOrder(orderId: string): Promise<CustomerDeliveryJob | null> {
    return this.repository.getDeliveryJobForOrder(orderId);
  }

  private async dispatchOne(job: ClaimedDeliveryJob): Promise<void> {
    try {
      const target = await this.repository.getOrderDeliveryTarget(job.orderId);
      if (target === null) {
        throw new DomainConflictError('DELIVERY_TARGET_MISSING');
      }
      let stage = job.stage;
      if (stage === 'pending_brand_media') {
        if (this.transport !== null) {
          // Optional media: false means unconfigured, a throw means a retryable failure.
          await this.transport.sendBrandPhoto(target.chatId);
        }
        await this.repository.markDeliveryJobBrandSent(job.id, this.now());
        stage = 'pending_link';
      }
      if (stage === 'pending_link') {
        await this.deliverLink(job, target.chatId);
      }
    } catch (error: unknown) {
      await this.handleDispatchFailure(job, error);
    }
  }

  private async deliverLink(job: ClaimedDeliveryJob, chatId: string): Promise<void> {
    if (this.transport === null) {
      throw new DomainConflictError('DELIVERY_TRANSPORT_UNAVAILABLE');
    }
    let messageId = job.telegramMessageId;
    if (messageId === null) {
      const anchor = await this.transport.sendAnchorMessage(chatId);
      await this.repository.markDeliveryJobAnchor(job.id, anchor.messageId, this.now());
      messageId = anchor.messageId;
    }
    try {
      await this.transport.editMessageText(
        chatId,
        messageId,
        this.composeDeliveryText(await this.requiredSubscriptionUrl(job.orderId)),
      );
    } catch (error: unknown) {
      // A crash after the edit but before completion replays as an unchanged edit.
      if (!(error instanceof Error && error.message === 'TELEGRAM_MESSAGE_UNCHANGED')) {
        throw error;
      }
    }
    await this.repository.markDeliveryJobDelivered(job.id, this.now());
  }

  private async requiredSubscriptionUrl(orderId: string): Promise<string> {
    const target = await this.repository.getOrderDeliveryTarget(orderId);
    if (target === null) {
      throw new DomainConflictError('DELIVERY_TARGET_MISSING');
    }
    return target.subscriptionUrl;
  }

  private async handleDispatchFailure(job: ClaimedDeliveryJob, error: unknown): Promise<void> {
    const code = deliveryErrorCode(error);
    const now = this.now();
    if (!isRetryableDeliveryError(code) || job.attemptCount >= MAX_DELIVERY_ATTEMPTS) {
      await this.repository.failDeliveryJob(job.id, code, now);
      return;
    }
    await this.repository.retryDeliveryJob(
      job.id,
      code,
      nextDeliveryAttemptAt(job.attemptCount, now),
      now,
    );
  }
}

export function nextDeliveryAttemptAt(attemptCount: number, now: Date): Date {
  const exponent = Math.max(attemptCount - 1, 0);
  const delayMs = Math.min(30_000 * 2 ** exponent, MAX_BACKOFF_MS);
  return new Date(now.getTime() + delayMs);
}

function deliveryErrorCode(error: unknown): string {
  if (error instanceof DomainConflictError) {
    return error.code;
  }
  if (error instanceof Error && /^[A-Z0-9_]{3,80}$/u.test(error.message)) {
    return error.message;
  }
  return 'DELIVERY_TRANSPORT_FAILED';
}

function isRetryableDeliveryError(code: string): boolean {
  // Delivery is at-least-once: unknown failures stay retryable until the attempt
  // cap so a crash or transport hiccup cannot strand a fulfilled customer.
  return !DEFINITE_DELIVERY_FAILURES.has(code);
}

const DEFINITE_DELIVERY_FAILURES = new Set<string>([
  'DELIVERY_TARGET_MISSING',
  'DELIVERY_TRANSPORT_UNAVAILABLE',
]);
