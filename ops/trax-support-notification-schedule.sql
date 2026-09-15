-- Reviewed deployment preparation only; do not execute against production
-- without environment approval. No credentials or tenant records in this file.
-- Prerequisites: pg_cron, pg_net, Vault; deployed trax-support-notifications.
-- An authorized operator configures Vault entries through the secret manager:
--   trax_support_worker_url: full /functions/v1/trax-support-notifications URL
--   trax_support_worker_secret: same dedicated secret as the worker environment
-- Resend/recipient/origin remain server environment settings, never job SQL.
-- This schedules notification delivery ONLY; it does not enable data cleanup.
do $$
begin
  if not exists(select 1 from vault.decrypted_secrets where name='trax_support_worker_url')
    or not exists(select 1 from vault.decrypted_secrets where name='trax_support_worker_secret') then
    raise exception 'Configure the dedicated TRAX worker Vault entries first';
  end if;
  if exists(select 1 from cron.job where jobname='trax-support-notifications') then perform cron.unschedule('trax-support-notifications');end if;
  perform cron.schedule('trax-support-notifications','* * * * *',$job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name='trax_support_worker_url' limit 1),
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||
        (select decrypted_secret from vault.decrypted_secrets where name='trax_support_worker_secret' limit 1)),
      body := '{}'::jsonb,
      timeout_milliseconds := 90000
    );
  $job$);
end $$;
