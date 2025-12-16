-- Create reminder_rules table for configurable reminder timing
CREATE TABLE public.reminder_rules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  rule_type TEXT NOT NULL, -- 'MOT', 'TAX', 'Insurance', 'Fine', 'Document'
  category TEXT NOT NULL, -- 'Vehicle', 'Insurance', 'Financial', 'Document'
  lead_days INTEGER NOT NULL, -- Number of days before due date
  severity TEXT NOT NULL DEFAULT 'info', -- 'info', 'warning', 'critical'
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  rule_code TEXT NOT NULL, -- e.g., 'MOT_30D', 'TAX_14D', 'INS_7D'
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(rule_type, lead_days)
);

-- Enable RLS
ALTER TABLE public.reminder_rules ENABLE ROW LEVEL SECURITY;

-- Create policy for app users
CREATE POLICY "Allow all operations for app users on reminder_rules"
ON public.reminder_rules
FOR ALL
USING (true)
WITH CHECK (true);

-- Add updated_at trigger
CREATE TRIGGER update_reminder_rules_updated_at
  BEFORE UPDATE ON public.reminder_rules
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Insert default rules matching current hard-coded values
INSERT INTO public.reminder_rules (rule_type, category, lead_days, severity, rule_code, description) VALUES
-- MOT reminders
('MOT', 'Vehicle', 30, 'info', 'MOT_30D', 'MOT due in 30 days'),
('MOT', 'Vehicle', 14, 'warning', 'MOT_14D', 'MOT due in 14 days'),
('MOT', 'Vehicle', 7, 'warning', 'MOT_7D', 'MOT due in 7 days'),
('MOT', 'Vehicle', 0, 'critical', 'MOT_0D', 'MOT due today'),

-- TAX reminders
('TAX', 'Vehicle', 30, 'info', 'TAX_30D', 'Tax due in 30 days'),
('TAX', 'Vehicle', 14, 'warning', 'TAX_14D', 'Tax due in 14 days'),
('TAX', 'Vehicle', 7, 'warning', 'TAX_7D', 'Tax due in 7 days'),
('TAX', 'Vehicle', 0, 'critical', 'TAX_0D', 'Tax due today'),

-- Insurance reminders
('Insurance', 'Insurance', 30, 'info', 'INS_30D', 'Insurance expires in 30 days'),
('Insurance', 'Insurance', 14, 'warning', 'INS_14D', 'Insurance expires in 14 days'),
('Insurance', 'Insurance', 7, 'warning', 'INS_7D', 'Insurance expires in 7 days'),
('Insurance', 'Insurance', 0, 'critical', 'INS_0D', 'Insurance expires today'),

-- Fine reminders
('Fine', 'Financial', 14, 'warning', 'FINE_14D', 'Fine due in 14 days'),
('Fine', 'Financial', 7, 'warning', 'FINE_7D', 'Fine due in 7 days'),
('Fine', 'Financial', 0, 'critical', 'FINE_0D', 'Fine due today'),

-- Document reminders
('Document', 'Document', 30, 'info', 'DOC_30D', 'Document expires in 30 days'),
('Document', 'Document', 14, 'warning', 'DOC_14D', 'Document expires in 14 days'),
('Document', 'Document', 7, 'warning', 'DOC_7D', 'Document expires in 7 days'),
('Document', 'Document', 0, 'critical', 'DOC_0D', 'Document expires today'),

-- Rental overdue reminders
('Rental', 'Financial', 1, 'warning', 'RENT_1D', 'Rental payment 1 day overdue'),
('Rental', 'Financial', 7, 'warning', 'RENT_7D', 'Rental payment 7 days overdue'),
('Rental', 'Financial', 14, 'critical', 'RENT_14D', 'Rental payment 14 days overdue');