-- Private storage buckets. Paths: <workspace_id>/<agent_id>/<file>
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
('documents', 'documents', false, 10485760, array['application/pdf','image/jpeg','image/png','image/webp','image/heic','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain']),
('catalog-media', 'catalog-media', false, 10485760, array['image/jpeg','image/png','image/webp']),
('voice-previews', 'voice-previews', false, 5242880, array['audio/wav','audio/webm','audio/ogg','audio/mpeg']),
('campaign-imports', 'campaign-imports', false, 10485760, null),
('inbound-media', 'inbound-media', false, 20971520, null),
('avatars', 'avatars', true, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

create policy "members read own workspace files" on storage.objects for select to authenticated
  using (bucket_id in ('documents','catalog-media','campaign-imports','inbound-media') and public.is_member(((storage.foldername(name))[1])::uuid));
create policy "members upload own workspace files" on storage.objects for insert to authenticated
  with check (bucket_id in ('documents','catalog-media','campaign-imports') and public.is_member(((storage.foldername(name))[1])::uuid));
create policy "members delete own workspace files" on storage.objects for delete to authenticated
  using (bucket_id in ('documents','catalog-media','campaign-imports') and public.is_member(((storage.foldername(name))[1])::uuid));
create policy "avatars own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- Members register uploaded documents (server fills text/digest).
create policy "members add documents" on public.documents for insert
  with check (public.is_member(public.agent_workspace(agent_id)) and status = 'uploaded');
create policy "members delete documents" on public.documents for delete using (public.is_member(public.agent_workspace(agent_id)));
grant insert (agent_id, storage_path, filename, mime, size_bytes) on public.documents to authenticated;
grant delete on public.documents to authenticated;
