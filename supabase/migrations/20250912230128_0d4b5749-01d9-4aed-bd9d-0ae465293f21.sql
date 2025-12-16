-- Create reminder_events table for in-app reminder tracking
CREATE TABLE public.reminder_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  charge_id UUID NOT NULL REFERENCES public.ledger_entries(id),
  customer_id UUID NOT NULL REFERENCES public.customers(id),
  rental_id UUID NOT NULL REFERENCES public.rentals(id),
  vehicle_id UUID NOT NULL REFERENCES public.vehicles(id),
  reminder_type TEXT NOT NULL CHECK (reminder_type IN ('Upcoming', 'Due', 'Overdue1', 'Overdue2', 'Overdue3', 'Overdue4', 'Overdue5')),
  status TEXT NOT NULL DEFAULT 'Queued' CHECK (status IN ('Queued', 'Delivered', 'Snoozed', 'Dismissed', 'Done')),
  message_preview TEXT NOT NULL,
  delivered_to TEXT NOT NULL DEFAULT 'in_app',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  delivered_at TIMESTAMP WITH TIME ZONE,
  snoozed_until TIMESTAMP WITH TIME ZONE,
  UNIQUE(charge_id, reminder_type)
);

-- Enable RLS
ALTER TABLE public.reminder_events ENABLE ROW LEVEL SECURITY;

-- Create policy for authenticated users
CREATE POLICY "Allow all operations for authenticated users" 
ON public.reminder_events 
FOR ALL 
USING (true);

-- Add new settings to reminder_settings
INSERT INTO public.reminder_settings (setting_key, setting_value) VALUES 
('delivery_mode', '"in_app_only"'::jsonb),
('timezone', '"Europe/London"'::jsonb),
('respect_credit_coverage', 'true'::jsonb),
('send_time', '"09:00"'::jsonb),
('upcoming_enabled', 'true'::jsonb),
('due_enabled', 'true'::jsonb),
('overdue_enabled', 'true'::jsonb),
('max_overdue_reminders', '4'::jsonb)
ON CONFLICT (setting_key) DO UPDATE SET 
setting_value = EXCLUDED.setting_value,
updated_at = now();

-- Create index for performance
CREATE INDEX idx_reminder_events_status ON public.reminder_events(status);
CREATE INDEX idx_reminder_events_customer ON public.reminder_events(customer_id);
CREATE INDEX idx_reminder_events_due_type ON public.reminder_events(reminder_type, created_at);