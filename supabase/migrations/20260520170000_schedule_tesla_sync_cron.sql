-- Schedule the hourly Tesla Supercharger sync.
--
-- Runs at :17 past every hour (off-the-hour to avoid thundering-herd with the
-- many other jobs scheduled at :00). The sync-tesla-charges-cron edge function
-- loops over every tenant with integration_tesla_fleet = true and runs the same
-- per-tenant engine the portal's Refresh button uses.

SELECT cron.schedule(
  'sync-tesla-charges-hourly',
  '17 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://hviqoaokxvlancmftwuo.supabase.co/functions/v1/sync-tesla-charges-cron',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh2aXFvYW9reHZsYW5jbWZ0d3VvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MjM2MzY1NywiZXhwIjoyMDc3OTM5NjU3fQ.YXJZhab8SdxNJKmGVDMn_XlzcpFirN7mEYbupA9KJqw"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
