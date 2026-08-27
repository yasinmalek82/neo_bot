alter table customer_delivery_jobs
  add column claim_version bigint not null default 0 check (claim_version >= 0);
