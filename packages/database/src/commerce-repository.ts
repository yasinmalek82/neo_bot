import {
  DomainConflictError,
  isRepresentativePricingSource,
  resolveRepresentativePrice,
  validateServiceUsernameBase,
  type CatalogCategory,
  type RepresentativePricingSource,
  type RepresentativeProfile,
  type SalesOrder,
  type SellableProductVariant,
  type TelegramCustomer,
  type TelegramCustomerInput,
  type TelegramPaymentProof,
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
  product_id?: string;
  product_name: string;
  name: string;
  description: string;
  duration_days: number;
  data_limit_bytes: string;
  device_limit: number;
  price_irr: string;
  base_price_irr?: string | null;
  override_price_irr?: string | null;
  display_attributes?: unknown;
  fulfilled_sales_last_30_days?: number;
}

interface RepresentativeRow {
  id: string;
  code: string;
  telegram_user_id: string;
  display_name: string;
  active: boolean;
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
  representative_id: string | null;
  representative_code: string | null;
  pricing_source: string;
  service_username_base: string | null;
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

  public async getCategory(id: string): Promise<CatalogCategory | null> {
    const result = await this.pool.query<CategoryRow>(
      `select id::text, code, name, description, parent_id::text, position
       from product_categories
       where id = $1::bigint and active = true`,
      [id],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapCategory(row);
  }

  public async listSellableVariants(
    categoryId: string,
  ): Promise<readonly SellableProductVariant[]> {
    const result = await this.pool.query<VariantRow>(
      `select v.id::text, v.code, product.id::text as product_id, product.name as product_name, v.name, v.description,
              v.duration_days, v.data_limit_bytes::text, v.device_limit, v.price_irr::text,
              ${fulfilledSalesColumns},
              ${variantDisplayAttributeColumns}
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
      `select v.id::text, v.code, product.id::text as product_id, product.name as product_name, v.name, v.description,
              v.duration_days, v.data_limit_bytes::text, v.device_limit, v.price_irr::text,
              ${fulfilledSalesColumns},
              ${variantDisplayAttributeColumns}
       from product_variants v
       join products product on product.id = v.product_id
       where v.id = $1 and product.active = true
         and v.active = true and v.sellable = true and v.price_irr > 0`,
      [id],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapSellableVariant(row);
  }

  public async findRepresentativeByTelegramUserId(
    telegramUserId: string,
  ): Promise<{ id: string; code: string } | null> {
    const result = await this.pool.query<{ id: string; code: string }>(
      `select id::text, code
       from representatives
       where telegram_user_id = $1 and active = true`,
      [telegramUserId],
    );
    return result.rows[0] ?? null;
  }

  public async listSellableVariantsForRepresentative(
    categoryId: string,
    representativeId: string,
  ): Promise<readonly SellableProductVariant[]> {
    const result = await this.pool.query<VariantRow>(
      `select ${pricedVariantColumns}
       from product_category_assignments assignment
       join products product on product.id = assignment.product_id
       join product_variants v on v.product_id = product.id
       join representative_variant_access access
         on access.product_variant_id = v.id
        and access.representative_id = $2
        and access.active = true
       ${representativePriceJoins}
       where assignment.category_id = $1 and product.active = true
         and v.active = true and v.sellable = true and v.price_irr > 0
       order by assignment.position, v.duration_days, v.id`,
      [categoryId, representativeId],
    );
    return result.rows.map(mapSellableVariant);
  }

  public async getSellableVariantForRepresentative(
    variantId: string,
    representativeId: string,
  ): Promise<SellableProductVariant | null> {
    const result = await this.pool.query<VariantRow>(
      `select ${pricedVariantColumns}
       from product_variants v
       join products product on product.id = v.product_id
       join representative_variant_access access
         on access.product_variant_id = v.id
        and access.representative_id = $2
        and access.active = true
       ${representativePriceJoins}
       where v.id = $1 and product.active = true
         and v.active = true and v.sellable = true and v.price_irr > 0`,
      [variantId, representativeId],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapSellableVariant(row);
  }

  public async upsertRepresentative(input: {
    readonly code: string;
    readonly telegramUserId: string;
    readonly displayName: string;
    readonly active: boolean;
  }): Promise<string> {
    const result = await this.pool.query<{ id: string }>(
      `insert into representatives(code, telegram_user_id, display_name, active)
       values ($1, $2, $3, $4)
       on conflict (telegram_user_id) do update set
         code = excluded.code,
         display_name = excluded.display_name,
         active = excluded.active,
         updated_at = now()
       returning id::text`,
      [input.code, input.telegramUserId, input.displayName, input.active],
    );
    return requiredRow(result.rows).id;
  }

  public async listRepresentatives(): Promise<readonly RepresentativeProfile[]> {
    const result = await this.pool.query<RepresentativeRow>(
      `select id::text, code, telegram_user_id::text, display_name, active
       from representatives
       order by code, id`,
    );
    return result.rows.map(mapRepresentative);
  }

  public async assignRepresentativeToCustomerByTelegramId(
    customerTelegramUserId: string,
    representativeId: string,
  ): Promise<void> {
    const representative = await this.pool.query<{ id: string }>(
      'select id::text from representatives where id = $1',
      [representativeId],
    );
    if (representative.rows[0] === undefined) {
      throw new DomainConflictError('REPRESENTATIVE_NOT_FOUND');
    }
    const updated = await this.pool.query<{ id: string }>(
      `update customers
       set representative_id = $2, updated_at = now()
       where telegram_user_id = $1
       returning id::text`,
      [customerTelegramUserId, representativeId],
    );
    if (updated.rows[0] === undefined) {
      throw new DomainConflictError('CUSTOMER_NOT_FOUND');
    }
  }

  public async setRepresentativeVariantAccess(input: {
    readonly representativeId: string;
    readonly variantId: string;
    readonly active: boolean;
  }): Promise<void> {
    await this.pool.query(
      `insert into representative_variant_access(
         representative_id, product_variant_id, active
       ) values ($1, $2, $3)
       on conflict (representative_id, product_variant_id) do update set
         active = excluded.active,
         updated_at = now()`,
      [input.representativeId, input.variantId, input.active],
    );
  }

  public async setRepresentativeBasePrice(input: {
    readonly variantId: string;
    readonly priceIrr: bigint;
  }): Promise<void> {
    await this.pool.query(
      `insert into representative_variant_base_prices(product_variant_id, price_irr)
       values ($1, $2)
       on conflict (product_variant_id) do update set
         price_irr = excluded.price_irr,
         updated_at = now()`,
      [input.variantId, input.priceIrr.toString()],
    );
  }

  public async setRepresentativeOverridePrice(input: {
    readonly representativeId: string;
    readonly variantId: string;
    readonly priceIrr: bigint;
  }): Promise<void> {
    await this.pool.query(
      `insert into representative_variant_price_overrides(
         representative_id, product_variant_id, price_irr
       ) values ($1, $2, $3)
       on conflict (representative_id, product_variant_id) do update set
         price_irr = excluded.price_irr,
         updated_at = now()`,
      [input.representativeId, input.variantId, input.priceIrr.toString()],
    );
  }

  public async clearRepresentativeOverridePrice(input: {
    readonly representativeId: string;
    readonly variantId: string;
  }): Promise<void> {
    await this.pool.query(
      `delete from representative_variant_price_overrides
       where representative_id = $1 and product_variant_id = $2`,
      [input.representativeId, input.variantId],
    );
  }

  public async listRepresentativePriceAudit(): Promise<
    readonly {
      representativeCode: string;
      variantCode: string;
      priceIrr: bigint;
      pricingSource: RepresentativePricingSource;
    }[]
  > {
    const result = await this.pool.query<{
      representative_code: string;
      variant_code: string;
      price_irr: string;
      base_price_irr: string | null;
      override_price_irr: string | null;
    }>(
      `select representative.code as representative_code,
              v.code as variant_code,
              v.price_irr::text as price_irr,
              base.price_irr::text as base_price_irr,
              override.price_irr::text as override_price_irr
       from representatives representative
       join representative_variant_access access
         on access.representative_id = representative.id
        and access.active = true
       join product_variants v on v.id = access.product_variant_id
       join products product on product.id = v.product_id
       left join representative_variant_base_prices base
         on base.product_variant_id = v.id
       left join representative_variant_price_overrides override
         on override.product_variant_id = v.id
        and override.representative_id = representative.id
       where representative.active = true
         and product.active = true
         and v.active = true
         and v.sellable = true
         and v.price_irr > 0
       order by representative.code, v.code`,
    );
    return result.rows.map((row) => {
      const resolved = resolveRepresentativePrice({
        publicPriceIrr: BigInt(row.price_irr),
        representativeBasePriceIrr: row.base_price_irr === null ? null : BigInt(row.base_price_irr),
        representativeOverridePriceIrr:
          row.override_price_irr === null ? null : BigInt(row.override_price_irr),
      });
      return {
        representativeCode: row.representative_code,
        variantCode: row.variant_code,
        priceIrr: resolved.priceIrr,
        pricingSource: resolved.pricingSource,
      };
    });
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
    representativeId?: string,
    serviceUsernameBase?: string,
  ): Promise<SalesOrder> {
    return this.withTransaction(async (client) => {
      const customer = await client.query<{ id: string }>(
        'select id::text from customers where id = $1 for update',
        [customerId],
      );
      requiredRow(customer.rows);

      if (serviceUsernameBase !== undefined) {
        validateServiceUsernameBase(serviceUsernameBase);
      }

      const existing = await this.findOrderByIdempotencyKey(client, idempotencyKey);
      if (existing !== null) {
        if (
          existing.customerId !== customerId ||
          existing.productVariantId !== productVariantId ||
          (existing.serviceUsernameBase ?? null) !== (serviceUsernameBase ?? null)
        ) {
          throw new DomainConflictError('IDEMPOTENCY_KEY_REUSED');
        }
        return existing;
      }

      const selected = await resolveCheckoutPrice(client, productVariantId, representativeId);

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
           customer_id, product_variant_id, idempotency_key, amount_irr,
           representative_id, pricing_source, service_username_base
         ) values ($1, $2, $3, $4, $5, $6, $7)
         returning id::text`,
        [
          customerId,
          productVariantId,
          idempotencyKey,
          selected.priceIrr.toString(),
          representativeId ?? null,
          selected.pricingSource,
          serviceUsernameBase ?? null,
        ],
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
      `${orderQuery(`orders.status = 'receipt_submitted'`)}
       order by orders.created_at asc, orders.id asc
       limit $1`,
      [limit],
    );
    return result.rows.map((row) => mapOrder(row));
  }

  public async listFailedProvisioning(limit: number): Promise<readonly SalesOrder[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
      throw new DomainConflictError('INVALID_REVIEW_QUEUE_LIMIT');
    }
    const result = await this.pool.query<OrderRow>(
      `${orderQuery(`orders.status = 'provisioning_failed'`)}
       order by orders.updated_at desc, orders.id asc
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
    orders.representative_id::text,
    representative.code as representative_code,
    orders.pricing_source,
    orders.service_username_base,
    orders.failure_code,
    orders.created_at,
    orders.updated_at
  from sales_orders orders
  join product_variants variant on variant.id = orders.product_variant_id
  join products product on product.id = variant.product_id
  left join representatives representative on representative.id = orders.representative_id
  where ${predicate}`;
}

const variantDisplayAttributeColumns = `
  coalesce((
    select jsonb_agg(jsonb_build_object('position', attribute.position, 'label', attribute.label, 'value', attribute.value) order by attribute.position)
    from product_variant_display_attributes attribute
    where attribute.product_variant_id = v.id
  ), '[]'::jsonb) as display_attributes
`;

const fulfilledSalesColumns = `
  (
    select count(*)::int
    from sales_orders fulfilled_order
    where fulfilled_order.product_variant_id = v.id
      and fulfilled_order.status = 'fulfilled'
      and fulfilled_order.created_at >= now() - interval '30 days'
  ) as fulfilled_sales_last_30_days
`;

const pricedVariantColumns = `
  v.id::text, v.code, product.id::text as product_id, product.name as product_name, v.name, v.description,
  v.duration_days, v.data_limit_bytes::text, v.device_limit,
  v.price_irr::text as price_irr,
  base.price_irr::text as base_price_irr,
  override.price_irr::text as override_price_irr,
  ${fulfilledSalesColumns},
  ${variantDisplayAttributeColumns}
`;

const representativePriceJoins = `
  left join representative_variant_base_prices base
    on base.product_variant_id = v.id
  left join representative_variant_price_overrides override
    on override.product_variant_id = v.id
   and override.representative_id = $2
`;

async function resolveCheckoutPrice(
  client: PoolClient,
  productVariantId: string,
  representativeId: string | undefined,
): Promise<{ priceIrr: bigint; pricingSource: RepresentativePricingSource }> {
  if (representativeId === undefined) {
    const variant = await client.query<{ price_irr: string }>(
      `select v.price_irr::text as price_irr
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
    return resolveRepresentativePrice({
      publicPriceIrr: BigInt(selected.price_irr),
      representativeBasePriceIrr: null,
      representativeOverridePriceIrr: null,
    });
  }

  const variant = await client.query<{
    price_irr: string;
    base_price_irr: string | null;
    override_price_irr: string | null;
  }>(
    `select v.price_irr::text as price_irr,
            base.price_irr::text as base_price_irr,
            override.price_irr::text as override_price_irr
     from product_variants v
     join products product on product.id = v.product_id
     join representatives representative
       on representative.id = $2 and representative.active = true
     join representative_variant_access access
       on access.product_variant_id = v.id
      and access.representative_id = representative.id
      and access.active = true
     left join representative_variant_base_prices base
       on base.product_variant_id = v.id
     left join representative_variant_price_overrides override
       on override.product_variant_id = v.id
      and override.representative_id = representative.id
     where v.id = $1 and v.active = true and v.sellable = true
       and v.price_irr > 0 and product.active = true`,
    [productVariantId, representativeId],
  );
  const selected = variant.rows[0];
  if (selected === undefined) {
    throw new DomainConflictError('PRODUCT_VARIANT_NOT_SELLABLE');
  }
  return resolveRepresentativePrice({
    publicPriceIrr: BigInt(selected.price_irr),
    representativeBasePriceIrr:
      selected.base_price_irr === null ? null : BigInt(selected.base_price_irr),
    representativeOverridePriceIrr:
      selected.override_price_irr === null ? null : BigInt(selected.override_price_irr),
  });
}

function requiredRow<T>(rows: readonly T[]): T {
  const row = rows[0];
  if (row === undefined) {
    throw new DomainConflictError('DATABASE_ROW_NOT_FOUND');
  }
  return row;
}

function mapRepresentative(row: RepresentativeRow): RepresentativeProfile {
  return {
    id: row.id,
    code: row.code,
    telegramUserId: row.telegram_user_id,
    displayName: row.display_name,
    active: row.active,
  };
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
  const resolved = resolveRepresentativePrice({
    publicPriceIrr: BigInt(row.price_irr),
    representativeBasePriceIrr:
      row.base_price_irr === undefined || row.base_price_irr === null
        ? null
        : BigInt(row.base_price_irr),
    representativeOverridePriceIrr:
      row.override_price_irr === undefined || row.override_price_irr === null
        ? null
        : BigInt(row.override_price_irr),
  });
  return {
    id: row.id,
    code: row.code,
    ...(row.product_id === undefined ? {} : { productId: row.product_id }),
    productName: row.product_name,
    name: row.name,
    description: row.description,
    durationDays: row.duration_days,
    dataLimitBytes: BigInt(row.data_limit_bytes),
    deviceLimit: row.device_limit,
    priceIrr: resolved.priceIrr,
    displayAttributes: mapDisplayAttributes(row.display_attributes),
    fulfilledSalesLast30Days: row.fulfilled_sales_last_30_days ?? 0,
    pricingSource: resolved.pricingSource,
  };
}

function mapDisplayAttributes(
  value: unknown,
): readonly { position: number; label: string; value: string }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = item as Record<string, unknown>;
    if (
      typeof item !== 'object' ||
      item === null ||
      !('position' in record) ||
      !('label' in record) ||
      !('value' in record) ||
      !Number.isInteger(record['position']) ||
      typeof record['label'] !== 'string' ||
      typeof record['value'] !== 'string'
    ) {
      return [];
    }
    return [
      { position: record['position'] as number, label: record['label'], value: record['value'] },
    ];
  });
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
    representativeId: row.representative_id,
    representativeCode: row.representative_code,
    pricingSource: mapPricingSource(row.pricing_source),
    serviceUsernameBase: row.service_username_base,
    failureCode: row.failure_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPricingSource(value: string): RepresentativePricingSource {
  if (!isRepresentativePricingSource(value)) {
    throw new DomainConflictError('INVALID_PRICING_SOURCE');
  }
  return value;
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
