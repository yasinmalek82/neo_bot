alter table sales_orders
  add column service_username_base text;

alter table sales_orders
  add constraint sales_orders_service_username_base_format_chk
  check (
    service_username_base is null
    or (
      service_username_base ~ '^[a-z0-9_-]+$'
      and length(service_username_base) between 1 and 59
    )
  );
