CREATE TABLE IF NOT EXISTS public.analysis_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  url text NOT NULL,
  pasted_text text,
  access_token text,
  session_jwt text,
  status text NOT NULL DEFAULT 'pending',
  result_json jsonb,
  error text,
  user_email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_analysis_jobs_created_at ON public.analysis_jobs (created_at DESC);

ALTER TABLE public.analysis_jobs ENABLE ROW LEVEL SECURITY;

-- Anyone holding the job id (a UUID) can read it. Writes go through the
-- service role only (server-side admin client), so no INSERT/UPDATE policies
-- are exposed to clients.
CREATE POLICY "Anyone can read analysis jobs by id"
  ON public.analysis_jobs
  FOR SELECT
  TO anon, authenticated
  USING (true);
