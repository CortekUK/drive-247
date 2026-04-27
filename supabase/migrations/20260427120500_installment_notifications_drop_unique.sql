-- Drop the unique (installment_id, notification_type) constraint. The redesigned
-- system records multiple events of the same type over a plan's lifetime
-- (e.g. several reminder_sent or auto_charge_failed entries forming a timeline).

ALTER TABLE public.installment_notifications
  DROP CONSTRAINT IF EXISTS unique_notification;
