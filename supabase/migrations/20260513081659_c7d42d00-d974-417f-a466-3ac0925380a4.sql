
-- single_report_tokens
CREATE TABLE public.single_report_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text UNIQUE NOT NULL,
  listing_url text,
  stripe_session_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '90 days')
);
ALTER TABLE public.single_report_tokens ENABLE ROW LEVEL SECURITY;
-- No public policies; access is through security-definer function only.

CREATE OR REPLACE FUNCTION public.get_single_report_token(_token text)
RETURNS TABLE (token text, listing_url text, stripe_session_id text, expires_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.token, t.listing_url, t.stripe_session_id, t.expires_at
  FROM public.single_report_tokens t
  WHERE t.token = _token AND t.expires_at > now()
  LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.get_single_report_token(text) TO anon, authenticated;

-- buyer_pass_users
CREATE TABLE public.buyer_pass_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  stripe_session_id text,
  stripe_customer_id text,
  activated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.buyer_pass_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Buyer Pass users can view their own row"
ON public.buyer_pass_users
FOR SELECT
TO authenticated
USING (lower(email) = lower((auth.jwt() ->> 'email')));

-- Allow anon to check by email for "restore access" via security-definer function
CREATE OR REPLACE FUNCTION public.buyer_pass_email_exists(_email text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.buyer_pass_users WHERE lower(email) = lower(_email));
$$;
GRANT EXECUTE ON FUNCTION public.buyer_pass_email_exists(text) TO anon, authenticated;

-- saved_analyses
CREATE TABLE public.saved_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email text NOT NULL,
  listing_url text,
  analysis_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.saved_analyses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own saved analyses"
ON public.saved_analyses
FOR SELECT
TO authenticated
USING (lower(user_email) = lower((auth.jwt() ->> 'email')));

CREATE POLICY "Users can insert their own saved analyses"
ON public.saved_analyses
FOR INSERT
TO authenticated
WITH CHECK (lower(user_email) = lower((auth.jwt() ->> 'email')));

CREATE INDEX idx_saved_analyses_user ON public.saved_analyses (user_email, created_at DESC);
CREATE INDEX idx_single_report_tokens_token ON public.single_report_tokens (token);
