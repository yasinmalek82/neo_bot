alter table products
  add column description text not null default '';

alter table product_variants
  add column description text not null default '',
  add column price_irr bigint not null default 0 check (price_irr >= 0),
  add column sellable boolean not null default false;

create table product_categories (
  id bigint generated always as identity primary key,
  parent_id bigint references product_categories(id) on delete restrict,
  code text not null unique check (code ~ '^[a-z0-9-]{3,80}$'),
  name text not null check (char_length(name) between 1 and 120),
  description text not null default '',
  position integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index product_categories_parent_id_idx on product_categories (parent_id);
create index product_categories_navigation_idx
  on product_categories (parent_id, position, id)
  where active = true;

create table product_category_assignments (
  category_id bigint not null references product_categories(id) on delete cascade,
  product_id bigint not null references products(id) on delete cascade,
  position integer not null default 0,
  primary key (category_id, product_id)
);

create index product_category_assignments_product_id_idx
  on product_category_assignments (product_id);

create table customers (
  id bigint generated always as identity primary key,
  telegram_user_id bigint not null unique check (telegram_user_id > 0),
  private_chat_id bigint not null unique check (private_chat_id > 0),
  telegram_username text,
  display_name text not null check (char_length(display_name) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (telegram_user_id = private_chat_id)
);

create table sales_orders (
  id bigint generated always as identity primary key,
  customer_id bigint not null references customers(id) on delete restrict,
  product_variant_id bigint not null references product_variants(id) on delete restrict,
  idempotency_key text not null unique,
  amount_irr bigint not null check (amount_irr > 0),
  status text not null default 'awaiting_receipt' check (
    status in (
      'awaiting_receipt',
      'receipt_submitted',
      'provisioning',
      'provisioning_failed',
      'fulfilled',
      'rejected',
      'cancelled'
    )
  ),
  service_id bigint references services(id) on delete restrict,
  approved_by_telegram_user_id bigint,
  approved_at timestamptz,
  failure_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index sales_orders_customer_id_idx on sales_orders (customer_id);
create index sales_orders_product_variant_id_idx on sales_orders (product_variant_id);
create index sales_orders_service_id_idx on sales_orders (service_id) where service_id is not null;
create unique index sales_orders_one_open_per_customer_idx on sales_orders (customer_id)
  where status in (
    'awaiting_receipt',
    'receipt_submitted',
    'provisioning',
    'provisioning_failed',
    'rejected'
  );
create index sales_orders_admin_queue_idx on sales_orders (status, created_at)
  where status in ('receipt_submitted', 'provisioning_failed');

create table telegram_payment_proofs (
  id bigint generated always as identity primary key,
  order_id bigint not null references sales_orders(id) on delete restrict,
  telegram_file_id text not null,
  telegram_file_unique_id text not null,
  submitted_at timestamptz not null default now(),
  unique (order_id, telegram_file_unique_id)
);

create index telegram_payment_proofs_order_id_idx on telegram_payment_proofs (order_id);

create table telegram_updates (
  update_id bigint primary key,
  status text not null check (status in ('processing', 'completed', 'failed')),
  error_code text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create index telegram_updates_failed_idx on telegram_updates (started_at)
  where status = 'failed';
