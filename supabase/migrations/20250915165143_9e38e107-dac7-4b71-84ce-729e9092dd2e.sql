-- Add immobilizer reminder rules to the reminder_rules table
INSERT INTO reminder_rules (rule_code, rule_type, category, description, lead_days, severity, is_enabled, is_recurring, interval_type) VALUES
('IMM_FIT_0D', 'Immobilizer', 'Vehicle', 'Immediate reminder to fit immobilizer', 0, 'critical', true, false, 'once'),
('IMM_FIT_7D', 'Immobilizer', 'Vehicle', '7 days after acquisition reminder', 7, 'warning', true, false, 'once'),
('IMM_FIT_14D', 'Immobilizer', 'Vehicle', '14 days after acquisition reminder', 14, 'warning', true, false, 'once'),
('IMM_FIT_30D', 'Immobilizer', 'Vehicle', '30 days after acquisition reminder', 30, 'info', true, false, 'once');