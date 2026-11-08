-- =========================================================================
-- OSIOT (Kenttälomakkeet, aloitussivu-v26)
-- Aja kerran Supabasen SQL-editorissa. Lisää menetelmätauluun sarakkeen,
-- johon pääkäyttäjän määrittämä osiolista tallennetaan, jotta lista on
-- sama kaikilla laitteilla. Ajo on turvallista toistaa.
-- Ilman saraketta osiot toimivat, mutta lista on laitekohtainen.
-- =========================================================================

alter table public.custom_methods
  add column if not exists settings jsonb not null default '{}'::jsonb;

notify pgrst, 'reload schema';
