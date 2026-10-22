-- Ejecutar una vez en un proyecto Supabase nuevo. No contiene datos del inventario.
begin;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table public.members (
 user_id uuid primary key references auth.users(id) on delete cascade,
 role text not null check(role in ('admin','editor','viewer'))
);
create table public.locations (
 id uuid primary key default gen_random_uuid(),
 name text not null check(length(trim(name)) between 1 and 180),
 block text not null check(length(trim(block)) between 1 and 120)
);
create unique index locations_name_unique on public.locations(lower(trim(name)));
create table public.people (
 id uuid primary key default gen_random_uuid(),
 name text not null check(length(trim(name)) between 1 and 180),
 position text not null check(length(trim(position)) between 1 and 120)
);
create unique index people_name_unique on public.people(lower(trim(name)));
create table public.assets (
 id uuid primary key default gen_random_uuid(),
 plate text check(plate is null or length(trim(plate)) between 1 and 60),
 name text not null check(length(trim(name)) between 1 and 180),
 category text not null check(length(category) between 1 and 60),
 location_id uuid not null references public.locations(id),
 person_id uuid references public.people(id),
 quantity integer not null check(quantity>0),
 status text not null check(status in ('Bueno','Regular','Deteriorado','No encontrado','Pendiente de baja')),
 notes text not null default '' check(length(notes)<=2000),
 version integer not null default 1,
 last_action text not null check(last_action in ('Registro','Edición','Traslado')),
 action_note text not null default '' check(length(action_note)<=2000),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check(plate is null or quantity=1)
);
create unique index assets_plate_unique on public.assets(lower(trim(plate))) where plate is not null;
create index assets_location_idx on public.assets(location_id);
create index assets_person_idx on public.assets(person_id);
create table public.movements (
 id uuid primary key default gen_random_uuid(),
 asset_id uuid not null references public.assets(id),
 asset_name text not null,
 action text not null,
 note text not null,
 actor text not null,
 created_at timestamptz not null default now(),
 before jsonb,
 after jsonb not null
);
create index movements_asset_idx on public.movements(asset_id);
-- El disparador mantiene historial y versión en la misma transacción que el activo.
-- SECURITY DEFINER es necesario únicamente para escribir la bitácora inmutable.
-- Vive en un esquema no expuesto y no puede invocarse desde la API.
create function private.audit_asset() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 if auth.uid() is null or not exists(select 1 from public.members where user_id=auth.uid() and role in ('editor','admin')) then
  raise exception 'Usuario sin permisos de edición';
 end if;
 if TG_OP='UPDATE' then
  if new.version<>old.version+1 then raise exception 'Versión del activo desactualizada'; end if;
  new.created_at:=old.created_at;
  if new.location_id is distinct from old.location_id or new.person_id is distinct from old.person_id then
   new.last_action:='Traslado';
  else new.last_action:='Edición'; end if;
 else new.version:=1; new.last_action:='Registro'; new.created_at:=now(); end if;
 new.updated_at:=now();
 return new;
end; $$;
create function private.record_asset_event() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 insert into public.movements(asset_id,asset_name,action,note,actor,before,after)
 values(new.id,new.name,new.last_action,new.action_note,auth.uid()::text,
 case when TG_OP='UPDATE' then to_jsonb(old) else null end,to_jsonb(new));
 return new;
end; $$;
revoke all on function private.audit_asset() from public, anon, authenticated;
revoke all on function private.record_asset_event() from public, anon, authenticated;
create trigger assets_before_write before insert or update on public.assets for each row execute function private.audit_asset();
create trigger assets_after_write after insert or update on public.assets for each row execute function private.record_asset_event();
alter table public.members enable row level security;
alter table public.locations enable row level security;
alter table public.people enable row level security;
alter table public.assets enable row level security;
alter table public.movements enable row level security;
revoke all on public.members,public.locations,public.people,public.assets,public.movements from anon, authenticated;
grant select on public.members,public.locations,public.people,public.assets,public.movements to authenticated;
grant insert on public.locations,public.people,public.assets to authenticated;
grant update on public.assets to authenticated;
create policy member_self on public.members for select to authenticated using(user_id=(select auth.uid()));
create policy locations_read on public.locations for select to authenticated using(exists(select 1 from public.members where user_id=(select auth.uid())));
create policy people_read on public.people for select to authenticated using(exists(select 1 from public.members where user_id=(select auth.uid())));
create policy assets_read on public.assets for select to authenticated using(exists(select 1 from public.members where user_id=(select auth.uid())));
create policy movements_read on public.movements for select to authenticated using(exists(select 1 from public.members where user_id=(select auth.uid())));
create policy locations_insert on public.locations for insert to authenticated with check(exists(select 1 from public.members where user_id=(select auth.uid()) and role in ('admin','editor')));
create policy people_insert on public.people for insert to authenticated with check(exists(select 1 from public.members where user_id=(select auth.uid()) and role in ('admin','editor')));
create policy assets_insert on public.assets for insert to authenticated with check(exists(select 1 from public.members where user_id=(select auth.uid()) and role in ('admin','editor')));
create policy assets_update on public.assets for update to authenticated using(exists(select 1 from public.members where user_id=(select auth.uid()) and role in ('admin','editor'))) with check(exists(select 1 from public.members where user_id=(select auth.uid()) and role in ('admin','editor')));
commit;
