-- Migration: Backfill blocked_identities with emails from blocked customers
-- This ensures all blocked customers have their email in the blocklist

-- Add emails from blocked customers who don't have any identity in blocked_identities
INSERT INTO blocked_identities (identity_type, identity_number, reason, notes, is_active)
SELECT
  'email',
  c.email,
  COALESCE(c.blocked_reason, 'Blocked customer'),
  'Backfilled from blocked customer: ' || c.name,
  true
FROM customers c
WHERE c.is_blocked = true
  AND c.email IS NOT NULL
  AND c.email != ''
  AND NOT EXISTS (
    -- Only add if no identity exists for this customer
    SELECT 1 FROM blocked_identities bi
    WHERE bi.is_active = true
    AND (
      bi.identity_number = c.email
      OR bi.identity_number = c.license_number
      OR bi.identity_number = c.id_number
    )
  )
ON CONFLICT DO NOTHING;
