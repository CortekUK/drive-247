-- Clear existing verification reminders to start fresh
DELETE FROM reminders WHERE rule_code IN ('INS_VERIFY_7D', 'INS_VERIFY_14D', 'INS_VERIFY_30D');

-- Disable the 14D and 30D verification rules to prevent duplication  
-- We'll keep only the 7D rule active
UPDATE reminder_rules 
SET is_enabled = false 
WHERE rule_code IN ('INS_VERIFY_14D', 'INS_VERIFY_30D');