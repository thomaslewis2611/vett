-- Create public storage bucket for cached property images
insert into storage.buckets (id, name, public)
values ('property-images', 'property-images', true)
on conflict (id) do nothing;

-- Public read policy (bucket already public, but explicit RLS for objects)
create policy "Public read property-images"
on storage.objects for select
using (bucket_id = 'property-images');
