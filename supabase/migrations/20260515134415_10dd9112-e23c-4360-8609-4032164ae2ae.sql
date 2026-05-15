ALTER TABLE public.saved_analyses RENAME COLUMN pinned TO is_pinned;
ALTER TABLE public.saved_analyses ADD COLUMN pinned_at timestamptz;
UPDATE public.saved_analyses SET pinned_at = created_at WHERE is_pinned = true;