# Päivitys v20–v32: asennusohje

Paketti sisältää koko sovelluksen. Muutokset on tehty lähetettyyn versioon
(aloitussivu-v19), joten aiemmat muutoksesi ovat tallessa. Muutokset on
kuvattu tarkemmin tiedostossa MUUTOKSET-2026-11.md.

## Asennus

1. **Aja Supabasen SQL-editorissa kerran:**
   - `supabase-paakayttajat.sql`
   - `supabase-osiot.sql`

   Jos olet jo ajanut ne, tätä ei tarvitse toistaa.
2. **Korvaa palvelimen tiedostot tämän paketin tiedostoilla.**
3. **Avaa sovellus.** Service worker (`aloitussivu-v32`) hakee uudet tiedostot
   automaattisesti.

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
- **v29:** raportin varoitukset selkokielellä
- **v30:** samannimisistä taulukkokentistä käytetään näkyvää, ja piilotuksen syy kerrotaan
- **v31:** osio vain otsikointiin, kirjaukset automaattisesti samannimisen otsikon alle
- **v32:** kaikkien kirjausten taulukkorivit samaan taulukkoon (`{{rivi:id}}{{rivit:kenttä}}`)
