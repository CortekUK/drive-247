-- Add fields to support recurring insurance verification reminders
ALTER TABLE public.reminder_rules 
ADD COLUMN is_recurring boolean DEFAULT false,
ADD COLUMN interval_type text DEFAULT 'once';

-- Insert new Insurance Verification reminder rules
INSERT INTO public.reminder_rules (category, rule_type, rule_code, description, lead_days, severity, is_enabled, is_recurring, interval_type) VALUES
('Insurance', 'Verification', 'INS_VERIFY_7D', 'Verify insurance policy is still active', 7, 'info', true, true, 'weekly'),
('Insurance', 'Verification', 'INS_VERIFY_14D', 'Verify insurance policy is still active', 14, 'warning', true, true, 'bi-weekly'), 
('Insurance', 'Verification', 'INS_VERIFY_30D', 'Verify insurance policy is still active', 30, 'warning', true, true, 'monthly');

-- Update existing insurance expiry rules to be non-recurring
UPDATE public.reminder_rules 
SET is_recurring = false, interval_type = 'once'
WHERE category = 'Insurance' AND rule_type = 'Expiry';