ALTER TABLE public.saved_analyses ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT false;

CREATE POLICY "Users can update their own saved analyses"
ON public.saved_analyses
FOR UPDATE
TO authenticated
USING (lower(user_email) = lower((auth.jwt() ->> 'email'::text)))
WITH CHECK (lower(user_email) = lower((auth.jwt() ->> 'email'::text)));