ALTER TABLE public.buyer_pass_users ADD COLUMN IF NOT EXISTS expires_at timestamptz;
UPDATE public.buyer_pass_users SET expires_at = activated_at + INTERVAL '90 days' WHERE expires_at IS NULL;