CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION public.cleanup_property_data_cache()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.property_data_cache
  WHERE fetched_at < now() - interval '48 hours';
$$;

CREATE OR REPLACE FUNCTION public.cleanup_old_analysis_jobs()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.analysis_jobs
  WHERE status IN ('complete', 'error')
    AND updated_at < now() - interval '7 days';
$$;

-- Unschedule any prior versions to keep the migration idempotent
DO $$
BEGIN
  PERFORM cron.unschedule('cleanup-pd-cache');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.unschedule('cleanup-analysis-jobs');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'cleanup-pd-cache',
  '0 3 * * *',
  'SELECT public.cleanup_property_data_cache();'
);

SELECT cron.schedule(
  'cleanup-analysis-jobs',
  '15 3 * * *',
  'SELECT public.cleanup_old_analysis_jobs();'
);