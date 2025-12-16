-- Create reminder_events table for in-app notifications
CREATE TABLE IF NOT EXISTS public.reminder_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  charge_id UUID NOT NULL,
  customer_id UUID NOT NULL,
  rental_id UUID,
  vehicle_id UUID NOT NULL,
  reminder_type TEXT NOT NULL CHECK (reminder_type IN ('Upcoming', 'Due', 'Overdue1', 'OverdueN')),
  status TEXT NOT NULL DEFAULT 'Queued' CHECK (status IN ('Queued', 'Delivered', 'Done', 'Snoozed', 'Dismissed')),
  message_preview TEXT NOT NULL,
  delivered_to TEXT NOT NULL DEFAULT 'in_app',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  delivered_at TIMESTAMP WITH TIME ZONE,
  snoozed_until TIMESTAMP WITH TIME ZONE,
  UNIQUE(charge_id, reminder_type)
);

-- Enable RLS
ALTER TABLE public.reminder_events ENABLE ROW LEVEL SECURITY;

-- Create RLS policy
CREATE POLICY "Allow all operations for authenticated users" 
ON public.reminder_events 
FOR ALL 
USING (true);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_reminder_events_status ON public.reminder_events(status);
CREATE INDEX IF NOT EXISTS idx_reminder_events_customer ON public.reminder_events(customer_id);
CREATE INDEX IF NOT EXISTS idx_reminder_events_charge ON public.reminder_events(charge_id);
CREATE INDEX IF NOT EXISTS idx_reminder_events_created_at ON public.reminder_events(created_at);
CREATE INDEX IF NOT EXISTS idx_reminder_events_snoozed_until ON public.reminder_events(snoozed_until);

-- Function to generate reminders for unpaid charges
CREATE OR REPLACE FUNCTION public.generate_daily_reminders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  charge_rec RECORD;
  customer_credit NUMERIC;
  message_text TEXT;
  reminder_type TEXT;
  due_date_diff INTEGER;
BEGIN
  -- Get all unpaid charges with remaining amounts
  FOR charge_rec IN
    SELECT 
      le.id as charge_id,
      le.customer_id,
      le.rental_id,
      le.vehicle_id,
      le.due_date,
      le.remaining_amount,
      le.category,
      c.name as customer_name,
      v.reg as vehicle_reg,
      (le.due_date - CURRENT_DATE)::integer as days_until_due
    FROM ledger_entries le
    JOIN customers c ON c.id = le.customer_id
    JOIN vehicles v ON v.id = le.vehicle_id
    WHERE le.type = 'Charge' 
      AND le.remaining_amount > 0
      AND le.due_date IS NOT NULL
      AND le.due_date >= CURRENT_DATE - INTERVAL '28 days' -- Don't process very old charges
  LOOP
    -- Calculate customer available credit
    SELECT COALESCE(
      -1 * SUM(CASE WHEN type = 'Payment' THEN amount ELSE -amount END), 0
    ) INTO customer_credit
    FROM ledger_entries 
    WHERE customer_id = charge_rec.customer_id 
      AND remaining_amount = 0; -- Only fully applied credits
    
    -- Skip if customer has enough credit to cover this charge
    IF customer_credit >= charge_rec.remaining_amount THEN
      CONTINUE;
    END IF;
    
    due_date_diff := charge_rec.days_until_due;
    
    -- Determine reminder type and generate message
    IF due_date_diff = 2 THEN
      reminder_type := 'Upcoming';
      message_text := 'Payment due in 2 days: £' || charge_rec.remaining_amount || ' for ' || charge_rec.vehicle_reg;
    ELSIF due_date_diff = 0 THEN
      reminder_type := 'Due';
      message_text := 'Payment due today: £' || charge_rec.remaining_amount || ' for ' || charge_rec.vehicle_reg;
    ELSIF due_date_diff = -1 THEN
      reminder_type := 'Overdue1';
      message_text := 'Payment overdue by 1 day: £' || charge_rec.remaining_amount || ' for ' || charge_rec.vehicle_reg;
    ELSIF due_date_diff IN (-7, -14, -21, -28) THEN
      reminder_type := 'OverdueN';
      message_text := 'Payment overdue by ' || ABS(due_date_diff) || ' days: £' || charge_rec.remaining_amount || ' for ' || charge_rec.vehicle_reg;
    ELSE
      CONTINUE; -- Skip dates that don't match our reminder schedule
    END IF;
    
    -- Insert reminder (idempotent - will skip if already exists)
    INSERT INTO reminder_events (
      charge_id,
      customer_id,
      rental_id,
      vehicle_id,
      reminder_type,
      message_preview,
      status
    ) VALUES (
      charge_rec.charge_id,
      charge_rec.customer_id,
      charge_rec.rental_id,
      charge_rec.vehicle_id,
      reminder_type,
      message_text,
      'Queued'
    ) ON CONFLICT (charge_id, reminder_type) DO NOTHING;
    
  END LOOP;
  
  -- Mark all queued reminders as delivered
  UPDATE reminder_events 
  SET status = 'Delivered', delivered_at = now()
  WHERE status = 'Queued';
  
END;
$$;