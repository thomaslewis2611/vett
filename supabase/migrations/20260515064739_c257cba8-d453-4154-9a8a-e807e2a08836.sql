CREATE TABLE IF NOT EXISTS public.property_data_cache (
  postcode text PRIMARY KEY,
  data jsonb NOT NULL,
  fetched_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.property_data_cache ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_property_data_cache_fetched_at
  ON public.property_data_cache (fetched_at);