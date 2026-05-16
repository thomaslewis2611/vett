-- Drop duplicates first (keep oldest), then add unique constraint
DELETE FROM public.single_report_tokens a
USING public.single_report_tokens b
WHERE a.stripe_session_id IS NOT NULL
  AND a.stripe_session_id = b.stripe_session_id
  AND a.created_at > b.created_at;

ALTER TABLE public.single_report_tokens
  ADD CONSTRAINT unique_stripe_session UNIQUE (stripe_session_id);