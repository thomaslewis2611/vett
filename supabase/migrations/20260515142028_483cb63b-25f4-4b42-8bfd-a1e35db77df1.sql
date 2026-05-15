-- Add user_id to single_report_tokens so dashboard can match purchases
-- by auth user id when the email on the token (from Stripe customer_details)
-- differs from the email on the auth account.
ALTER TABLE public.single_report_tokens
  ADD COLUMN IF NOT EXISTS user_id uuid;

CREATE INDEX IF NOT EXISTS idx_single_report_tokens_user_id
  ON public.single_report_tokens (user_id);

CREATE INDEX IF NOT EXISTS idx_single_report_tokens_user_email_lower
  ON public.single_report_tokens (lower(user_email));

-- Allow the owning auth user to read their tokens by user_id as well.
DROP POLICY IF EXISTS "Single report owners can view by user_id"
  ON public.single_report_tokens;
CREATE POLICY "Single report owners can view by user_id"
  ON public.single_report_tokens
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Backfill user_id from auth.users by matching email (case-insensitive).
UPDATE public.single_report_tokens t
SET user_id = u.id
FROM auth.users u
WHERE t.user_id IS NULL
  AND t.user_email IS NOT NULL
  AND lower(u.email) = lower(t.user_email);