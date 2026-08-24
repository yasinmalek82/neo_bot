create table representatives (
  id bigint generated always as identity primary key,
  code text not null unique check (code ~ '^[a-z0-9-]{3,80}$'),
  telegram_user_id bigint not null unique check (telegram_user_id > 0),
  display_name text not null check (char_length(display_name) between 1 and 120),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table customers
  add column representative_id bigint references representatives(id) on delete set null;

alter table sales_orders
  add column representative_id bigint references representatives(id) on delete set null,
  add column pricing_source text not null default 'public' check (
    pricing_source in ('public', 'representative_base', 'representative_override')
  );

create index customers_representative_id_idx on customers (representative_id);
create index sales_orders_representative_id_idx on sales_orders (representative_id)
  where representative_id is not null;

create table representative_variant_access (
  representative_id bigint not null references representatives(id) on delete cascade,
  product_variant_id bigint not null references product_variants(id) on delete cascade,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (representative_id, product_variant_id)
);

create table representative_variant_base_prices (
  product_variant_id bigint primary key references product_variants(id) on delete cascade,
  price_irr bigint not null check (price_irr > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table representative_variant_price_overrides (
  representative_id bigint not null references representatives(id) on delete cascade,
  product_variant_id bigint not null references product_variants(id) on delete cascade,
  price_irr bigint not null check (price_irr > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (representative_id, product_variant_id)
);

create index representative_variant_access_active_idx
  on representative_variant_access (representative_id, active, product_variant_id);

create index representative_variant_price_overrides_idx
  on representative_variant_price_overrides (representative_id, product_variant_id);

alter table reporting_events drop constraint reporting_events_event_type_check;

alter table reporting_events add constraint reporting_events_event_type_check check (
  event_type in (
    'customer.first_contact',
    'customer.activity',
    'order.created',
    'payment.proof_submitted',
    'payment.approved',
    'payment.rejected',
    'provisioning.succeeded',
    'provisioning.failed',
    'renewal.requested',
    'renewal.completed',
    'renewal.failed',
    'system.failure',
    'ops.daily_summary',
    'reseller.order_created',
    'reseller.assignment_updated',
    'reseller.pricing_updated'
  )
);
