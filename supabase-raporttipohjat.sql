-- Word-raporttipohjat (report-templates.js / raporttipohjat.html)
-- Aja kerran Supabasen SQL-editorissa. Tiedostot tallentuvat olemassa olevaan
-- "submission-photos"-säiliöön polkuun <user_id>/_raporttipohjat/, joten
-- tallennustilan sääntöihin ei tarvita muutoksia.

create table if not exists public.report_templates (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null,
  description text not null default '',
  is_default  boolean not null default false,
  file_path   text not null,
  file_name   text not null default '',
  file_size   bigint,
  history     jsonb not null default '[]'::jsonb,   -- aiemmat versiot, uusin ensin
  updated_by  text,                                 -- sovelluksen käyttäjän nimi
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists report_templates_user_idx on public.report_templates(user_id);

alter table public.report_templates enable row level security;

drop policy if exists "report_templates_select_own" on public.report_templates;
drop policy if exists "report_templates_insert_own" on public.report_templates;
drop policy if exists "report_templates_update_own" on public.report_templates;
drop policy if exists "report_templates_delete_own" on public.report_templates;

create policy "report_templates_select_own" on public.report_templates
  for select to authenticated using (user_id = auth.uid());
create policy "report_templates_insert_own" on public.report_templates
  for insert to authenticated with check (user_id = auth.uid());
create policy "report_templates_update_own" on public.report_templates
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "report_templates_delete_own" on public.report_templates
  for delete to authenticated using (user_id = auth.uid());

notify pgrst, 'reload schema';
