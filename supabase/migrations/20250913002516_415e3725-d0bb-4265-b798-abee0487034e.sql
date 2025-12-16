-- Enable pg_cron extension for scheduled tasks
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule daily reminder generation at 09:00 Europe/London
-- This runs every day at 9 AM London time
SELECT cron.schedule(
  'daily-reminders-job',
  '0 9 * * *', -- Daily at 9:00 AM
  $$
  SELECT
    net.http_post(
        url:='https://hviqoaokxvlancmftwuo.supabase.co/functions/v1/daily-reminders',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indyb2dldmpwdmh2cHV0cmpodnZnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc3MTUxNDYsImV4cCI6MjA3MzI5MTE0Nn0.gORhHgYY3GpcOiiGfI-K8PrtQscttZgMVvH_Fv_wUII"}'::jsonb,
        body:='{}'::jsonb
    ) as request_id;
  $$
);