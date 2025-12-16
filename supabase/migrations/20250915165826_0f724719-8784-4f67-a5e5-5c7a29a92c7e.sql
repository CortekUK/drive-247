-- Update existing immobilizer records to use UK spelling
UPDATE reminder_rules 
SET 
  rule_type = 'Immobiliser',
  description = REPLACE(description, 'immobilizer', 'immobiliser')
WHERE rule_type = 'Immobilizer';

-- Update any rule codes or other text fields that might contain the American spelling
UPDATE reminder_rules 
SET description = REPLACE(description, 'Immobilizer', 'Immobiliser')
WHERE description ILIKE '%Immobilizer%';