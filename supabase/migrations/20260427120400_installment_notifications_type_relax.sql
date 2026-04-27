-- Relax notification_type to allow the new event types used by the redesigned
-- installment system (plan_created, payment_settled, auto_charge_*, reminder_sent,
-- manual_payment_recorded). Keeps legacy values valid.

ALTER TABLE public.installment_notifications
  DROP CONSTRAINT IF EXISTS installment_notifications_notification_type_check;

ALTER TABLE public.installment_notifications
  ADD CONSTRAINT installment_notifications_notification_type_check
  CHECK (notification_type = ANY (ARRAY[
    'reminder_3_days', 'due_today', 'payment_success', 'payment_failed', 'overdue',
    'plan_created', 'payment_settled',
    'auto_charge_succeeded', 'auto_charge_failed', 'auto_skipped_no_card',
    'reminder_sent', 'manual_payment_recorded',
    'plan_paused', 'plan_resumed', 'plan_cancelled'
  ]::text[]));
