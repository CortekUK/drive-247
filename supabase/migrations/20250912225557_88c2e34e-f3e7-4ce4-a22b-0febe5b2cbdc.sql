-- Create reminder_logs table to track sent reminders
CREATE TABLE public.reminder_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  charge_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  rental_id uuid NOT NULL,
  reminder_type text NOT NULL, -- 'upcoming', 'due', 'overdue_1d', 'overdue_1w', 'overdue_2w', 'overdue_3w', 'overdue_4w'
  channel text NOT NULL, -- 'email', 'whatsapp'
  sent_at timestamp with time zone NOT NULL DEFAULT now(),
  amount numeric NOT NULL,
  due_date date NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Create reminder_settings table for configuration
CREATE TABLE public.reminder_settings (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  setting_key text NOT NULL UNIQUE,
  setting_value jsonb NOT NULL,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.reminder_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reminder_settings ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Allow all operations for authenticated users" 
ON public.reminder_logs 
FOR ALL 
USING (true);

CREATE POLICY "Allow all operations for authenticated users" 
ON public.reminder_settings 
FOR ALL 
USING (true);

-- Insert default reminder settings
INSERT INTO public.reminder_settings (setting_key, setting_value) VALUES
('timing_config', '{
  "upcoming_hours": 48,
  "overdue_intervals": [1, 7, 14, 21, 28]
}'::jsonb),
('channel_config', '{
  "email_enabled": true,
  "whatsapp_enabled": true,
  "default_from_email": "reminders@fleet.com"
}'::jsonb),
('template_config', '{
  "email_templates": {
    "upcoming": "Payment of £{amount} is due in 48 hours for {vehicle_reg}",
    "due": "Payment of £{amount} is due today for {vehicle_reg}",
    "overdue": "Payment of £{amount} is now {days_overdue} days overdue for {vehicle_reg}"
  },
  "whatsapp_templates": {
    "upcoming": "Hi {customer_name}, your payment of £{amount} for {vehicle_reg} is due in 48 hours",
    "due": "Hi {customer_name}, your payment of £{amount} for {vehicle_reg} is due today",
    "overdue": "Hi {customer_name}, your payment of £{amount} for {vehicle_reg} is now {days_overdue} days overdue"
  }
}'::jsonb);

-- Create function to get pending charges for reminders
CREATE OR REPLACE FUNCTION public.get_pending_charges_for_reminders()
RETURNS TABLE (
  charge_id uuid,
  customer_id uuid,
  customer_name text,
  customer_email text,
  customer_phone text,
  whatsapp_opt_in boolean,
  rental_id uuid,
  vehicle_id uuid,
  vehicle_reg text,
  due_date date,
  amount numeric,
  remaining_amount numeric,
  customer_balance numeric,
  days_until_due integer,
  days_overdue integer
) 
LANGUAGE sql
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT 
    le.id as charge_id,
    le.customer_id,
    c.name as customer_name,
    c.email as customer_email,
    c.phone as customer_phone,
    c.whatsapp_opt_in,
    le.rental_id,
    le.vehicle_id,
    v.reg as vehicle_reg,
    le.due_date,
    le.amount,
    le.remaining_amount,
    -- Calculate customer balance (total credits - total charges)
    COALESCE((
      SELECT SUM(CASE WHEN type = 'Payment' THEN amount ELSE -amount END)
      FROM ledger_entries le2
      WHERE le2.customer_id = le.customer_id
    ), 0) as customer_balance,
    (le.due_date - CURRENT_DATE)::integer as days_until_due,
    (CURRENT_DATE - le.due_date)::integer as days_overdue
  FROM ledger_entries le
  JOIN customers c ON c.id = le.customer_id
  JOIN vehicles v ON v.id = le.vehicle_id
  WHERE le.type = 'Charge' 
    AND le.remaining_amount > 0
    AND le.due_date IS NOT NULL;
$$;