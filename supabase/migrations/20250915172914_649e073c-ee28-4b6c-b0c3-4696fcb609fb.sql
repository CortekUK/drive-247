-- Clear all existing MOT and TAX reminders to remove duplicates
DELETE FROM reminders WHERE rule_code LIKE 'MOT_%' OR rule_code LIKE 'TAX_%';

-- Also clear any immobiliser reminders to start fresh
DELETE FROM reminders WHERE rule_code LIKE 'IMM_%';