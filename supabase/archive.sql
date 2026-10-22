-- Complemento de setup.sql. Ejecutar en el proyecto del colegio, una sola vez.
-- Los originales se guardan en tablas privadas por RLS, nunca en public/ del sitio.
begin;
create table public.archive_documents (
 id uuid primary key,
 path text not null,
 sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
 byte_size integer not null check (byte_size >= 0),
 format text not null,
 category text not null,
 entry_count integer not null check (entry_count >= 0),
 extraction_status text not null check (extraction_status in ('complete','original_only','error')),
 imported_at timestamptz not null default now(),
 imported_by uuid not null default auth.uid() references auth.users(id),
 unique(path, sha256)
);
create table public.archive_originals (
 document_id uuid primary key references public.archive_documents(id),
 original_base64 text not null
);
create table public.archive_entries (
 id uuid primary key,
 document_id uuid not null references public.archive_documents(id),
 ordinal integer not null check (ordinal >= 0),
 locator text not null,
 kind text not null,
 payload jsonb not null,
 text text not null,
 unique(document_id, ordinal)
);
alter table public.archive_documents enable row level security;
alter table public.archive_originals enable row level security;
alter table public.archive_entries enable row level security;
revoke all on public.archive_documents,public.archive_originals,public.archive_entries from anon,authenticated;
grant select,insert on public.archive_documents,public.archive_originals,public.archive_entries to authenticated;
create policy archive_documents_admin_read on public.archive_documents for select to authenticated using(exists(select 1 from public.members where user_id=(select auth.uid()) and role='admin'));
create policy archive_documents_admin_insert on public.archive_documents for insert to authenticated with check(imported_by=(select auth.uid()) and exists(select 1 from public.members where user_id=(select auth.uid()) and role='admin'));
create policy archive_originals_admin_read on public.archive_originals for select to authenticated using(exists(select 1 from public.members where user_id=(select auth.uid()) and role='admin'));
create policy archive_originals_admin_insert on public.archive_originals for insert to authenticated with check(exists(select 1 from public.members where user_id=(select auth.uid()) and role='admin'));
create policy archive_entries_admin_read on public.archive_entries for select to authenticated using(exists(select 1 from public.members where user_id=(select auth.uid()) and role='admin'));
create policy archive_entries_admin_insert on public.archive_entries for insert to authenticated with check(exists(select 1 from public.members where user_id=(select auth.uid()) and role='admin'));

-- Una transacción por archivo: original + metadatos + todas sus filas.
-- SECURITY INVOKER: la función está sometida a las mismas políticas de admin.
create function public.import_archive_document(document jsonb, entries jsonb)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
 doc_id uuid := (document->>'id')::uuid;
 raw bytea := decode(document->>'original_base64','base64');
 actual_count integer;
begin
 if auth.uid() is null or not exists(select 1 from public.members where user_id=auth.uid() and role='admin') then
  raise exception 'Solo un administrador puede importar documentos';
 end if;
 if jsonb_typeof(entries) is distinct from 'array' or jsonb_array_length(entries)<>(document->>'entry_count')::integer then
  raise exception 'Cantidad de filas incorrecta';
 end if;
 if raw is null or octet_length(raw)<>(document->>'byte_size')::integer or encode(sha256(raw),'hex')<>document->>'sha256' then
  raise exception 'El original no coincide con su huella SHA-256';
 end if;
 if exists(select 1 from jsonb_array_elements(entries) e where (e->>'document_id')::uuid is distinct from doc_id) then
  raise exception 'Hay filas de otro documento';
 end if;
 insert into public.archive_documents(id,path,sha256,byte_size,format,category,entry_count,extraction_status)
 values(doc_id,document->>'path',document->>'sha256',(document->>'byte_size')::integer,document->>'format',document->>'category',(document->>'entry_count')::integer,document->>'extraction_status')
 on conflict(id) do nothing;
 if not exists(select 1 from public.archive_documents d where d.id=doc_id and d.path=document->>'path' and d.sha256=document->>'sha256' and d.entry_count=(document->>'entry_count')::integer) then
  raise exception 'Conflicto con una versión ya archivada';
 end if;
 insert into public.archive_originals(document_id,original_base64) values(doc_id,document->>'original_base64') on conflict(document_id) do nothing;
 insert into public.archive_entries(id,document_id,ordinal,locator,kind,payload,text)
 select x.id,x.document_id,x.ordinal,x.locator,x.kind,x.payload,x.text
 from jsonb_to_recordset(entries) as x(id uuid,document_id uuid,ordinal integer,locator text,kind text,payload jsonb,text text)
 on conflict(id) do nothing;
 select count(*) into actual_count from public.archive_entries where document_id=doc_id;
 if actual_count<>(document->>'entry_count')::integer or exists(
  select 1 from jsonb_to_recordset(entries) as x(id uuid,document_id uuid,ordinal integer,locator text,kind text,payload jsonb,text text)
  left join public.archive_entries a on a.id=x.id
  where a.id is null or (a.document_id,a.ordinal,a.locator,a.kind,a.payload,a.text) is distinct from (x.document_id,x.ordinal,x.locator,x.kind,x.payload,x.text)
 ) then raise exception 'Las filas archivadas no coinciden'; end if;
 if not exists(select 1 from public.archive_originals where document_id=doc_id and original_base64=document->>'original_base64') then
  raise exception 'El original archivado no coincide';
 end if;
 return doc_id;
end; $$;
revoke all on function public.import_archive_document(jsonb,jsonb) from public,anon;
grant execute on function public.import_archive_document(jsonb,jsonb) to authenticated;
commit;
