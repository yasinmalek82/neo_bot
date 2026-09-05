import {
  DomainConflictError,
  applyInviteeCheckoutDiscount,
  defaultStorefrontOpsSettings,
  isPaidFulfillmentEligible,
  isRepresentativePricingSource,
  mergeStorefrontOpsSettings,
  parseDurableConversationSession,
  referralRewardIdempotencyKey,
  resolveRepresentativePrice,
  validateServiceUsernameBase,
  type AdminSalesSnapshot,
  type AdminSalesWindowSnapshot,
  type BroadcastJob,
  type CatalogCategory,
  type ClaimedDeliveryJob,
  type ConversationSessionStatus,
  type CustomerDeliveryJob,
  type CustomerServiceSummary,
  type DurableConversationSession,
  type ForcedJoinChannel,
  type PaymentProofMediaKind,
  type ReferralAttribution,
  type ReferralReward,
  type RepresentativeProfile,
  type RepresentativePricingSource,
  type SalesOrder,
  type SalesOrderStatus,
  type SellableProductVariant,
  type ServiceReminderDelivery,
  type StorefrontOpsSettings,
  type StorefrontOpsSettingsPatch,
  type SupportTicket,
  type SupportTicketWriteResult,
  type TelegramCustomer,
  type TelegramCustomerInput,
  type TelegramPaymentProof,
  type TrialClaim,
  type UsageSyncTarget,
  type UsageSyncWrite,
  type WalletLedgerEntry,
} from '@neo-bot/domain';
import type { CommerceRepository, CommercialRepository } from '@neo-bot/application';
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
  shop_blocked?: boolean;
}

interface OrderRow {
  id: string;
  customer_id: string;
  product_variant_id: string;
  product_name: string;
  variant_name: string;
  amount_irr: string;
  order_kind: SalesOrder['kind'];
  status: SalesOrder['status'];
  service_id: string | null;
  target_service_id: string | null;
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
  media_kind: PaymentProofMediaKind | null;
  submitted_at: Date;
}

interface DeliveryJobRow {
  id: string;
  order_id: string;
  customer_id: string;
  service_id: string;
  stage: CustomerDeliveryJob['stage'];
  attempt_count: number;
  claim_version: string;
  next_attempt_at: Date;
  last_error_code: string | null;
  telegram_message_id: string | null;
  created_at: Date;
  updated_at: Date;
}

interface DeliveryJobClaimRow {
  id: string;
  order_id: string;
  customer_id: string;
  service_id: string;
  stage: string;
  attempt_count: number;
  claim_version: string;
  telegram_message_id: string | null;
}

interface ConversationSessionRow {
  id: string;
  telegram_user_id: string;
  flow_id: string;
  step: string;
  schema_version: number;
  payload: unknown;
  status: string;
  created_at: Date;
  updated_at: Date;
  expires_at: Date;
}

interface WalletLedgerRow {
  id: string;
  customer_id: string;
  amount_irr: string;
  kind: WalletLedgerEntry['kind'];
  idempotency_key: string;
  discount_code: string | null;
  created_at: Date;
}

interface SupportTicketRow {
  id: string;
  customer_id: string;
  status: SupportTicket['status'];
  created_at: Date;
  updated_at: Date;
}

export class PostgresCommerceRepository implements CommerceRepository, CommercialRepository {
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
                 telegram_username, display_name, shop_blocked, (xmax = 0) as inserted`,
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
          existing.kind !== 'purchase' ||
          existing.productVariantId !== productVariantId ||
          (existing.serviceUsernameBase ?? null) !== (serviceUsernameBase ?? null)
        ) {
          throw new DomainConflictError('IDEMPOTENCY_KEY_REUSED');
        }
        return existing;
      }

      return this.createPendingCheckoutOrder(client, {
        customerId,
        productVariantId,
        idempotencyKey,
        representativeId,
        serviceUsernameBase,
        kind: 'purchase',
        targetServiceId: null,
      });
    });
  }

  public createRenewalOrder(
    customerId: string,
    idempotencyKey: string,
    representativeId?: string,
  ): Promise<SalesOrder> {
    return this.withTransaction(async (client) => {
      const customer = await client.query<{ id: string }>(
        'select id::text from customers where id = $1 for update',
        [customerId],
      );
      requiredRow(customer.rows);

      const existing = await this.findOrderByIdempotencyKey(client, idempotencyKey);
      if (existing !== null) {
        if (existing.customerId !== customerId || existing.kind !== 'renewal') {
          throw new DomainConflictError('IDEMPOTENCY_KEY_REUSED');
        }
        return existing;
      }

      const target = await client.query<{ service_id: string; product_variant_id: string }>(
        `select service.id::text as service_id, service.product_variant_id::text as product_variant_id
         from sales_orders fulfilled_order
         join services service on service.id = fulfilled_order.service_id
         where fulfilled_order.customer_id = $1
           and fulfilled_order.status = 'fulfilled'
         order by fulfilled_order.updated_at desc, fulfilled_order.id desc
         limit 1
         for key share of service`,
        [customerId],
      );
      const service = target.rows[0];
      if (service === undefined) {
        throw new DomainConflictError('NO_ACTIVE_SERVICE');
      }
      return this.createPendingCheckoutOrder(client, {
        customerId,
        productVariantId: service.product_variant_id,
        idempotencyKey,
        representativeId,
        kind: 'renewal',
        serviceUsernameBase: undefined,
        targetServiceId: service.service_id,
      });
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
              customer.display_name, customer.shop_blocked
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
    mediaKind?: PaymentProofMediaKind | null,
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
           order_id, telegram_file_id, telegram_file_unique_id, media_kind
         ) values ($1, $2, $3, $4)
         on conflict (order_id, telegram_file_unique_id) do nothing
         returning ${proofColumns}`,
        [orderId, telegramFileId, telegramFileUniqueId, mediaKind ?? null],
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

  public async getPaymentProof(orderId: string): Promise<TelegramPaymentProof | null> {
    const result = await this.pool.query<ProofRow>(
      `select ${proofColumns}
       from telegram_payment_proofs
       where order_id = $1
       order by submitted_at desc, id desc
       limit 1`,
      [orderId],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapProof(row);
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
         where id = $1
           and status in ('provisioning', 'provisioning_failed')
           and (order_kind <> 'renewal' or target_service_id = $2)`,
        [orderId, serviceId],
      );
      if (result.rowCount === 0) {
        const current = await this.requiredOrderWithClient(client, orderId);
        if (current.status !== 'fulfilled' || current.serviceId !== serviceId) {
          throw new DomainConflictError('INVALID_ORDER_COMPLETION');
        }
        return current;
      }
      // Exactly one durable delivery job per fulfilled order, enqueued in the same
      // transaction that completes the order.
      await client.query(
        `insert into customer_delivery_jobs(order_id, customer_id, service_id)
         select id, customer_id, $2 from sales_orders where id = $1
         on conflict (order_id) do nothing`,
        [orderId, serviceId],
      );
      return this.requiredOrderWithClient(client, orderId);
    });
  }

  public async claimDueDeliveryJobs(
    limit: number,
    now: Date,
  ): Promise<readonly ClaimedDeliveryJob[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new DomainConflictError('INVALID_DELIVERY_CLAIM_LIMIT');
    }
    const result = await this.pool.query<DeliveryJobClaimRow>(
      `with claimed as (
         select job.id
         from customer_delivery_jobs job
         where job.stage in ('pending_brand_media', 'pending_link')
           and job.next_attempt_at <= $2
         order by job.id
         for update skip locked
         limit $1
       ),
       updated as (
         update customer_delivery_jobs job
         set attempt_count = job.attempt_count + 1,
             claim_version = job.claim_version + 1,
             next_attempt_at = $2 + interval '2 minutes',
             updated_at = $2
         from claimed
         where job.id = claimed.id
         returning
           job.id::text as id,
           job.order_id::text as order_id,
           job.customer_id::text as customer_id,
           job.service_id::text as service_id,
           job.stage,
           job.attempt_count,
           job.claim_version::text as claim_version,
           job.telegram_message_id::text as telegram_message_id
       )
       select * from updated order by id`,
      [limit, now],
    );
    return result.rows.map((row) => ({
      id: row.id,
      orderId: row.order_id,
      customerId: row.customer_id,
      serviceId: row.service_id,
      stage: row.stage as CustomerDeliveryJob['stage'],
      attemptCount: row.attempt_count,
      claimVersion: row.claim_version,
      telegramMessageId: row.telegram_message_id,
    }));
  }

  public async markDeliveryJobBrandSent(
    jobId: string,
    claimVersion: string,
    now: Date,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `update customer_delivery_jobs
       set stage = 'pending_link', updated_at = $3
       where id = $1 and claim_version = $2::bigint and stage = 'pending_brand_media'`,
      [jobId, claimVersion, now],
    );
    return result.rowCount === 1;
  }

  public async markDeliveryJobAnchor(
    jobId: string,
    claimVersion: string,
    telegramMessageId: string,
    now: Date,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `update customer_delivery_jobs
       set telegram_message_id = $3, updated_at = $4
       where id = $1 and claim_version = $2::bigint
         and stage = 'pending_link' and telegram_message_id is null`,
      [jobId, claimVersion, BigInt(telegramMessageId), now],
    );
    return result.rowCount === 1;
  }

  public async markDeliveryJobDelivered(
    jobId: string,
    claimVersion: string,
    now: Date,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `update customer_delivery_jobs
       set stage = 'delivered', last_error_code = null, updated_at = $3
       where id = $1 and claim_version = $2::bigint
         and stage in ('pending_brand_media', 'pending_link')`,
      [jobId, claimVersion, now],
    );
    return result.rowCount === 1;
  }

  public async retryDeliveryJob(
    jobId: string,
    claimVersion: string,
    errorCode: string,
    nextAttemptAt: Date,
    now: Date,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `update customer_delivery_jobs
       set last_error_code = $3, next_attempt_at = $4, updated_at = $5
       where id = $1 and claim_version = $2::bigint
         and stage in ('pending_brand_media', 'pending_link')`,
      [jobId, claimVersion, errorCode, nextAttemptAt, now],
    );
    return result.rowCount === 1;
  }

  public async failDeliveryJob(
    jobId: string,
    claimVersion: string,
    errorCode: string,
    now: Date,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `update customer_delivery_jobs
       set stage = 'failed', last_error_code = $3, updated_at = $4
       where id = $1 and claim_version = $2::bigint
         and stage in ('pending_brand_media', 'pending_link')`,
      [jobId, claimVersion, errorCode, now],
    );
    return result.rowCount === 1;
  }

  public async getDeliveryJobForOrder(orderId: string): Promise<CustomerDeliveryJob | null> {
    const result = await this.pool.query<DeliveryJobRow>(
      `select ${deliveryJobColumns}
       from customer_delivery_jobs
       where order_id = $1`,
      [orderId],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapDeliveryJob(row);
  }

  public async resetDeliveryJob(orderId: string, now: Date): Promise<CustomerDeliveryJob> {
    const result = await this.pool.query<DeliveryJobRow>(
      `update customer_delivery_jobs
       set stage = case when telegram_message_id is null then 'pending_brand_media'
                        else 'pending_link' end,
           attempt_count = 0,
           claim_version = claim_version + 1,
           next_attempt_at = $2,
           last_error_code = null,
           updated_at = $2
       where order_id = $1 and stage <> 'delivered'
       returning ${deliveryJobColumns}`,
      [orderId, now],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new DomainConflictError('DELIVERY_JOB_NOT_RETRYABLE');
    }
    return mapDeliveryJob(row);
  }

  public async backfillMissingDeliveryJobs(now: Date): Promise<number> {
    const result = await this.pool.query(
      `insert into customer_delivery_jobs(order_id, customer_id, service_id, created_at, updated_at)
       select orders.id, orders.customer_id, orders.service_id, $1, $1
       from sales_orders orders
       where orders.status = 'fulfilled'
         and orders.service_id is not null
       on conflict (order_id) do nothing`,
      [now],
    );
    return result.rowCount ?? 0;
  }

  public async getOrderDeliveryTarget(
    orderId: string,
  ): Promise<{ readonly chatId: string; readonly subscriptionUrl: string } | null> {
    const result = await this.pool.query<{ chat_id: string; subscription_url: string }>(
      `select customer.private_chat_id::text as chat_id, service.subscription_url
       from sales_orders orders
       join services service on service.id = orders.service_id
       join customers customer on customer.id = orders.customer_id
       where orders.id = $1 and orders.status = 'fulfilled'
         and orders.service_id is not null
       limit 1`,
      [orderId],
    );
    const row = result.rows[0];
    return row === undefined
      ? null
      : { chatId: row.chat_id, subscriptionUrl: row.subscription_url };
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

  public async getPendingConversationSession(
    telegramUserId: string,
  ): Promise<DurableConversationSession | null> {
    const result = await this.pool.query<ConversationSessionRow>(
      conversationSessionQuery('telegram_user_id = $1::bigint and status = $2'),
      [telegramUserId, 'pending'],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapConversationSession(row);
  }

  public putConversationSession(
    session: DurableConversationSession,
  ): Promise<DurableConversationSession> {
    const parsed = parseDurableConversationSession(session);
    return this.withTransaction(async (client) => {
      await client.query(
        `update conversation_sessions
         set status = 'canceled', updated_at = $2, consumed_at = $2
         where telegram_user_id = $1::bigint and status = 'pending' and id <> $3`,
        [parsed.telegramUserId, parsed.updatedAt, parsed.id],
      );
      await client.query(
        `insert into conversation_sessions(
           id, telegram_user_id, flow_id, step, schema_version, payload, status,
           created_at, updated_at, expires_at
         ) values ($1, $2::bigint, $3, $4, $5, $6::jsonb, $7, $8, $9, $10)
         on conflict (id) do update set
           flow_id = excluded.flow_id,
           step = excluded.step,
           schema_version = excluded.schema_version,
           payload = excluded.payload,
           status = excluded.status,
           updated_at = excluded.updated_at,
           expires_at = excluded.expires_at,
           consumed_at = null`,
        [
          parsed.id,
          parsed.telegramUserId,
          parsed.flowId,
          parsed.step,
          parsed.schemaVersion,
          JSON.stringify(parsed.payload),
          parsed.status,
          parsed.createdAt,
          parsed.updatedAt,
          parsed.expiresAt,
        ],
      );
      return parsed;
    });
  }

  public async finishConversationSession(input: {
    readonly id: string;
    readonly telegramUserId: string;
    readonly status: Exclude<ConversationSessionStatus, 'pending'>;
    readonly now: Date;
  }): Promise<void> {
    await this.pool.query(
      `update conversation_sessions
       set status = $3, updated_at = $4, consumed_at = $4
       where id = $1 and telegram_user_id = $2::bigint and status = 'pending'`,
      [input.id, input.telegramUserId, input.status, input.now],
    );
  }

  public async findDiscountCode(code: string): Promise<{ readonly code: string } | null> {
    const result = await this.pool.query<{ code: string }>(
      `select code from discount_codes where code = $1 and active = true`,
      [code],
    );
    return result.rows[0] ?? null;
  }

  public creditWalletTopUp(input: {
    readonly customerId: string;
    readonly amountIrr: bigint;
    readonly idempotencyKey: string;
    readonly discountCode?: string;
  }): Promise<WalletLedgerEntry> {
    return this.withTransaction(async (client) => {
      const existing = await client.query<WalletLedgerRow>(
        `select id::text, customer_id::text, amount_irr::text, kind, idempotency_key,
                discount_code, created_at
         from customer_wallet_ledger
         where idempotency_key = $1`,
        [input.idempotencyKey],
      );
      const replay = existing.rows[0];
      if (replay !== undefined) {
        if (
          replay.customer_id !== input.customerId ||
          BigInt(replay.amount_irr) !== input.amountIrr ||
          (replay.discount_code ?? undefined) !== input.discountCode
        ) {
          throw new DomainConflictError('IDEMPOTENCY_KEY_REUSED');
        }
        return mapWalletLedger(replay, true);
      }
      await client.query('select id from customers where id = $1::bigint for update', [
        input.customerId,
      ]);
      const inserted = await client.query<WalletLedgerRow>(
        `insert into customer_wallet_ledger(
           customer_id, amount_irr, kind, idempotency_key, discount_code
         ) values ($1::bigint, $2, 'topup', $3, $4)
         returning id::text, customer_id::text, amount_irr::text, kind, idempotency_key,
                   discount_code, created_at`,
        [
          input.customerId,
          input.amountIrr.toString(),
          input.idempotencyKey,
          input.discountCode ?? null,
        ],
      );
      await client.query(
        `insert into customer_wallets(customer_id, balance_irr)
         values ($1::bigint, $2)
         on conflict (customer_id) do update
         set balance_irr = customer_wallets.balance_irr + excluded.balance_irr,
             updated_at = now()`,
        [input.customerId, input.amountIrr.toString()],
      );
      const wallet = await client.query<{ balance_irr: string }>(
        'select balance_irr::text from customer_wallets where customer_id = $1::bigint',
        [input.customerId],
      );
      if (BigInt(requiredRow(wallet.rows).balance_irr) < 0n) {
        throw new DomainConflictError('NEGATIVE_WALLET_BALANCE');
      }
      return mapWalletLedger(requiredRow(inserted.rows), false);
    });
  }

  public createSupportTicket(input: {
    readonly customerId: string;
    readonly body: string;
    readonly idempotencyKey: string;
  }): Promise<SupportTicketWriteResult> {
    return this.withTransaction(async (client) => {
      const existing = await client.query<{ ticket_id: string }>(
        `select ticket_id::text from support_ticket_messages where idempotency_key = $1`,
        [input.idempotencyKey],
      );
      if (existing.rows[0] !== undefined) {
        return {
          ticket: await requiredTicket(client, existing.rows[0].ticket_id, input.customerId),
          replayed: true,
        };
      }
      const ticket = await client.query<SupportTicketRow>(
        `insert into support_tickets(customer_id) values ($1::bigint)
         returning id::text, customer_id::text, status, created_at, updated_at`,
        [input.customerId],
      );
      const created = mapSupportTicket(requiredRow(ticket.rows));
      await client.query(
        `insert into support_ticket_messages(ticket_id, customer_id, body, idempotency_key)
         values ($1::bigint, $2::bigint, $3, $4)`,
        [created.id, input.customerId, input.body, input.idempotencyKey],
      );
      return { ticket: created, replayed: false };
    });
  }

  public followUpSupportTicket(input: {
    readonly customerId: string;
    readonly ticketId: string;
    readonly body: string;
    readonly idempotencyKey: string;
  }): Promise<SupportTicketWriteResult> {
    return this.withTransaction(async (client) => {
      const existing = await client.query<{ ticket_id: string }>(
        `select ticket_id::text from support_ticket_messages where idempotency_key = $1`,
        [input.idempotencyKey],
      );
      if (existing.rows[0] !== undefined) {
        if (existing.rows[0].ticket_id !== input.ticketId) {
          throw new DomainConflictError('IDEMPOTENCY_KEY_REUSED');
        }
        return {
          ticket: await requiredTicket(client, input.ticketId, input.customerId),
          replayed: true,
        };
      }
      const ticket = await requiredTicket(client, input.ticketId, input.customerId);
      await client.query(
        `insert into support_ticket_messages(ticket_id, customer_id, body, idempotency_key)
         values ($1::bigint, $2::bigint, $3, $4)`,
        [input.ticketId, input.customerId, input.body, input.idempotencyKey],
      );
      await client.query(`update support_tickets set updated_at = now() where id = $1::bigint`, [
        input.ticketId,
      ]);
      return { ticket, replayed: false };
    });
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

  public async getCommercialSettings(): Promise<StorefrontOpsSettings> {
    const result = await this.pool.query<OpsSettingsRow>(
      `select trial_enabled, trial_variant_id::text, forced_join_channels,
              reminders_enabled, expiry_reminder_days, low_traffic_percent,
              referral_enabled, referral_referrer_credit_irr::text,
              referral_invitee_discount_irr::text, referral_max_rewards_per_referrer,
              updated_at
       from storefront_ops_settings where id = 1`,
    );
    const row = result.rows[0];
    return row === undefined ? defaultStorefrontOpsSettings() : mapOpsSettings(row);
  }

  public updateCommercialSettings(
    patch: StorefrontOpsSettingsPatch,
  ): Promise<StorefrontOpsSettings> {
    return this.withTransaction(async (client) => {
      const current = await client.query<OpsSettingsRow>(
        `select trial_enabled, trial_variant_id::text, forced_join_channels,
                reminders_enabled, expiry_reminder_days, low_traffic_percent,
                referral_enabled, referral_referrer_credit_irr::text,
                referral_invitee_discount_irr::text, referral_max_rewards_per_referrer,
                updated_at
         from storefront_ops_settings where id = 1 for update`,
      );
      const merged = mergeStorefrontOpsSettings(
        current.rows[0] === undefined
          ? defaultStorefrontOpsSettings()
          : mapOpsSettings(current.rows[0]),
        patch,
      );
      const updated = await client.query<OpsSettingsRow>(
        `update storefront_ops_settings set
           trial_enabled = $1,
           trial_variant_id = $2,
           forced_join_channels = $3::jsonb,
           reminders_enabled = $4,
           expiry_reminder_days = $5,
           low_traffic_percent = $6,
           referral_enabled = $7,
           referral_referrer_credit_irr = $8,
           referral_invitee_discount_irr = $9,
           referral_max_rewards_per_referrer = $10,
           updated_at = now()
         where id = 1
         returning trial_enabled, trial_variant_id::text, forced_join_channels,
                   reminders_enabled, expiry_reminder_days, low_traffic_percent,
                   referral_enabled, referral_referrer_credit_irr::text,
                   referral_invitee_discount_irr::text, referral_max_rewards_per_referrer,
                   updated_at`,
        [
          merged.trialEnabled,
          merged.trialVariantId,
          JSON.stringify(merged.forcedJoinChannels),
          merged.remindersEnabled,
          merged.expiryReminderDays,
          merged.lowTrafficPercent,
          merged.referralEnabled,
          merged.referralReferrerCreditIrr.toString(),
          merged.referralInviteeDiscountIrr.toString(),
          merged.referralMaxRewardsPerReferrer,
        ],
      );
      return mapOpsSettings(requiredRow(updated.rows));
    });
  }

  public createTrialOrder(input: {
    readonly customerId: string;
    readonly idempotencyKey: string;
    readonly serviceUsernameBase: string;
  }): Promise<SalesOrder> {
    validateServiceUsernameBase(input.serviceUsernameBase);
    return this.withTransaction(async (client) => {
      const customer = await client.query<{ id: string; shop_blocked: boolean }>(
        'select id::text, shop_blocked from customers where id = $1 for update',
        [input.customerId],
      );
      const locked = requiredRow(customer.rows);
      if (locked.shop_blocked) {
        throw new DomainConflictError('SHOP_BLOCKED');
      }
      const existing = await this.findOrderByIdempotencyKey(client, input.idempotencyKey);
      if (existing !== null) {
        if (existing.customerId !== input.customerId || existing.kind !== 'trial') {
          throw new DomainConflictError('IDEMPOTENCY_KEY_REUSED');
        }
        return existing;
      }
      const claim = await client.query<{ order_id: string }>(
        'select order_id::text from customer_trial_claims where customer_id = $1',
        [input.customerId],
      );
      if (claim.rows[0] !== undefined) {
        return this.requiredOrderWithClient(client, claim.rows[0].order_id);
      }
      const settings = await client.query<{
        trial_enabled: boolean;
        trial_variant_id: string | null;
      }>('select trial_enabled, trial_variant_id::text from storefront_ops_settings where id = 1');
      const ops = requiredRow(settings.rows);
      if (!ops.trial_enabled || ops.trial_variant_id === null) {
        throw new DomainConflictError('TRIAL_NOT_CONFIGURED');
      }
      const variant = await client.query<{ id: string }>(
        `select id::text from product_variants
         where id = $1 and active = true`,
        [ops.trial_variant_id],
      );
      if (variant.rows[0] === undefined) {
        throw new DomainConflictError('TRIAL_NOT_CONFIGURED');
      }
      const blocking = await client.query<{ exists: boolean }>(
        `select exists(
           select 1 from sales_orders
           where customer_id = $1 and status in (
             'receipt_submitted', 'provisioning', 'provisioning_failed'
           )
         ) as exists`,
        [input.customerId],
      );
      if (requiredRow(blocking.rows).exists) {
        throw new DomainConflictError('OPEN_ORDER_UNDER_REVIEW');
      }
      await client.query(
        `update sales_orders set status = 'cancelled', updated_at = now()
         where customer_id = $1 and status in ('awaiting_receipt', 'rejected')`,
        [input.customerId],
      );
      const inserted = await client.query<{ id: string }>(
        `insert into sales_orders(
           customer_id, product_variant_id, idempotency_key, amount_irr,
           representative_id, pricing_source, service_username_base,
           order_kind, status
         ) values ($1, $2, $3, 0, null, 'public', $4, 'trial', 'provisioning')
         returning id::text`,
        [input.customerId, ops.trial_variant_id, input.idempotencyKey, input.serviceUsernameBase],
      );
      const orderId = requiredRow(inserted.rows).id;
      await client.query(
        `insert into customer_trial_claims(customer_id, order_id) values ($1, $2)`,
        [input.customerId, orderId],
      );
      return this.requiredOrderWithClient(client, orderId);
    });
  }

  public async getTrialClaim(customerId: string): Promise<TrialClaim | null> {
    const result = await this.pool.query<{
      customer_id: string;
      order_id: string;
      claimed_at: Date;
    }>(
      `select customer_id::text, order_id::text, claimed_at
       from customer_trial_claims where customer_id = $1`,
      [customerId],
    );
    const row = result.rows[0];
    return row === undefined
      ? null
      : { customerId: row.customer_id, orderId: row.order_id, claimedAt: row.claimed_at };
  }

  public async listCustomerServices(
    customerId: string,
  ): Promise<readonly CustomerServiceSummary[]> {
    const result = await this.pool.query<{
      id: string;
      product_name: string;
      variant_name: string;
      status: string;
      expires_at: Date | null;
      data_limit_bytes: string;
      used_traffic_bytes: string | null;
    }>(
      `select service.id::text, product.name as product_name, variant.name as variant_name,
              service.status, service.expires_at, variant.data_limit_bytes::text,
              service.used_traffic_bytes::text
       from sales_orders orders
       join services service on service.id = orders.service_id
       join product_variants variant on variant.id = service.product_variant_id
       join products product on product.id = variant.product_id
       where orders.customer_id = $1 and orders.status = 'fulfilled'
       order by service.expires_at desc nulls last, service.id desc`,
      [customerId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      productName: row.product_name,
      variantName: row.variant_name,
      status: row.status,
      expiresAt: row.expires_at,
      dataLimitBytes: BigInt(row.data_limit_bytes),
      usedTrafficBytes: row.used_traffic_bytes === null ? null : BigInt(row.used_traffic_bytes),
    }));
  }

  public async getServiceAccessTarget(
    serviceId: string,
    customerId: string,
  ): Promise<{ readonly chatId: string; readonly subscriptionUrl: string } | null> {
    const result = await this.pool.query<{ chat_id: string; subscription_url: string }>(
      `select customer.private_chat_id::text as chat_id, service.subscription_url
       from services service
       join sales_orders orders
         on orders.service_id = service.id and orders.status = 'fulfilled'
       join customers customer on customer.id = orders.customer_id
       where service.id = $1 and customer.id = $2
       limit 1`,
      [serviceId, customerId],
    );
    return result.rows[0] === undefined
      ? null
      : { chatId: result.rows[0].chat_id, subscriptionUrl: result.rows[0].subscription_url };
  }

  public async enqueueDueServiceReminders(now: Date): Promise<number> {
    const expiry = await this.pool.query(
      `insert into service_reminder_deliveries (service_id, customer_id, kind, window_key)
       select service.id, customer.id, 'expiry',
              to_char(service.expires_at at time zone 'utc', 'YYYY-MM-DD')
       from services service
       join sales_orders orders on orders.service_id = service.id and orders.status = 'fulfilled'
       join customers customer on customer.id = orders.customer_id
       join storefront_ops_settings settings on settings.id = 1
       where settings.reminders_enabled = true
         and customer.shop_blocked = false
         and service.expires_at is not null
         and service.expires_at > $1
         and service.expires_at <= $1 + (settings.expiry_reminder_days * interval '1 day')
       on conflict (service_id, kind, window_key) do nothing`,
      [now],
    );
    const traffic = await this.pool.query(
      `insert into service_reminder_deliveries (service_id, customer_id, kind, window_key)
       select service.id, customer.id, 'low_traffic',
              to_char($1 at time zone 'utc', 'YYYY-MM-DD')
       from services service
       join sales_orders orders on orders.service_id = service.id and orders.status = 'fulfilled'
       join customers customer on customer.id = orders.customer_id
       join product_variants variant on variant.id = service.product_variant_id
       join storefront_ops_settings settings on settings.id = 1
       where settings.reminders_enabled = true
         and customer.shop_blocked = false
         and service.used_traffic_bytes is not null
         and variant.data_limit_bytes > 0
         and ((variant.data_limit_bytes - service.used_traffic_bytes) * 100)
             / variant.data_limit_bytes <= settings.low_traffic_percent
       on conflict (service_id, kind, window_key) do nothing`,
      [now],
    );
    return (expiry.rowCount ?? 0) + (traffic.rowCount ?? 0);
  }

  public async claimDueServiceReminders(
    limit: number,
    now: Date,
  ): Promise<readonly ServiceReminderDelivery[]> {
    const claimed = await this.pool.query<{ id: string }>(
      `with due as (
         select reminder.id
         from service_reminder_deliveries reminder
         where reminder.status = 'pending' and reminder.next_attempt_at <= $2
         order by reminder.id
         limit $1
         for update skip locked
       )
       update service_reminder_deliveries reminder
       set attempt_count = reminder.attempt_count + 1, updated_at = now()
       from due
       where reminder.id = due.id
       returning reminder.id::text`,
      [limit, now],
    );
    if (claimed.rows.length === 0) {
      return [];
    }
    const details = await this.pool.query<{
      id: string;
      service_id: string;
      customer_id: string;
      chat_id: string;
      kind: ServiceReminderDelivery['kind'];
      window_key: string;
      product_name: string;
      variant_name: string;
      expires_at: Date | null;
    }>(
      `select reminder.id::text, reminder.service_id::text, reminder.customer_id::text,
              customer.private_chat_id::text as chat_id, reminder.kind, reminder.window_key,
              product.name as product_name, variant.name as variant_name, service.expires_at
       from service_reminder_deliveries reminder
       join customers customer on customer.id = reminder.customer_id
       join services service on service.id = reminder.service_id
       join product_variants variant on variant.id = service.product_variant_id
       join products product on product.id = variant.product_id
       where reminder.id = any($1::bigint[])`,
      [claimed.rows.map((row) => row.id)],
    );
    return details.rows.map((row) => ({
      id: row.id,
      serviceId: row.service_id,
      customerId: row.customer_id,
      chatId: row.chat_id,
      kind: row.kind,
      windowKey: row.window_key,
      productName: row.product_name,
      variantName: row.variant_name,
      expiresAt: row.expires_at,
    }));
  }

  public async markServiceReminderDelivered(id: string, now: Date): Promise<boolean> {
    const result = await this.pool.query(
      `update service_reminder_deliveries
       set status = 'delivered', updated_at = $2
       where id = $1 and status = 'pending'`,
      [id, now],
    );
    return (result.rowCount ?? 0) > 0;
  }

  public async retryServiceReminder(
    id: string,
    errorCode: string,
    nextAttemptAt: Date,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `update service_reminder_deliveries
       set last_error_code = $2, next_attempt_at = $3, updated_at = now()
       where id = $1 and status = 'pending'`,
      [id, errorCode, nextAttemptAt],
    );
    return (result.rowCount ?? 0) > 0;
  }

  public async failServiceReminder(id: string, errorCode: string, now: Date): Promise<boolean> {
    const result = await this.pool.query(
      `update service_reminder_deliveries
       set status = 'failed', last_error_code = $2, updated_at = $3
       where id = $1 and status = 'pending'`,
      [id, errorCode, now],
    );
    return (result.rowCount ?? 0) > 0;
  }

  public createBroadcastJob(input: {
    readonly adminTelegramUserId: string;
    readonly body: string;
    readonly bodySha256: string;
  }): Promise<BroadcastJob> {
    return this.withTransaction(async (client) => {
      const job = await client.query<{
        id: string;
        created_at: Date;
      }>(
        `insert into broadcast_jobs(admin_telegram_user_id, body, body_sha256, status)
         values ($1, $2, $3, 'queued')
         returning id::text, created_at`,
        [input.adminTelegramUserId, input.body, input.bodySha256],
      );
      const created = requiredRow(job.rows);
      const recipients = await client.query(
        `insert into broadcast_recipients(job_id, customer_id, chat_id)
         select $1, id, private_chat_id
         from customers
         where shop_blocked = false`,
        [created.id],
      );
      const recipientCount = recipients.rowCount ?? 0;
      const status = recipientCount === 0 ? 'completed' : 'queued';
      await client.query(
        `update broadcast_jobs set status = $2, completed_at = case when $2 = 'completed' then now() else null end,
                updated_at = now()
         where id = $1`,
        [created.id, status],
      );
      return {
        id: created.id,
        adminTelegramUserId: input.adminTelegramUserId,
        body: input.body,
        bodySha256: input.bodySha256,
        status,
        recipientCount,
        sentCount: 0,
        failedCount: 0,
        createdAt: created.created_at,
      };
    });
  }

  public async cancelBroadcastJob(
    jobId: string,
    adminTelegramUserId: string,
  ): Promise<BroadcastJob> {
    const result = await this.pool.query(
      `update broadcast_jobs
       set status = 'canceled', canceled_at = now(), updated_at = now()
       where id = $1 and admin_telegram_user_id = $2
         and status in ('queued', 'running')`,
      [jobId, adminTelegramUserId],
    );
    if ((result.rowCount ?? 0) === 0) {
      throw new DomainConflictError('BROADCAST_NOT_CANCELABLE');
    }
    await this.pool.query(
      `update broadcast_recipients set status = 'skipped', updated_at = now()
       where job_id = $1 and status = 'pending'`,
      [jobId],
    );
    const job = await this.getBroadcastJob(jobId);
    if (job === null) {
      throw new DomainConflictError('BROADCAST_NOT_FOUND');
    }
    return job;
  }

  public async getBroadcastJob(jobId: string): Promise<BroadcastJob | null> {
    const result = await this.pool.query<BroadcastJobRow>(broadcastJobQuery('job.id = $1'), [
      jobId,
    ]);
    return result.rows[0] === undefined ? null : mapBroadcastJob(result.rows[0]);
  }

  public async listRecentBroadcastJobs(limit: number): Promise<readonly BroadcastJob[]> {
    const result = await this.pool.query<BroadcastJobRow>(
      `${broadcastJobQuery('true')} order by job.id desc limit $1`,
      [limit],
    );
    return result.rows.map(mapBroadcastJob);
  }

  public async claimDueBroadcastRecipients(
    limit: number,
    now: Date,
  ): Promise<
    readonly {
      readonly id: string;
      readonly jobId: string;
      readonly chatId: string;
      readonly body: string;
    }[]
  > {
    const result = await this.pool.query<{
      id: string;
      job_id: string;
      chat_id: string;
      body: string;
    }>(
      `with due as (
         select recipient.id
         from broadcast_recipients recipient
         join broadcast_jobs job on job.id = recipient.job_id
         where recipient.status = 'pending'
           and recipient.next_attempt_at <= $2
           and job.status in ('queued', 'running')
         order by recipient.id
         limit $1
         for update of recipient skip locked
       )
       update broadcast_recipients recipient
       set attempt_count = recipient.attempt_count + 1
       from due, broadcast_jobs job
       where recipient.id = due.id and job.id = recipient.job_id
       returning recipient.id::text, recipient.job_id::text, recipient.chat_id::text, job.body`,
      [limit, now],
    );
    if (result.rows.length > 0) {
      await this.pool.query(
        `update broadcast_jobs set status = 'running', updated_at = now()
         where id = any($1::bigint[]) and status = 'queued'`,
        [...new Set(result.rows.map((row) => row.job_id))],
      );
    }
    return result.rows.map((row) => ({
      id: row.id,
      jobId: row.job_id,
      chatId: row.chat_id,
      body: row.body,
    }));
  }

  public async markBroadcastRecipientSent(id: string, now: Date): Promise<boolean> {
    const result = await this.pool.query<{ job_id: string }>(
      `update broadcast_recipients
       set status = 'sent', sent_at = $2
       where id = $1 and status = 'pending'
       returning job_id::text`,
      [id, now],
    );
    const jobId = result.rows[0]?.job_id;
    if (jobId !== undefined) {
      await this.completeBroadcastIfIdle(jobId);
    }
    return (result.rowCount ?? 0) > 0;
  }

  public async retryBroadcastRecipient(
    id: string,
    errorCode: string,
    nextAttemptAt: Date,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `update broadcast_recipients
       set last_error_code = $2, next_attempt_at = $3
       where id = $1 and status = 'pending'`,
      [id, errorCode, nextAttemptAt],
    );
    return (result.rowCount ?? 0) > 0;
  }

  public async failBroadcastRecipient(id: string, errorCode: string, now: Date): Promise<boolean> {
    const result = await this.pool.query<{ job_id: string }>(
      `update broadcast_recipients
       set status = 'failed', last_error_code = $2, sent_at = $3
       where id = $1 and status = 'pending'
       returning job_id::text`,
      [id, errorCode, now],
    );
    const jobId = result.rows[0]?.job_id;
    if (jobId !== undefined) {
      await this.completeBroadcastIfIdle(jobId);
    }
    return (result.rowCount ?? 0) > 0;
  }

  public async setCustomerShopBlocked(
    telegramUserId: string,
    blocked: boolean,
  ): Promise<TelegramCustomer> {
    const result = await this.pool.query<CustomerRow>(
      `update customers
       set shop_blocked = $2, updated_at = now()
       where telegram_user_id = $1
       returning id::text, telegram_user_id::text, private_chat_id::text,
                 telegram_username, display_name, shop_blocked`,
      [telegramUserId, blocked],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new DomainConflictError('CUSTOMER_NOT_FOUND');
    }
    return mapCustomer(row);
  }

  public async countCommercialQueues(): Promise<{
    readonly remindersPending: number;
    readonly broadcastsPending: number;
    readonly broadcastsRunning: number;
    readonly usageSyncDue: number;
  }> {
    const result = await this.pool.query<{
      reminders_pending: number;
      broadcasts_pending: number;
      broadcasts_running: number;
      usage_sync_due: number;
    }>(
      `select
         (select count(*)::int from service_reminder_deliveries where status = 'pending') as reminders_pending,
         (select count(*)::int from broadcast_recipients where status = 'pending') as broadcasts_pending,
         (select count(*)::int from broadcast_jobs where status in ('queued', 'running')) as broadcasts_running,
         (select count(*)::int from services
           where status = 'active'
             and (usage_synced_at is null or usage_synced_at <= now() - interval '10 minutes')
         ) as usage_sync_due`,
    );
    const row = result.rows[0];
    return {
      remindersPending: row?.reminders_pending ?? 0,
      broadcastsPending: row?.broadcasts_pending ?? 0,
      broadcastsRunning: row?.broadcasts_running ?? 0,
      usageSyncDue: row?.usage_sync_due ?? 0,
    };
  }

  public attributeReferralStart(input: {
    readonly customerId: string;
    readonly inviteeTelegramUserId: string;
    readonly referrerTelegramUserId: string;
  }): Promise<ReferralAttribution | null> {
    return this.withTransaction(async (client) => {
      const referrer = await client.query<{ id: string; telegram_user_id: string }>(
        `select id::text, telegram_user_id::text from customers
         where telegram_user_id = $1`,
        [input.referrerTelegramUserId],
      );
      const found = referrer.rows[0];
      if (found === undefined || found.id === input.customerId) {
        return null;
      }
      const existing = await client.query<ReferralAttributionRow>(
        `select customer_id::text, referrer_customer_id::text,
                referrer_telegram_user_id::text, invitee_discount_order_id::text, created_at
         from referral_attributions where customer_id = $1`,
        [input.customerId],
      );
      if (existing.rows[0] !== undefined) {
        return mapReferralAttribution(existing.rows[0]);
      }
      const inserted = await client.query<ReferralAttributionRow>(
        `insert into referral_attributions (
           customer_id, referrer_customer_id, referrer_telegram_user_id
         ) values ($1, $2, $3)
         on conflict (customer_id) do nothing
         returning customer_id::text, referrer_customer_id::text,
                   referrer_telegram_user_id::text, invitee_discount_order_id::text, created_at`,
        [input.customerId, found.id, found.telegram_user_id],
      );
      if (inserted.rows[0] !== undefined) {
        return mapReferralAttribution(inserted.rows[0]);
      }
      const replay = await client.query<ReferralAttributionRow>(
        `select customer_id::text, referrer_customer_id::text,
                referrer_telegram_user_id::text, invitee_discount_order_id::text, created_at
         from referral_attributions where customer_id = $1`,
        [input.customerId],
      );
      return replay.rows[0] === undefined ? null : mapReferralAttribution(replay.rows[0]);
    });
  }

  public async getReferralAttribution(customerId: string): Promise<ReferralAttribution | null> {
    const result = await this.pool.query<ReferralAttributionRow>(
      `select customer_id::text, referrer_customer_id::text,
              referrer_telegram_user_id::text, invitee_discount_order_id::text, created_at
       from referral_attributions where customer_id = $1`,
      [customerId],
    );
    return result.rows[0] === undefined ? null : mapReferralAttribution(result.rows[0]);
  }

  public grantReferralRewardForPaidOrder(order: SalesOrder): Promise<ReferralReward | null> {
    if (!isPaidFulfillmentEligible(order)) {
      return Promise.resolve(null);
    }
    return this.withTransaction(async (client) => {
      const existing = await client.query<ReferralRewardRow>(
        `select referred_customer_id::text, referrer_customer_id::text, order_id::text,
                referrer_credit_irr::text, created_at
         from referral_rewards where referred_customer_id = $1`,
        [order.customerId],
      );
      if (existing.rows[0] !== undefined) {
        return mapReferralReward(existing.rows[0], true);
      }
      const settings = await client.query<OpsSettingsRow>(
        `select trial_enabled, trial_variant_id::text, forced_join_channels,
                reminders_enabled, expiry_reminder_days, low_traffic_percent,
                referral_enabled, referral_referrer_credit_irr::text,
                referral_invitee_discount_irr::text, referral_max_rewards_per_referrer,
                updated_at
         from storefront_ops_settings where id = 1`,
      );
      const ops =
        settings.rows[0] === undefined
          ? defaultStorefrontOpsSettings()
          : mapOpsSettings(settings.rows[0]);
      if (!ops.referralEnabled) {
        return null;
      }
      const attribution = await client.query<ReferralAttributionRow>(
        `select customer_id::text, referrer_customer_id::text,
                referrer_telegram_user_id::text, invitee_discount_order_id::text, created_at
         from referral_attributions where customer_id = $1 for update`,
        [order.customerId],
      );
      const link = attribution.rows[0];
      if (link === undefined) {
        return null;
      }
      const referrer = await client.query<{ shop_blocked: boolean }>(
        'select shop_blocked from customers where id = $1 for update',
        [link.referrer_customer_id],
      );
      const rewardCount = await client.query<{ n: number }>(
        'select count(*)::int as n from referral_rewards where referrer_customer_id = $1',
        [link.referrer_customer_id],
      );
      const underCap =
        (rewardCount.rows[0]?.n ?? 0) < ops.referralMaxRewardsPerReferrer;
      const blocked = referrer.rows[0]?.shop_blocked === true;
      const credit =
        !blocked && underCap && ops.referralReferrerCreditIrr > 0n
          ? ops.referralReferrerCreditIrr
          : 0n;
      const inserted = await client.query<ReferralRewardRow>(
        `insert into referral_rewards (
           referred_customer_id, referrer_customer_id, order_id, referrer_credit_irr
         ) values ($1, $2, $3, $4)
         on conflict (referred_customer_id) do nothing
         returning referred_customer_id::text, referrer_customer_id::text, order_id::text,
                   referrer_credit_irr::text, created_at`,
        [order.customerId, link.referrer_customer_id, order.id, credit.toString()],
      );
      const row = inserted.rows[0];
      if (row === undefined) {
        const replay = requiredRow(
          (
            await client.query<ReferralRewardRow>(
              `select referred_customer_id::text, referrer_customer_id::text, order_id::text,
                      referrer_credit_irr::text, created_at
               from referral_rewards where referred_customer_id = $1`,
              [order.customerId],
            )
          ).rows,
        );
        return mapReferralReward(replay, true);
      }
      if (credit > 0n) {
        await creditReferralWallet(client, {
          customerId: link.referrer_customer_id,
          amountIrr: credit,
          idempotencyKey: referralRewardIdempotencyKey(order.customerId),
        });
      }
      return mapReferralReward(row, false);
    });
  }

  public async getAdminSalesSnapshot(now: Date): Promise<AdminSalesSnapshot> {
    const result = await this.pool.query<SalesSnapshotRow>(
      `with bounds as (
         select
           ((($1 at time zone 'Asia/Tehran')::date)::timestamp at time zone 'Asia/Tehran') as today_start,
           (((($1 at time zone 'Asia/Tehran')::date - 6)::timestamp) at time zone 'Asia/Tehran') as week_start,
           (((($1 at time zone 'Asia/Tehran')::date + 1)::timestamp) at time zone 'Asia/Tehran') as tomorrow
       )
       select
         count(*) filter (where orders.created_at >= bounds.today_start and orders.created_at < bounds.tomorrow
           and orders.status = 'awaiting_receipt')::int as today_awaiting_receipt,
         count(*) filter (where orders.created_at >= bounds.today_start and orders.created_at < bounds.tomorrow
           and orders.status = 'receipt_submitted')::int as today_receipt_submitted,
         count(*) filter (where orders.created_at >= bounds.today_start and orders.created_at < bounds.tomorrow
           and orders.status = 'provisioning')::int as today_provisioning,
         count(*) filter (where orders.created_at >= bounds.today_start and orders.created_at < bounds.tomorrow
           and orders.status = 'provisioning_failed')::int as today_provisioning_failed,
         count(*) filter (where orders.created_at >= bounds.today_start and orders.created_at < bounds.tomorrow
           and orders.status = 'fulfilled')::int as today_fulfilled,
         count(*) filter (where orders.created_at >= bounds.today_start and orders.created_at < bounds.tomorrow
           and orders.status = 'rejected')::int as today_rejected,
         count(*) filter (where orders.created_at >= bounds.today_start and orders.created_at < bounds.tomorrow
           and orders.status = 'cancelled')::int as today_cancelled,
         coalesce(sum(orders.amount_irr) filter (
           where orders.created_at >= bounds.today_start and orders.created_at < bounds.tomorrow
             and orders.status = 'fulfilled'
         ), 0)::text as today_revenue,
         (select count(*)::int from customers customer, bounds
           where customer.created_at >= bounds.today_start and customer.created_at < bounds.tomorrow
         ) as today_new_customers,
         count(*) filter (where orders.created_at >= bounds.week_start and orders.created_at < bounds.tomorrow
           and orders.status = 'awaiting_receipt')::int as week_awaiting_receipt,
         count(*) filter (where orders.created_at >= bounds.week_start and orders.created_at < bounds.tomorrow
           and orders.status = 'receipt_submitted')::int as week_receipt_submitted,
         count(*) filter (where orders.created_at >= bounds.week_start and orders.created_at < bounds.tomorrow
           and orders.status = 'provisioning')::int as week_provisioning,
         count(*) filter (where orders.created_at >= bounds.week_start and orders.created_at < bounds.tomorrow
           and orders.status = 'provisioning_failed')::int as week_provisioning_failed,
         count(*) filter (where orders.created_at >= bounds.week_start and orders.created_at < bounds.tomorrow
           and orders.status = 'fulfilled')::int as week_fulfilled,
         count(*) filter (where orders.created_at >= bounds.week_start and orders.created_at < bounds.tomorrow
           and orders.status = 'rejected')::int as week_rejected,
         count(*) filter (where orders.created_at >= bounds.week_start and orders.created_at < bounds.tomorrow
           and orders.status = 'cancelled')::int as week_cancelled,
         coalesce(sum(orders.amount_irr) filter (
           where orders.created_at >= bounds.week_start and orders.created_at < bounds.tomorrow
             and orders.status = 'fulfilled'
         ), 0)::text as week_revenue,
         (select count(*)::int from customers customer, bounds
           where customer.created_at >= bounds.week_start and customer.created_at < bounds.tomorrow
         ) as week_new_customers,
         (select count(*)::int from support_tickets where status = 'open') as open_tickets,
         (select count(*)::int from sales_orders where status = 'receipt_submitted') as pending_receipts
       from bounds
       left join sales_orders orders on true`,
      [now],
    );
    const row = result.rows[0];
    return {
      timezone: 'Asia/Tehran',
      today: mapSalesWindow(row, 'today'),
      last7d: mapSalesWindow(row, 'week'),
      openTickets: row?.open_tickets ?? 0,
      pendingReceiptReviews: row?.pending_receipts ?? 0,
    };
  }

  public async listServicesDueForUsageSync(
    limit: number,
    staleBefore: Date,
  ): Promise<readonly UsageSyncTarget[]> {
    const result = await this.pool.query<{
      id: string;
      target_user_id: string;
      used_traffic_bytes: string | null;
    }>(
      `select id::text, target_user_id::text, used_traffic_bytes::text
       from services
       where status = 'active'
         and (usage_synced_at is null or usage_synced_at <= $2)
       order by usage_synced_at nulls first, id
       limit $1`,
      [limit, staleBefore],
    );
    return result.rows.map((row) => ({
      serviceId: row.id,
      targetUserId: Number(row.target_user_id),
      usedTrafficBytes: row.used_traffic_bytes === null ? null : BigInt(row.used_traffic_bytes),
    }));
  }

  public async persistServiceUsedTraffic(input: UsageSyncWrite): Promise<boolean> {
    const result = input.remoteFound
      ? await this.pool.query(
          `update services
           set used_traffic_bytes = $2, usage_synced_at = now(), updated_at = now()
           where id = $1 and target_user_id = $3`,
          [input.serviceId, input.usedTrafficBytes?.toString() ?? '0', input.targetUserId],
        )
      : await this.pool.query(
          `update services
           set usage_synced_at = now(), updated_at = now()
           where id = $1 and target_user_id = $2`,
          [input.serviceId, input.targetUserId],
        );
    return (result.rowCount ?? 0) > 0;
  }

  public async countDueUsageSync(staleBefore: Date): Promise<number> {
    const result = await this.pool.query<{ n: number }>(
      `select count(*)::int as n from services
       where status = 'active'
         and (usage_synced_at is null or usage_synced_at <= $1)`,
      [staleBefore],
    );
    return result.rows[0]?.n ?? 0;
  }

  private async completeBroadcastIfIdle(jobId: string): Promise<void> {
    await this.pool.query(
      `update broadcast_jobs
       set status = 'completed', completed_at = now(), updated_at = now()
       where id = $1
         and status in ('queued', 'running')
         and not exists (
           select 1 from broadcast_recipients
           where job_id = $1 and status = 'pending'
         )`,
      [jobId],
    );
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

  private async createPendingCheckoutOrder(
    client: PoolClient,
    input: {
      readonly customerId: string;
      readonly productVariantId: string;
      readonly idempotencyKey: string;
      readonly representativeId: string | undefined;
      readonly serviceUsernameBase: string | undefined;
      readonly kind: SalesOrder['kind'];
      readonly targetServiceId: string | null;
    },
  ): Promise<SalesOrder> {
    const selected = await resolveCheckoutPrice(
      client,
      input.productVariantId,
      input.representativeId,
    );
    const priced =
      input.kind === 'purchase'
        ? await applyReferralInviteeDiscount(client, input.customerId, selected.priceIrr)
        : { amountIrr: selected.priceIrr, discountApplied: false };
    const blocking = await client.query<{ exists: boolean }>(
      `select exists(
         select 1 from sales_orders
         where customer_id = $1 and status in (
           'receipt_submitted', 'provisioning', 'provisioning_failed'
         )
       ) as exists`,
      [input.customerId],
    );
    if (requiredRow(blocking.rows).exists) {
      throw new DomainConflictError('OPEN_ORDER_UNDER_REVIEW');
    }
    await client.query(
      `update sales_orders set status = 'cancelled', updated_at = now()
       where customer_id = $1 and status in ('awaiting_receipt', 'rejected')`,
      [input.customerId],
    );
    const inserted = await client.query<{ id: string }>(
      `insert into sales_orders(
         customer_id, product_variant_id, idempotency_key, amount_irr,
         representative_id, pricing_source, service_username_base,
         order_kind, target_service_id
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       returning id::text`,
      [
        input.customerId,
        input.productVariantId,
        input.idempotencyKey,
        priced.amountIrr.toString(),
        input.representativeId ?? null,
        selected.pricingSource,
        input.serviceUsernameBase ?? null,
        input.kind,
        input.targetServiceId,
      ],
    );
    const order = await this.requiredOrderWithClient(client, requiredRow(inserted.rows).id);
    if (priced.discountApplied) {
      await client.query(
        `update referral_attributions
         set invitee_discount_order_id = $2
         where customer_id = $1 and invitee_discount_order_id is null`,
        [input.customerId, order.id],
      );
    }
    return order;
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
  media_kind,
  submitted_at
`;

const deliveryJobColumns = `
  id::text,
  order_id::text,
  customer_id::text,
  service_id::text,
  stage,
  attempt_count,
  claim_version::text as claim_version,
  next_attempt_at,
  last_error_code,
  telegram_message_id::text,
  created_at,
  updated_at
`;

function mapDeliveryJob(row: DeliveryJobRow): CustomerDeliveryJob {
  return {
    id: row.id,
    orderId: row.order_id,
    customerId: row.customer_id,
    serviceId: row.service_id,
    stage: row.stage,
    attemptCount: row.attempt_count,
    claimVersion: row.claim_version,
    nextAttemptAt: row.next_attempt_at,
    lastErrorCode: row.last_error_code,
    telegramMessageId: row.telegram_message_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function orderQuery(predicate: string): string {
  return `select
    orders.id::text,
    orders.customer_id::text,
    orders.product_variant_id::text,
    product.name as product_name,
    variant.name as variant_name,
    orders.amount_irr::text,
    orders.order_kind,
    orders.status,
    orders.service_id::text,
    orders.target_service_id::text,
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
    shopBlocked: row.shop_blocked === true,
  };
}

interface OpsSettingsRow {
  trial_enabled: boolean;
  trial_variant_id: string | null;
  forced_join_channels: unknown;
  reminders_enabled: boolean;
  expiry_reminder_days: number;
  low_traffic_percent: number;
  referral_enabled: boolean;
  referral_referrer_credit_irr: string;
  referral_invitee_discount_irr: string;
  referral_max_rewards_per_referrer: number;
  updated_at: Date;
}

interface ReferralAttributionRow {
  customer_id: string;
  referrer_customer_id: string;
  referrer_telegram_user_id: string;
  invitee_discount_order_id: string | null;
  created_at: Date;
}

interface ReferralRewardRow {
  referred_customer_id: string;
  referrer_customer_id: string;
  order_id: string;
  referrer_credit_irr: string;
  created_at: Date;
}

interface SalesSnapshotRow {
  today_awaiting_receipt: number;
  today_receipt_submitted: number;
  today_provisioning: number;
  today_provisioning_failed: number;
  today_fulfilled: number;
  today_rejected: number;
  today_cancelled: number;
  today_revenue: string;
  today_new_customers: number;
  week_awaiting_receipt: number;
  week_receipt_submitted: number;
  week_provisioning: number;
  week_provisioning_failed: number;
  week_fulfilled: number;
  week_rejected: number;
  week_cancelled: number;
  week_revenue: string;
  week_new_customers: number;
  open_tickets: number;
  pending_receipts: number;
}

function mapOpsSettings(row: OpsSettingsRow): StorefrontOpsSettings {
  return {
    trialEnabled: row.trial_enabled,
    trialVariantId: row.trial_variant_id,
    forcedJoinChannels: parseForcedJoinChannels(row.forced_join_channels),
    remindersEnabled: row.reminders_enabled,
    expiryReminderDays: row.expiry_reminder_days,
    lowTrafficPercent: row.low_traffic_percent,
    referralEnabled: row.referral_enabled,
    referralReferrerCreditIrr: BigInt(row.referral_referrer_credit_irr),
    referralInviteeDiscountIrr: BigInt(row.referral_invitee_discount_irr),
    referralMaxRewardsPerReferrer: row.referral_max_rewards_per_referrer,
    updatedAt: row.updated_at,
  };
}

function mapReferralAttribution(row: ReferralAttributionRow): ReferralAttribution {
  return {
    customerId: row.customer_id,
    referrerCustomerId: row.referrer_customer_id,
    referrerTelegramUserId: row.referrer_telegram_user_id,
    inviteeDiscountOrderId: row.invitee_discount_order_id,
    createdAt: row.created_at,
  };
}

function mapReferralReward(row: ReferralRewardRow, replayed: boolean): ReferralReward {
  return {
    referredCustomerId: row.referred_customer_id,
    referrerCustomerId: row.referrer_customer_id,
    orderId: row.order_id,
    referrerCreditIrr: BigInt(row.referrer_credit_irr),
    replayed,
    createdAt: row.created_at,
  };
}

function mapSalesWindow(
  row: SalesSnapshotRow | undefined,
  prefix: 'today' | 'week',
): AdminSalesWindowSnapshot {
  const ordersByStatus: Record<SalesOrderStatus, number> = {
    awaiting_receipt: row?.[`${prefix}_awaiting_receipt`] ?? 0,
    receipt_submitted: row?.[`${prefix}_receipt_submitted`] ?? 0,
    provisioning: row?.[`${prefix}_provisioning`] ?? 0,
    provisioning_failed: row?.[`${prefix}_provisioning_failed`] ?? 0,
    fulfilled: row?.[`${prefix}_fulfilled`] ?? 0,
    rejected: row?.[`${prefix}_rejected`] ?? 0,
    cancelled: row?.[`${prefix}_cancelled`] ?? 0,
  };
  return {
    ordersByStatus,
    orderCount: Object.values(ordersByStatus).reduce((sum, count) => sum + count, 0),
    revenueIrr: BigInt(row?.[`${prefix}_revenue`] ?? '0'),
    newCustomers: row?.[`${prefix}_new_customers`] ?? 0,
  };
}

async function applyReferralInviteeDiscount(
  client: PoolClient,
  customerId: string,
  priceIrr: bigint,
): Promise<{ readonly amountIrr: bigint; readonly discountApplied: boolean }> {
  const settings = await client.query<{
    referral_enabled: boolean;
    referral_invitee_discount_irr: string;
  }>(
    `select referral_enabled, referral_invitee_discount_irr::text
     from storefront_ops_settings where id = 1`,
  );
  const ops = settings.rows[0];
  if (ops === undefined || !ops.referral_enabled) {
    return { amountIrr: priceIrr, discountApplied: false };
  }
  const discountIrr = BigInt(ops.referral_invitee_discount_irr);
  if (discountIrr <= 0n) {
    return { amountIrr: priceIrr, discountApplied: false };
  }
  const attribution = await client.query<{ invitee_discount_order_id: string | null }>(
    `select invitee_discount_order_id::text
     from referral_attributions where customer_id = $1 for update`,
    [customerId],
  );
  if (attribution.rows[0] === undefined || attribution.rows[0].invitee_discount_order_id !== null) {
    return { amountIrr: priceIrr, discountApplied: false };
  }
  const priced = applyInviteeCheckoutDiscount(priceIrr, discountIrr);
  return { amountIrr: priced.amountIrr, discountApplied: priced.discountAppliedIrr > 0n };
}

async function creditReferralWallet(
  client: PoolClient,
  input: {
    readonly customerId: string;
    readonly amountIrr: bigint;
    readonly idempotencyKey: string;
  },
): Promise<void> {
  const existing = await client.query<{ customer_id: string; amount_irr: string }>(
    `select customer_id::text, amount_irr::text
     from customer_wallet_ledger where idempotency_key = $1`,
    [input.idempotencyKey],
  );
  if (existing.rows[0] !== undefined) {
    if (
      existing.rows[0].customer_id !== input.customerId ||
      BigInt(existing.rows[0].amount_irr) !== input.amountIrr
    ) {
      throw new DomainConflictError('IDEMPOTENCY_KEY_REUSED');
    }
    return;
  }
  await client.query(
    `insert into customer_wallet_ledger(
       customer_id, amount_irr, kind, idempotency_key, discount_code
     ) values ($1::bigint, $2, 'referral', $3, null)`,
    [input.customerId, input.amountIrr.toString(), input.idempotencyKey],
  );
  await client.query(
    `insert into customer_wallets(customer_id, balance_irr)
     values ($1::bigint, $2)
     on conflict (customer_id) do update
     set balance_irr = customer_wallets.balance_irr + excluded.balance_irr,
         updated_at = now()`,
    [input.customerId, input.amountIrr.toString()],
  );
}

function parseForcedJoinChannels(value: unknown): readonly ForcedJoinChannel[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const channels: ForcedJoinChannel[] = [];
  for (const item of value) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      continue;
    }
    const record = item as Record<string, unknown>;
    if (typeof record['chatId'] !== 'string') {
      continue;
    }
    channels.push({
      chatId: record['chatId'],
      username: typeof record['username'] === 'string' ? record['username'] : null,
    });
  }
  return channels;
}

interface BroadcastJobRow {
  id: string;
  admin_telegram_user_id: string;
  body: string;
  body_sha256: string;
  status: BroadcastJob['status'];
  recipient_count: number;
  sent_count: number;
  failed_count: number;
  created_at: Date;
}

function broadcastJobQuery(where: string): string {
  return `select job.id::text, job.admin_telegram_user_id::text, job.body, job.body_sha256,
                 job.status, job.created_at,
                 count(recipient.id)::int as recipient_count,
                 count(recipient.id) filter (where recipient.status = 'sent')::int as sent_count,
                 count(recipient.id) filter (where recipient.status = 'failed')::int as failed_count
          from broadcast_jobs job
          left join broadcast_recipients recipient on recipient.job_id = job.id
          where ${where}
          group by job.id`;
}

function mapBroadcastJob(row: BroadcastJobRow): BroadcastJob {
  return {
    id: row.id,
    adminTelegramUserId: row.admin_telegram_user_id,
    body: row.body,
    bodySha256: row.body_sha256,
    status: row.status,
    recipientCount: row.recipient_count,
    sentCount: row.sent_count,
    failedCount: row.failed_count,
    createdAt: row.created_at,
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
    kind: row.order_kind,
    status: row.status,
    serviceId: row.service_id,
    targetServiceId: row.target_service_id,
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
    mediaKind: row.media_kind,
    submittedAt: row.submitted_at,
  };
}

function conversationSessionQuery(where: string): string {
  return `select id::text, telegram_user_id::text, flow_id, step, schema_version, payload,
                 status, created_at, updated_at, expires_at
          from conversation_sessions
          where ${where}`;
}

function mapConversationSession(row: ConversationSessionRow): DurableConversationSession {
  return parseDurableConversationSession({
    id: row.id,
    telegramUserId: row.telegram_user_id,
    flowId: row.flow_id,
    step: row.step,
    schemaVersion: row.schema_version,
    payload: row.payload,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
  });
}

function mapWalletLedger(row: WalletLedgerRow, replayed: boolean): WalletLedgerEntry {
  return {
    id: row.id,
    customerId: row.customer_id,
    amountIrr: BigInt(row.amount_irr),
    kind: row.kind,
    idempotencyKey: row.idempotency_key,
    discountCode: row.discount_code,
    createdAt: row.created_at,
    replayed,
  };
}

function mapSupportTicket(row: SupportTicketRow): SupportTicket {
  return {
    id: row.id,
    customerId: row.customer_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function requiredTicket(
  client: PoolClient,
  ticketId: string,
  customerId: string,
): Promise<SupportTicket> {
  const result = await client.query<SupportTicketRow>(
    `select id::text, customer_id::text, status, created_at, updated_at
     from support_tickets
     where id = $1::bigint and customer_id = $2::bigint`,
    [ticketId, customerId],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new DomainConflictError('TICKET_NOT_FOUND');
  }
  return mapSupportTicket(row);
}
