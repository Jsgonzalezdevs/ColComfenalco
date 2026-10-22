-- Permite retirar desde la importación solo ubicaciones vacías y solo a administradores.
-- La aplicación limita además la eliminación a nombres que su importador anterior
-- formó al confundir columnas de bienes por entregar con ubicaciones.
begin;

grant delete on public.locations to authenticated;
drop policy if exists locations_delete_unreferenced_admin on public.locations;
create policy locations_delete_unreferenced_admin on public.locations
  for delete to authenticated
  using (
    exists (
      select 1 from public.members
      where user_id = (select auth.uid()) and role = 'admin'
    )
    and not exists (
      select 1 from public.assets
      where assets.location_id = locations.id
    )
  );

commit;
