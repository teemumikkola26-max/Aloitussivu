-- =========================================================================
-- PÄÄKÄYTTÄJÄT (Kenttälomakkeet, aloitussivu-v24)
-- Aja kerran Supabasen SQL-editorissa. Lisää käyttäjätauluun tiedon siitä,
-- kuka on pääkäyttäjä, ja sallii tiedon muuttamisen samoilla oikeuksilla
-- kuin käyttäjän poistamisen. Ajo on turvallista toistaa.
-- =========================================================================

alter table public.app_users
  add column if not exists is_admin boolean not null default false;

-- Muokkausoikeus: jos taululla ei vielä ole UPDATE-käytäntöä, luodaan sellainen
-- samalla ehdolla kuin olemassa oleva DELETE- (tai SELECT-) käytäntö.
do $$
declare q text;
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'app_users' and cmd in ('UPDATE', 'ALL')
  ) then
    select qual into q from pg_policies
      where schemaname = 'public' and tablename = 'app_users' and cmd = 'DELETE' limit 1;
    if q is null then
      select qual into q from pg_policies
        where schemaname = 'public' and tablename = 'app_users' and cmd = 'SELECT' limit 1;
    end if;
    if q is not null then
      execute format(
        'create policy app_users_update on public.app_users for update using (%s) with check (%s)', q, q);
    end if;
  end if;
end $$;

notify pgrst, 'reload schema';
