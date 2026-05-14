ALTER TABLE public.buyer_pass_users ADD COLUMN IF NOT EXISTS renewal_reminder_sent boolean NOT NULL DEFAULT false;

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove any prior schedule with same name
DO $$
BEGIN
  PERFORM cron.unschedule('check-expiry-reminders');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'check-expiry-reminders',
  '0 9 * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--e239acee-68b4-47c9-912e-3378d99dae28.lovable.app/api/public/cron/check-expiry-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNkZ2hlcGdqbGlwa3dyYmhlbnRwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2MjY0NzIsImV4cCI6MjA5NDIwMjQ3Mn0.Jbah-_1yqjIV2fwNAzOn9-sZBL-8plOBKJnzgdEKFmU'
    ),
    body := '{}'::jsonb
  );
  $$
);