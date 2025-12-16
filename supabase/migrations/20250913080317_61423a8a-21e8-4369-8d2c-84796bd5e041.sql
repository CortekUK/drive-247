-- Set up cron job to run daily reminders at 09:00 Europe/London
-- Enable pg_cron extension first
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule the daily reminders job to run at 09:00 Europe/London (08:00 UTC in winter, 09:00 UTC in summer)
-- Using 08:00 UTC to handle the timezone difference
SELECT cron.schedule(
  'daily-reminders-job',
  '0 8 * * *', -- 08:00 UTC daily (09:00 Europe/London in winter, adjust for DST)
  $$
  SELECT
    net.http_post(
        url:='https://hviqoaokxvlancmftwuo.supabase.co/functions/v1/daily-reminders',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indyb2dldmpwdmh2cHV0cmpodnZnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc3MTUxNDYsImV4cCI6MjA3MzI5MTE0Nn0.gORhHgYY3GpcOiiGfI-K8PrtQscttZgMVvH_Fv_wUII"}'::jsonb,
        body:='{"trigger": "cron"}'::jsonb
    ) as request_id;
  $$
);

-- Enable pg_net extension for HTTP requests
CREATE EXTENSION IF NOT EXISTS pg_net;