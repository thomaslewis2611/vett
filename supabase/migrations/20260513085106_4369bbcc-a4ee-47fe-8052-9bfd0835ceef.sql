CREATE TABLE IF NOT EXISTS public.listing_cache (
  url text PRIMARY KEY,
  text_content text,
  image_url text,
  fetched_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.listing_cache ENABLE ROW LEVEL SECURITY;
-- No policies: only the service-role server (supabaseAdmin) reads/writes this cache.
CREATE INDEX IF NOT EXISTS listing_cache_fetched_at_idx ON public.listing_cache (fetched_at DESC);