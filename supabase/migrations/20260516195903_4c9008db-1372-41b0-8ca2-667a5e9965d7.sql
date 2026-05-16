ALTER TABLE public.single_report_tokens ALTER COLUMN expires_at SET DEFAULT (now() + interval '365 days');

UPDATE public.single_report_tokens
SET expires_at = created_at + interval '365 days'
WHERE expires_at > now()
  AND expires_at < created_at + interval '91 days';