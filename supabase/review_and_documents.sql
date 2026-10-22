-- Mejora aditiva para que los registros de origen aparezcan en el inventario
-- como pendientes de validación y cada ficha pueda guardar actas privadas.
-- Aplicar una sola vez después de setup.sql y archive.sql.
begin;

alter table public.assets alter column location_id drop not null;
alter table public.assets add column if not exists review_due_date date;
alter table public.assets add column if not exists last_reviewed_at date;
alter table public.assets add column if not exists source_entry_id uuid references public.archive_entries(id);
alter table public.assets add column if not exists source_document_id uuid references public.archive_documents(id);
alter table public.assets add column if not exists source_data jsonb not null default '{}'::jsonb;
update public.assets set review_due_date = (current_date + interval '1 year')::date where review_due_date is null;
alter table public.assets alter column review_due_date set default ((current_date + interval '1 year')::date);
alter table public.assets alter column review_due_date set not null;

alter table public.assets drop constraint if exists assets_status_check;
alter table public.assets add constraint assets_status_check
  check (status in ('Por validar','Bueno','Regular','Deteriorado','No encontrado','Pendiente de baja'));
-- NULL values remain allowed, while each imported archive row can map to only one asset.
create unique index if not exists assets_source_entry_unique on public.assets(source_entry_id);
create index if not exists assets_review_due_idx on public.assets(review_due_date);

create table if not exists public.asset_documents (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id) on delete cascade,
  archive_document_id uuid references public.archive_documents(id),
  storage_path text,
  filename text not null check (length(trim(filename)) between 1 and 240),
  mime_type text not null check (length(mime_type) <= 160),
  byte_size bigint not null check (byte_size >= 0),
  preview_text text check (preview_text is null or length(preview_text) <= 200000),
  uploaded_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  constraint asset_documents_one_source check ((archive_document_id is not null) <> (storage_path is not null)),
  constraint asset_documents_path_unique unique(storage_path),
  constraint asset_documents_asset_archive_unique unique(asset_id,archive_document_id)
);
create index if not exists asset_documents_asset_idx on public.asset_documents(asset_id,created_at);
alter table public.asset_documents enable row level security;
revoke all on public.asset_documents from anon, authenticated;
grant select, insert on public.asset_documents to authenticated;
drop policy if exists asset_documents_admin_read on public.asset_documents;
drop policy if exists asset_documents_admin_insert on public.asset_documents;
create policy asset_documents_admin_read on public.asset_documents for select to authenticated
  using (exists (select 1 from public.members where user_id=(select auth.uid()) and role='admin'));
create policy asset_documents_admin_insert on public.asset_documents for insert to authenticated
  with check (uploaded_by=(select auth.uid()) and exists (select 1 from public.members where user_id=(select auth.uid()) and role='admin'));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('asset-actas','asset-actas',false,20971520,array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','image/jpeg','image/png'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists asset_actas_admin_read on storage.objects;
drop policy if exists asset_actas_admin_insert on storage.objects;
create policy asset_actas_admin_read on storage.objects for select to authenticated
  using (bucket_id='asset-actas' and exists (select 1 from public.members where user_id=(select auth.uid()) and role='admin'));
create policy asset_actas_admin_insert on storage.objects for insert to authenticated
  with check (bucket_id='asset-actas' and exists (select 1 from public.members where user_id=(select auth.uid()) and role='admin'));

commit;
