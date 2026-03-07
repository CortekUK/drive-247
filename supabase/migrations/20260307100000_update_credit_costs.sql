-- Update credit costs to correct values
UPDATE credit_costs SET cost_credits = 7.0, label = 'E-Sign Agreement' WHERE category = 'esign';
UPDATE credit_costs SET cost_credits = 2.0 WHERE category = 'sms';
UPDATE credit_costs SET cost_credits = 31.0, label = 'License Verification' WHERE category = 'verification';

-- Remove OCR cost (not used)
DELETE FROM credit_costs WHERE category = 'ocr';
