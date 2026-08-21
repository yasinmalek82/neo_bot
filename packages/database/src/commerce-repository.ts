import { DomainConflictError } from '@neo-bot/domain';
import type {
  CatalogCategory,
  SalesOrder,
  SellableProductVariant,
  TelegramCustomer,
  TelegramCustomerInput,
  TelegramPaymentProof,
} from '@neo-bot/domain';
import type { CommerceRepository } from '@neo-bot/application';
import type { Pool, PoolClient } from 'pg';

interface CategoryRow {
  id: string;
  code: string;
  name: string;
  description: string;
  parent_id: string | null;
  position: number;
}

interface VariantRow {
  id: string;
  code: string;
  product_name: string;
  name: string;
  description: string;
  duration_days: number;
  data_limit_bytes: string;
  device_limit: number;
  price_irr: string;
}

interface CustomerRow {
  id: string;
  telegram_user_id: string;
  private_chat_id: string;
  telegram_username: string | null;
  display_name: string;
}

interface OrderRow {
  id: string;
  customer_id: string;
  product_variant_id: string;
  product_name: string;
  variant_name: string;
  amount_irr: string;
  status: SalesOrder['status'];
  service_id: string | null;
  failure_code: string | null;
  created_at: Date;
  updated_at: Date;
}

interface ProofRow {
  id: string;
  order_id: string;
  telegram_file_id: string;
  telegram_file_unique_id: string;
  submitted_at: Date;
}

export class PostgresCommerceRepository implements CommerceRepository {
  public constructor(private readonly pool: Pool) {}

  public async listCategories(parentId: string | null): Promise<readonly CatalogCategory[]> {
    const result = await this.pool.query<CategoryRow>(
      `select id::text, code, name, description, parent_id::text, position
       from product_categories
       where parent_id is not distinct from $1::bigint and active = true
       order by position, id`,
      [parentId],
    );
    return result.rows.map(mapCategory);
  }

  public async listSellableVariants(
    categoryId: string,
  ): Promise<readonly SellableProductVariant[]> {
    const result = await this.pool.query<VariantRow>(
      `select v.id::text, v.code, product.name as product_name, v.name, v.description,
              v.duration_days, v.data_limit_bytes::text, v.device_limit, v.price_irr::text
       from product_category_assignments assignment
       join products product on product.id = assignment.product_id
       join product_variants v on v.product_id = product.id
       where assignment.category_id = $1 and product.active = true
         and v.active = true and v.sellable = true and v.price_irr > 0
       order by assignment.position, v.duration_days, v.id`,
      [categoryId],
    );
    return result.rows.map(mapSellableVariant);
  }

  public async getSellableVariant(id: string): Promise<SellableProductVariant | null> {
    const result = await this.pool.query<VariantRow>(
      `select v.id::text, v.code, product.name as product_name, v.name, v.description,
              v.duration_days, v.data_limit_bytes::text, v.device_limit, v.price_irr::text
       from product_variants v
       join products product on product.id = v.product_id
       where v.id = $1 and product.active = true
         and v.active = true and v.sellable = true and v.price_irr > 0`,
      [id],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapSellableVariant(row);
  }

  public async upsertTelegramCustomer(
    input: TelegramCustomerInput,
  ): Promise<{ customer: TelegramCustomer; created: boolean }> {
    const result = await this.pool.query<CustomerRow & { inserted: boolean }>(
      `insert into customers(
         telegram_user_id, private_chat_id, telegram_username, display_name, last_seen_at
       ) values ($1, $2, $3, $4, now())
       on conflict (telegram_user_id) do update set
         private_chat_id = excluded.private_chat_id,
         telegram_username = excluded.telegram_username,
         display_name = excluded.display_name,
         last_seen_at = now(),
         updated_at = now()
       returning id::text, telegram_user_id::text, private_chat_id::text,
                 telegram_username, display_name, (xmax = 0) as inserted`,
      [input.telegramUserId, input.privateChatId, input.username ?? null, input.displayName.trim()],
    );
    const row = requiredRow(result.rows);
    return { customer: mapCustomer(row), created: row.inserted };
  }

  public createOrder(
    customerId: string,
    productVariantId: string,
    idempotencyKey: string,
  ): Promise<SalesOrder> {
    return this.withTransaction(async (client) => {
      const customer = await client.query<{ id: string }>(
        'select id::text from customers where id = $1 for update',
        [customerId],
      );
      requiredRow(customer.rows);

      const existing = await this.findOrderByIdempotencyKey(client, idempotencyKey);
      if (existing !== null) {
        if (existing.customerId !== customerId || existing.productVariantId !== productVariantId) {
          throw new DomainConflictError('IDEMPOTENCY_KEY_REUSED');
        }
        return existing;
      }

      const variant = await client.query<{ price_irr: string }>(
        `select price_irr::text
         from product_variants v
         join products product on product.id = v.product_id
         where v.id = $1 and v.active = true and v.sellable = true
           and v.price_irr > 0 and product.active = true`,
        [productVariantId],
      );
      const selected = variant.rows[0];
      if (selected === undefined) {
        throw new DomainConflictError('PRODUCT_VARIANT_NOT_SELLABLE');
      }

      const blocking = await client.query<{ exists: boolean }>(
        `select exists(
           select 1 from sales_orders
           where customer_id = $1 and status in (
             'receipt_submitted', 'provisioning', 'provisioning_failed'
           )
         ) as exists`,
        [customerId],
      );
      if (requiredRow(blocking.rows).exists) {
        throw new DomainConflictError('OPEN_ORDER_UNDER_REVIEW');
      }

      await client.query(
        `update sales_orders set status = 'cancelled', updated_at = now()
         where customer_id = $1 and status in ('awaiting_receipt', 'rejected')`,
        [customerId],
      );
      const inserted = await client.query<{ id: string }>(
        `insert into sales_orders(
           customer_id, product_variant_id, idempotency_key, amount_irr
         ) values ($1, $2, $3, $4)
         returning id::text`,
        [customerId, productVariantId, idempotencyKey, selected.price_irr],
      );
      return this.requiredOrderWithClient(client, requiredRow(inserted.rows).id);
    });
  }

  public async getOrder(id: string): Promise<SalesOrder | null> {
    const result = await this.pool.query<OrderRow>(orderQuery('orders.id = $1'), [id]);
    const row = result.rows[0];
    return row === undefined ? null : mapOrder(row);
  }

  public async getCustomerForOrder(orderId: string): Promise<TelegramCustomer | null> {
    const result = await this.pool.query<CustomerRow>(
      `select customer.id::text, customer.telegram_user_id::text,
              customer.private_chat_id::text, customer.telegram_username,
              customer.display_name
       from sales_orders orders
       join customers customer on customer.id = orders.customer_id
       where orders.id = $1`,
      [orderId],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapCustomer(row);
  }

  public async getOpenOrderForCustomer(customerId: string): Promise<SalesOrder | null> {
    const result = await this.pool.query<OrderRow>(
      `${orderQuery(`orders.customer_id = $1 and orders.status in (
        'awaiting_receipt', 'receipt_submitted', 'provisioning',
        'provisioning_failed', 'rejected'
      )`)} order by orders.id desc limit 1`,
      [customerId],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapOrder(row);
  }

  public async getLatestFulfilledServiceId(customerId: string): Promise<string | null> {
    const result = await this.pool.query<{ service_id: string }>(
      `select orders.service_id::text as service_id
       from sales_orders orders
       where orders.customer_id = $1
         and orders.status = 'fulfilled'
         and orders.service_id is not null
       order by orders.updated_at desc, orders.id desc
       limit 1`,
      [customerId],
    );
    return result.rows[0]?.service_id ?? null;
  }

  public async summarizeUtcDay(
    from: Date,
    to: Date,
  ): Promise<{
    readonly orderCount: string;
    readonly fulfilledCount: string;
    readonly amountIrr: string;
    readonly failedCount: string;
  }> {
    const result = await this.pool.query<{
      order_count: string;
      fulfilled_count: string;
      amount_irr: string;
      failed_count: string;
    }>(
      `select
         count(*)::text as order_count,
         count(*) filter (where status = 'fulfilled')::text as fulfilled_count,
         coalesce(sum(amount_irr) filter (where status = 'fulfilled'), 0)::text as amount_irr,
         count(*) filter (where status = 'provisioning_failed')::text as failed_count
       from sales_orders
       where created_at >= $1 and created_at < $2`,
      [from, to],
    );
    const row = result.rows[0];
    return {
      orderCount: row?.order_count ?? '0',
      fulfilledCount: row?.fulfilled_count ?? '0',
      amountIrr: row?.amount_irr ?? '0',
      failedCount: row?.failed_count ?? '0',
    };
  }

  public async listReviewQueue(limit: number): Promise<readonly SalesOrder[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
      throw new DomainConflictError('INVALID_REVIEW_QUEUE_LIMIT');
    }
    const result = await this.pool.query<OrderRow>(
      `${orderQuery(`orders.status in ('receipt_submitted', 'provisioning_failed')`)}
       order by orders.created_at asc, orders.id asc
       limit $1`,
      [limit],
    );
    return result.rows.map((row) => mapOrder(row));
  }

  public submitTelegramProof(
    customerId: string,
    telegramFileId: string,
    telegramFileUniqueId: string,
  ): Promise<{ readonly order: SalesOrder; readonly proof: TelegramPaymentProof }> {
    return this.withTransaction(async (client) => {
      const orderResult = await client.query<{ id: string }>(
        `select id::text
         from sales_orders
         where customer_id = $1
           and status in ('awaiting_receipt', 'receipt_submitted', 'rejected')
         order by id desc
         limit 1
         for update`,
        [customerId],
      );
      const orderId = orderResult.rows[0]?.id;
      if (orderId === undefined) {
        throw new DomainConflictError('NO_ORDER_AWAITING_PAYMENT');
      }

      const inserted = await client.query<ProofRow>(
        `insert into telegram_payment_proofs(
           order_id, telegram_file_id, telegram_file_unique_id
         ) values ($1, $2, $3)
         on conflict (order_id, telegram_file_unique_id) do nothing
         returning ${proofColumns}`,
        [orderId, telegramFileId, telegramFileUniqueId],
      );
      const existing =
        inserted.rows[0] ??
        requiredRow(
          (
            await client.query<ProofRow>(
              `select ${proofColumns}
               from telegram_payment_proofs
               where order_id = $1 and telegram_file_unique_id = $2`,
              [orderId, telegramFileUniqueId],
            )
          ).rows,
        );
      await client.query(
        `update sales_orders
         set status = 'receipt_submitted', failure_code = null, updated_at = now()
         where id = $1 and status in ('awaiting_receipt', 'rejected')`,
        [orderId],
      );
      return {
        order: await this.requiredOrderWithClient(client, orderId),
        proof: mapProof(existing),
      };
    });
  }

  public reserveProvisioning(orderId: string, adminTelegramUserId: string): Promise<SalesOrder> {
    return this.withTransaction(async (client) => {
      const current = await this.requiredOrderWithClient(client, orderId, true);
      if (current.status === 'fulfilled') {
        return current;
      }
      if (
        current.status !== 'receipt_submitted' &&
        current.status !== 'provisioning' &&
        current.status !== 'provisioning_failed'
      ) {
        throw new DomainConflictError('ORDER_NOT_READY_FOR_PROVISIONING');
      }
      await client.query(
        `update sales_orders
         set status = 'provisioning', approved_by_telegram_user_id = $2,
             approved_at = coalesce(approved_at, now()), failure_code = null, updated_at = now()
         where id = $1`,
        [orderId, adminTelegramUserId],
      );
      return this.requiredOrderWithClient(client, orderId);
    });
  }

  public completeOrder(orderId: string, serviceId: string): Promise<SalesOrder> {
    return this.withTransaction(async (client) => {
      const result = await client.query(
        `update sales_orders
         set status = 'fulfilled', service_id = $2, failure_code = null, updated_at = now()
         where id = $1 and status in ('provisioning', 'provisioning_failed')`,
        [orderId, serviceId],
      );
      if (result.rowCount === 0) {
        const current = await this.requiredOrderWithClient(client, orderId);
        if (current.status !== 'fulfilled' || current.serviceId !== serviceId) {
          throw new DomainConflictError('INVALID_ORDER_COMPLETION');
        }
        return current;
      }
      return this.requiredOrderWithClient(client, orderId);
    });
  }

  public async markProvisioningFailed(orderId: string, errorCode: string): Promise<SalesOrder> {
    await this.pool.query(
      `update sales_orders
       set status = 'provisioning_failed', failure_code = $2, updated_at = now()
       where id = $1 and status = 'provisioning'`,
      [orderId, errorCode.slice(0, 120)],
    );
    return this.requiredOrder(orderId);
  }

  public async rejectOrder(
    orderId: string,
    adminTelegramUserId: string,
    reasonCode: string,
  ): Promise<SalesOrder> {
    const result = await this.pool.query(
      `update sales_orders
       set status = 'rejected', approved_by_telegram_user_id = $2,
           failure_code = $3, updated_at = now()
       where id = $1 and status in ('receipt_submitted', 'rejected')`,
      [orderId, adminTelegramUserId, reasonCode],
    );
    if (result.rowCount === 0) {
      throw new DomainConflictError('ORDER_NOT_REJECTABLE');
    }
    return this.requiredOrder(orderId);
  }

  public async reserveTelegramUpdate(updateId: string): Promise<boolean> {
    const result = await this.pool.query(
      `insert into telegram_updates(update_id, status)
       values ($1, 'processing')
       on conflict (update_id) do update set
         status = 'processing', error_code = null, started_at = now(), completed_at = null
       where telegram_updates.status = 'failed'
          or (telegram_updates.status = 'processing'
              and telegram_updates.started_at < now() - interval '5 minutes')
       returning update_id`,
      [updateId],
    );
    return result.rowCount === 1;
  }

  public async completeTelegramUpdate(updateId: string): Promise<void> {
    await this.pool.query(
      `update telegram_updates
       set status = 'completed', error_code = null, completed_at = now()
       where update_id = $1 and status = 'processing'`,
      [updateId],
    );
  }

  public async failTelegramUpdate(updateId: string, errorCode: string): Promise<void> {
    await this.pool.query(
      `update telegram_updates
       set status = 'failed', error_code = $2, completed_at = now()
       where update_id = $1 and status = 'processing'`,
      [updateId, errorCode.slice(0, 120)],
    );
  }

  public async upsertCategory(input: {
    readonly code: string;
    readonly name: string;
    readonly description?: string;
    readonly parentId?: string;
    readonly position?: number;
  }): Promise<string> {
    const result = await this.pool.query<{ id: string }>(
      `insert into product_categories(code, name, description, parent_id, position)
       values ($1, $2, $3, $4, $5)
       on conflict (code) do update set
         name = excluded.name,
         description = excluded.description,
         parent_id = excluded.parent_id,
         position = excluded.position,
         active = true,
         updated_at = now()
       returning id::text`,
      [
        input.code,
        input.name,
        input.description ?? '',
        input.parentId ?? null,
        input.position ?? 0,
      ],
    );
    return requiredRow(result.rows).id;
  }

  public async assignProductToCategory(
    categoryId: string,
    productCode: string,
    position = 0,
  ): Promise<void> {
    const result = await this.pool.query(
      `insert into product_category_assignments(category_id, product_id, position)
       select $1, id, $3 from products where code = $2
       on conflict (category_id, product_id) do update set position = excluded.position`,
      [categoryId, productCode, position],
    );
    if (result.rowCount === 0) {
      throw new DomainConflictError('PRODUCT_NOT_FOUND');
    }
  }

  public async configureVariantForSale(input: {
    readonly variantCode: string;
    readonly priceIrr: bigint;
    readonly description?: string;
  }): Promise<string> {
    const result = await this.pool.query<{ id: string }>(
      `update product_variants
       set price_irr = $2, description = $3, sellable = true, updated_at = now()
       where code = $1 and active = true
       returning id::text`,
      [input.variantCode, input.priceIrr.toString(), input.description ?? ''],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new DomainConflictError('PRODUCT_VARIANT_NOT_FOUND');
    }
    return row.id;
  }

  private async findOrderByIdempotencyKey(
    client: PoolClient,
    idempotencyKey: string,
  ): Promise<SalesOrder | null> {
    const result = await client.query<OrderRow>(orderQuery('orders.idempotency_key = $1'), [
      idempotencyKey,
    ]);
    const row = result.rows[0];
    return row === undefined ? null : mapOrder(row);
  }

  private async requiredOrder(id: string): Promise<SalesOrder> {
    const order = await this.getOrder(id);
    if (order === null) {
      throw new DomainConflictError('ORDER_NOT_FOUND');
    }
    return order;
  }

  private async requiredOrderWithClient(
    client: PoolClient,
    id: string,
    lock = false,
  ): Promise<SalesOrder> {
    const result = await client.query<OrderRow>(
      `${orderQuery('orders.id = $1')}${lock ? ' for update of orders' : ''}`,
      [id],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new DomainConflictError('ORDER_NOT_FOUND');
    }
    return mapOrder(row);
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

const proofColumns = `
  id::text,
  order_id::text,
  telegram_file_id,
  telegram_file_unique_id,
  submitted_at
`;

function orderQuery(predicate: string): string {
  return `select
    orders.id::text,
    orders.customer_id::text,
    orders.product_variant_id::text,
    product.name as product_name,
    variant.name as variant_name,
    orders.amount_irr::text,
    orders.status,
    orders.service_id::text,
    orders.failure_code,
    orders.created_at,
    orders.updated_at
  from sales_orders orders
  join product_variants variant on variant.id = orders.product_variant_id
  join products product on product.id = variant.product_id
  where ${predicate}`;
}

function requiredRow<T>(rows: readonly T[]): T {
  const row = rows[0];
  if (row === undefined) {
    throw new DomainConflictError('DATABASE_ROW_NOT_FOUND');
  }
  return row;
}

function mapCategory(row: CategoryRow): CatalogCategory {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    parentId: row.parent_id,
    position: row.position,
  };
}

function mapSellableVariant(row: VariantRow): SellableProductVariant {
  return {
    id: row.id,
    code: row.code,
    productName: row.product_name,
    name: row.name,
    description: row.description,
    durationDays: row.duration_days,
    dataLimitBytes: BigInt(row.data_limit_bytes),
    deviceLimit: row.device_limit,
    priceIrr: BigInt(row.price_irr),
  };
}

function mapCustomer(row: CustomerRow): TelegramCustomer {
  return {
    id: row.id,
    telegramUserId: row.telegram_user_id,
    privateChatId: row.private_chat_id,
    username: row.telegram_username,
    displayName: row.display_name,
  };
}

function mapOrder(row: OrderRow): SalesOrder {
  return {
    id: row.id,
    customerId: row.customer_id,
    productVariantId: row.product_variant_id,
    productName: row.product_name,
    variantName: row.variant_name,
    amountIrr: BigInt(row.amount_irr),
    status: row.status,
    serviceId: row.service_id,
    failureCode: row.failure_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapProof(row: ProofRow): TelegramPaymentProof {
  return {
    id: row.id,
    orderId: row.order_id,
    telegramFileId: row.telegram_file_id,
    telegramFileUniqueId: row.telegram_file_unique_id,
    submittedAt: row.submitted_at,
  };
}
