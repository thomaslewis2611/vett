
ALTER TABLE public.single_report_tokens
ADD COLUMN IF NOT EXISTS user_email text;

CREATE INDEX IF NOT EXISTS single_report_tokens_user_email_idx
ON public.single_report_tokens (lower(user_email));

ALTER TABLE public.single_report_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Single report owners can view their tokens" ON public.single_report_tokens;
CREATE POLICY "Single report owners can view their tokens"
ON public.single_report_tokens
FOR SELECT
TO authenticated
USING (lower(user_email) = lower((auth.jwt() ->> 'email'::text)));
