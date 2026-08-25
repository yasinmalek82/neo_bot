alter table sales_orders
  add column order_kind text not null default 'purchase' check (
    order_kind in ('purchase', 'renewal')
  ),
  add column target_service_id bigint references services(id) on delete restrict;

alter table sales_orders
  add constraint sales_orders_renewal_target_service_chk
  check (order_kind <> 'renewal' or target_service_id is not null);

create index sales_orders_target_service_id_idx
  on sales_orders (target_service_id)
  where target_service_id is not null;

create index sales_orders_customer_renewal_idx
  on sales_orders (customer_id, created_at desc, id desc)
  where order_kind = 'renewal';

alter table provisioning_operations
  add column candidate_username text,
  add column attempt_count integer not null default 0 check (attempt_count >= 0),
  add column reconciliation_state text not null default 'not_required' check (
    reconciliation_state in (
      'not_required',
      'candidate_persisted',
      'attempting',
      'reconciliation_required',
      'reconciled'
    )
  ),
  add column requested_expires_at timestamptz,
  add column requested_data_limit_bytes bigint check (requested_data_limit_bytes >= 0),
  add column requested_status text check (
    requested_status is null
    or requested_status in ('active', 'disabled', 'expired', 'limited', 'on_hold')
  );

alter table provisioning_operations
  add constraint provisioning_operations_create_candidate_chk
  check (
    candidate_username is null
    or (
      operation_type = 'create'
      and char_length(candidate_username) between 1 and 128
    )
  ),
  add constraint provisioning_operations_mutation_request_chk
  check (
    (requested_expires_at is null and requested_data_limit_bytes is null and requested_status is null)
    or (requested_expires_at is not null and requested_data_limit_bytes is not null and requested_status is not null)
  );

update provisioning_operations
set reconciliation_state = 'reconciliation_required'
where status = 'pending';

create index provisioning_operations_candidate_recovery_idx
  on provisioning_operations (candidate_username, updated_at)
  where status = 'pending' and candidate_username is not null;

create index provisioning_operations_reconciliation_required_idx
  on provisioning_operations (updated_at, id)
  where status = 'pending' and reconciliation_state = 'reconciliation_required';
