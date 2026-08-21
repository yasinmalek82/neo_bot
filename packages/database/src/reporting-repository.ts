import { DomainConflictError } from '@neo-bot/domain';
import {
  REPORT_TOPIC_PURPOSES,
  type ClaimedReportingDelivery,
  type ForumTopicBindings,
  type RecordedReportingEvent,
  type ReportableEventInput,
  type ReportingEventType,
  type ReportingPayload,
  type ReportingRepository,
  type ReportTopicPurpose,
} from '@neo-bot/application';
import type { Pool, PoolClient } from 'pg';

interface EventRow {
  id: string;
  event_type: ReportingEventType;
  occurrence_key: string;
  payload: ReportingPayload;
}

interface DeliveryClaimRow {
  id: string;
  event_id: string;
  event_type: ReportingEventType;
  payload: ReportingPayload;
  purpose: ReportTopicPurpose;
  destination_id: string;
  chat_id: string;
  message_thread_id: string | null;
  attempt_count: number;
}

export class PostgresReportingRepository implements ReportingRepository {
  public constructor(private readonly pool: Pool) {}

  public async recordEvent(input: ReportableEventInput): Promise<RecordedReportingEvent> {
    const inserted = await this.pool.query<EventRow>(
      `insert into reporting_events(event_type, occurrence_key, payload)
       values ($1, $2, $3::jsonb)
       on conflict (occurrence_key) do nothing
       returning id::text, event_type, occurrence_key, payload`,
      [input.type, input.occurrenceKey, JSON.stringify(input.payload)],
    );
    const created = inserted.rows[0];
    if (created !== undefined) {
      return mapEvent(created, true);
    }
    const existing = await this.pool.query<EventRow>(
      `select id::text, event_type, occurrence_key, payload
       from reporting_events
       where occurrence_key = $1`,
      [input.occurrenceKey],
    );
    return mapEvent(requiredRow(existing.rows), false);
  }

  public async enqueueDeliveries(eventId: string): Promise<void> {
    await this.pool.query(
      `insert into reporting_deliveries(event_id, destination_id, status)
       select $1, destination.id, 'pending'
       from report_destinations destination
       where destination.active = true and destination.kind = 'telegram_forum'
       on conflict (event_id, destination_id) do nothing`,
      [eventId],
    );
  }

  public async backfillMissingDeliveries(): Promise<void> {
    await this.pool.query(
      `insert into reporting_deliveries(event_id, destination_id, status)
       select event.id, destination.id, 'pending'
       from reporting_events event
       join report_destinations destination
         on destination.active = true and destination.kind = 'telegram_forum'
       where not exists (
         select 1 from reporting_deliveries delivery
         where delivery.event_id = event.id and delivery.destination_id = destination.id
       )`,
    );
  }

  public async replaceForumDestination(input: {
    readonly chatId: string;
    readonly topics: ForumTopicBindings;
  }): Promise<string> {
    requireChatId(input.chatId);
    return this.withTransaction(async (client) => {
      await client.query(
        `update report_destinations
         set active = false, updated_at = now()
         where kind = 'telegram_forum' and active = true`,
      );
      const destination = await client.query<{ id: string }>(
        `insert into report_destinations(code, kind, telegram_chat_id, active)
         values ('ops-forum', 'telegram_forum', $1, true)
         on conflict (code) do update set
           telegram_chat_id = excluded.telegram_chat_id,
           kind = 'telegram_forum',
           active = true,
           updated_at = now()
         returning id::text`,
        [input.chatId],
      );
      const destinationId = requiredRow(destination.rows).id;
      await client.query('delete from report_topic_bindings where destination_id = $1', [
        destinationId,
      ]);
      for (const [purpose, threadId] of Object.entries(input.topics)) {
        if (typeof threadId !== 'string') {
          continue;
        }
        if (!isReportTopicPurpose(purpose)) {
          throw new DomainConflictError('INVALID_REPORT_PURPOSE');
        }
        requireThreadId(threadId);
        await client.query(
          `insert into report_topic_bindings(
             destination_id, purpose, telegram_message_thread_id
           ) values ($1, $2, $3)`,
          [destinationId, purpose, threadId],
        );
      }
      return destinationId;
    });
  }

  public async ensureForumDestination(chatId: string): Promise<{
    readonly id: string;
    readonly chatId: string;
    readonly topics: ForumTopicBindings;
  }> {
    requireChatId(chatId);
    return this.withTransaction(async (client) => {
      const current = await client.query<{ id: string; telegram_chat_id: string }>(
        `select id::text, telegram_chat_id::text
         from report_destinations
         where kind = 'telegram_forum' and active = true
         limit 1`,
      );
      const active = current.rows[0];
      if (active?.telegram_chat_id === chatId) {
        return {
          id: active.id,
          chatId,
          topics: await loadTopicBindings(client, active.id),
        };
      }
      await client.query(
        `update report_destinations
         set active = false, updated_at = now()
         where kind = 'telegram_forum' and active = true`,
      );
      const destination = await client.query<{ id: string }>(
        `insert into report_destinations(code, kind, telegram_chat_id, active)
         values ('ops-forum', 'telegram_forum', $1, true)
         on conflict (code) do update set
           telegram_chat_id = excluded.telegram_chat_id,
           kind = 'telegram_forum',
           active = true,
           updated_at = now()
         returning id::text`,
        [chatId],
      );
      const destinationId = requiredRow(destination.rows).id;
      if (active !== undefined) {
        await client.query('delete from report_topic_bindings where destination_id = $1', [
          destinationId,
        ]);
      }
      return {
        id: destinationId,
        chatId,
        topics: await loadTopicBindings(client, destinationId),
      };
    });
  }

  public async upsertTopicBinding(
    destinationId: string,
    purpose: ReportTopicPurpose,
    messageThreadId: string,
  ): Promise<void> {
    if (!isReportTopicPurpose(purpose)) {
      throw new DomainConflictError('INVALID_REPORT_PURPOSE');
    }
    requireThreadId(messageThreadId);
    const result = await this.pool.query(
      `insert into report_topic_bindings(
         destination_id, purpose, telegram_message_thread_id
       ) values ($1, $2, $3)
       on conflict (destination_id, purpose) do update set
         telegram_message_thread_id = excluded.telegram_message_thread_id`,
      [destinationId, purpose, messageThreadId],
    );
    if (result.rowCount === 0) {
      throw new DomainConflictError('DATABASE_ROW_NOT_FOUND');
    }
  }

  public async claimDueDeliveries(
    limit: number,
    now: Date,
  ): Promise<readonly ClaimedReportingDelivery[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new DomainConflictError('INVALID_REPORT_DISPATCH_LIMIT');
    }
    const result = await this.pool.query<DeliveryClaimRow>(
      `with claimed as (
         select delivery.id
         from reporting_deliveries delivery
         where delivery.status = 'pending' and delivery.next_attempt_at <= $2
         order by delivery.id
         for update skip locked
         limit $1
       ),
       updated as (
         update reporting_deliveries delivery
         set attempt_count = delivery.attempt_count + 1,
             next_attempt_at = $2 + interval '2 minutes',
             updated_at = $2
         from claimed
         where delivery.id = claimed.id
         returning
           delivery.id,
           delivery.event_id,
           delivery.destination_id,
           delivery.attempt_count
       )
       select
         updated.id::text,
         event.id::text as event_id,
         event.event_type,
         event.payload,
         case event.event_type
           when 'customer.first_contact' then 'new_users'
           when 'customer.activity' then 'new_users'
           when 'order.created' then 'orders'
           when 'payment.proof_submitted' then 'receipts'
           when 'payment.approved' then 'receipts'
           when 'payment.rejected' then 'receipts'
           when 'provisioning.succeeded' then 'sales'
           when 'provisioning.failed' then 'errors'
           when 'renewal.requested' then 'renewals'
           when 'renewal.completed' then 'renewals'
           when 'renewal.failed' then 'renewals'
           when 'ops.daily_summary' then 'daily_summaries'
           else 'errors'
         end as purpose,
         destination.id::text as destination_id,
         destination.telegram_chat_id::text as chat_id,
         binding.telegram_message_thread_id::text as message_thread_id,
         updated.attempt_count
       from updated
       join reporting_events event on event.id = updated.event_id
       join report_destinations destination on destination.id = updated.destination_id
       left join report_topic_bindings binding
         on binding.destination_id = destination.id
        and binding.purpose = case event.event_type
           when 'customer.first_contact' then 'new_users'
           when 'customer.activity' then 'new_users'
           when 'order.created' then 'orders'
           when 'payment.proof_submitted' then 'receipts'
           when 'payment.approved' then 'receipts'
           when 'payment.rejected' then 'receipts'
           when 'provisioning.succeeded' then 'sales'
           when 'provisioning.failed' then 'errors'
           when 'renewal.requested' then 'renewals'
           when 'renewal.completed' then 'renewals'
           when 'renewal.failed' then 'renewals'
           when 'ops.daily_summary' then 'daily_summaries'
           else 'errors'
         end`,
      [limit, now],
    );
    return result.rows.map((row) => mapClaim(row, row.purpose));
  }

  public async markDelivered(
    deliveryId: string,
    telegramMessageId: string,
    deliveredAt: Date,
  ): Promise<void> {
    requireTelegramMessageId(telegramMessageId);
    const result = await this.pool.query(
      `update reporting_deliveries
       set status = 'delivered',
           telegram_message_id = $2,
           delivered_at = $3,
           last_error_code = null,
           updated_at = $3
       where id = $1 and status = 'pending'`,
      [deliveryId, telegramMessageId, deliveredAt],
    );
    if (result.rowCount === 0) {
      throw new DomainConflictError('REPORT_DELIVERY_NOT_PENDING');
    }
  }

  public async retryLater(
    deliveryId: string,
    errorCode: string,
    nextAttemptAt: Date,
  ): Promise<void> {
    await this.pool.query(
      `update reporting_deliveries
       set status = 'pending',
           last_error_code = $2,
           next_attempt_at = $3,
           updated_at = $3
       where id = $1`,
      [deliveryId, errorCode.slice(0, 120), nextAttemptAt],
    );
  }

  public async markFailed(deliveryId: string, errorCode: string, failedAt: Date): Promise<void> {
    await this.pool.query(
      `update reporting_deliveries
       set status = 'failed',
           last_error_code = $2,
           updated_at = $3
       where id = $1`,
      [deliveryId, errorCode.slice(0, 120), failedAt],
    );
  }

  private async withTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const result = await work(client);
      await client.query('commit');
      return result;
    } catch (error: unknown) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }
}

function mapEvent(row: EventRow, created: boolean): RecordedReportingEvent {
  return {
    id: row.id,
    type: row.event_type,
    occurrenceKey: row.occurrence_key,
    payload: row.payload,
    created,
  };
}

function mapClaim(row: DeliveryClaimRow, purpose: ReportTopicPurpose): ClaimedReportingDelivery {
  return {
    id: row.id,
    eventId: row.event_id,
    eventType: row.event_type,
    payload: row.payload,
    purpose,
    destinationId: row.destination_id,
    chatId: row.chat_id,
    messageThreadId: row.message_thread_id,
    attemptCount: row.attempt_count,
  };
}

function requiredRow<T>(rows: readonly T[]): T {
  const row = rows[0];
  if (row === undefined) {
    throw new DomainConflictError('DATABASE_ROW_NOT_FOUND');
  }
  return row;
}

function requireChatId(value: string): void {
  if (!/^-?\d{1,20}$/u.test(value)) {
    throw new DomainConflictError('INVALID_REPORT_CHAT_ID');
  }
}

function requireThreadId(value: string): void {
  if (!/^\d{1,20}$/u.test(value) || value === '0') {
    throw new DomainConflictError('INVALID_REPORT_TOPIC_ID');
  }
}

function requireTelegramMessageId(value: string): void {
  if (!/^\d{1,20}$/u.test(value)) {
    throw new DomainConflictError('INVALID_TELEGRAM_MESSAGE_ID');
  }
}

function isReportTopicPurpose(value: string): value is ReportTopicPurpose {
  return (REPORT_TOPIC_PURPOSES as readonly string[]).includes(value);
}

async function loadTopicBindings(
  client: PoolClient,
  destinationId: string,
): Promise<ForumTopicBindings> {
  const bindings = await client.query<{
    purpose: ReportTopicPurpose;
    telegram_message_thread_id: string;
  }>(
    `select purpose, telegram_message_thread_id::text
     from report_topic_bindings
     where destination_id = $1`,
    [destinationId],
  );
  const topics: Record<string, string> = {};
  for (const row of bindings.rows) {
    topics[row.purpose] = row.telegram_message_thread_id;
  }
  return topics;
}
