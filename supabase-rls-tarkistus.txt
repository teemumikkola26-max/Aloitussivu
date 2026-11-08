-- Vain lukevia tarkistuskyselyjä: aja Supabasen SQL-editorissa ja vertaa tuloksia.
-- Tavoite: submissions- ja forms-tauluissa RLS päällä ja säännöt rajaavat rivit
-- kirjautuneen käyttäjän omiin (auth.uid()); kuvasäiliö on yksityinen ja
-- polun ensimmäinen osa on käyttäjän id.

-- 1) Onko RLS päällä?
select tablename, rowsecurity
from pg_tables
where schemaname = 'public' and tablename in ('forms', 'submissions');

-- 2) Taulujen säännöt
select tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

-- 3) Onko kuvasäiliö yksityinen?
select id, name, public from storage.buckets;

-- 4) Tallennustilan (kuvat) säännöt
select policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'storage' and tablename = 'objects';
