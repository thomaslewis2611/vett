CREATE TABLE public.shared_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  analysis_data jsonb NOT NULL,
  property_address text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.shared_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read shared reports" ON public.shared_reports
  FOR SELECT USING (true);

CREATE POLICY "Anyone can insert shared reports" ON public.shared_reports
  FOR INSERT WITH CHECK (true);