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
    'ops.daily_summary'
  )
);
