SELECT cron.unschedule('looksmax-hourly-push');

SELECT cron.schedule(
  'looksmax-hourly-push',
  '0 * * * *',
  $$
  select net.http_post(
    url := 'https://wrdgeckiwoauryxrrpes.supabase.co/functions/v1/send-hourly-push'::text,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndyZGdlY2tpd29hdXJ5eHJycGVzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwODkwODEsImV4cCI6MjA5MjY2NTA4MX0.ZAAbsVNfgIYZREOv0cy86F7FBAQr50enrRKQnS4f_W4',
      'x-internal-trigger', 'looksmax-cron-2026'
    ),
    body := jsonb_build_object('triggered_at', now())
  );
  $$
);