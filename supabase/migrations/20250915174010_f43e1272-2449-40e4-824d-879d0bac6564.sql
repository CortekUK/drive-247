-- Add warranty fields to vehicles table
ALTER TABLE vehicles 
ADD COLUMN warranty_start_date date,
ADD COLUMN warranty_end_date date;

-- Add warranty reminder rules
INSERT INTO reminder_rules (rule_code, rule_type, category, description, lead_days, severity, is_enabled, is_recurring, interval_type) VALUES
('WARRANTY_0D', 'WARRANTY', 'Vehicle', 'Warranty due today', 0, 'critical', true, false, 'once'),
('WARRANTY_7D', 'WARRANTY', 'Vehicle', 'Warranty due in 7 days', 7, 'warning', true, false, 'once'),
('WARRANTY_14D', 'WARRANTY', 'Vehicle', 'Warranty due in 14 days', 14, 'warning', true, false, 'once'),
('WARRANTY_30D', 'WARRANTY', 'Vehicle', 'Warranty due in 30 days', 30, 'info', true, false, 'once');