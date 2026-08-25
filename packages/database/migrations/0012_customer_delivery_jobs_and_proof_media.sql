alter table telegram_payment_proofs
  add column media_kind text check (
    media_kind is null or media_kind in ('photo', 'document')
  );

create table customer_delivery_jobs (
  id bigserial primary key,
  order_id bigint not null unique references sales_orders(id) on delete restrict,
  customer_id bigint not null references customers(id) on delete restrict,
  service_id bigint not null references services(id) on delete restrict,
  stage text not null default 'pending_brand_media' check (stage in (
    'pending_brand_media',
    'pending_link',
    'delivered',
    'failed'
  )),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  last_error_code text,
  telegram_message_id bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index customer_delivery_jobs_due_idx
  on customer_delivery_jobs (next_attempt_at, id)
  where stage in ('pending_brand_media', 'pending_link');

-- Backfill every fulfilled order with exactly one durable delivery job. This is a
-- pure local insert: it never calls create, renew, top-up or any provider mutation.
insert into customer_delivery_jobs(order_id, customer_id, service_id)
select orders.id, orders.customer_id, orders.service_id
from sales_orders orders
where orders.status = 'fulfilled'
  and orders.service_id is not null
on conflict (order_id) do nothing;
