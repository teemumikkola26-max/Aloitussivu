# Päivitys v20–v28: asennusohje

Paketti sisältää koko sovelluksen. Muutokset on tehty lähetettyyn versioon
(aloitussivu-v19), joten aiemmat muutoksesi ovat tallessa. Muutokset on
kuvattu tarkemmin tiedostossa MUUTOKSET-2026-11.md.

## Asennus

1. **Aja Supabasen SQL-editorissa kerran:**
   - `supabase-paakayttajat.sql`
   - `supabase-osiot.sql`

   Ajo on turvallista toistaa.
2. **Korvaa palvelimen tiedostot tämän paketin tiedostoilla.**
   Helpointa on viedä koko kansio.
3. **Avaa sovellus.** Service worker (`aloitussivu-v28`) hakee uudet tiedostot
   automaattisesti.
4. **Pääkäyttäjänä:**
   - Valitse pääkäyttäjät: Asetukset ja ylläpito → Käyttäjät.
   - Lisää osiot ja oletusosiot.
   - Tarkista menetelmien ensimmäiset kentät (kirjauksen tunniste).
   - Lataa raporttipohjat Raporttipohjat-sivulla.

## Muuttuneet tiedostot

Uudet tiedostot:

- `lukulaite-ocr.js`
- `formula.js`
- `supabase-paakayttajat.sql`
- `supabase-osiot.sql`

Muutetut tiedostot:

- `kenttalomake.html`
- `index.html`
- `users.js`
- `report-template-engine.js`
- `raporttipohjat.html`
- `editor-runtime.js`
- `form-runtime.js`
- `form.html`
- `editor.html`
- `sw.js`
- `MUUTOKSET-2026-11.md`

## Versioiden sisältö

- **v20:** lukemat mittalaitteen näytöltä kameralla, päivämääräsarake
- **v21:** tarkempi kuvaus ja epätarkkojen kuvien tunnistus
- **v22:** laskettu sarake (kaava)
- **v23:** tutkimussuunnitelman tarkistuslista
- **v24:** pääkäyttäjät, selkokielinen tallennustila, menetelmät pysyvät paikoillaan, yhtenäiset termit, kertavinkit
- **v25:** muiden käyttäjien kohteet kokoon taitettuina, kohde avautuu aina alkuun
- **v26:** osiot raportin pääotsikoina, Tunnus/Tila korvattu osiolla ja menetelmän ensimmäisellä kentällä
- **v27:** osiot pohjan omien otsikoiden alle ja opastus
- **v28:** taulukkokentän rivit raporttiin (`{{rivit:…}}`), kentät nimellä merkinnöissä
