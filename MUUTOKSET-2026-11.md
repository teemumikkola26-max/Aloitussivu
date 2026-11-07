# Muutokset 11/2026: puhelinkäyttö ja Word-raportit yrityksen pohjiin

## Käyttöönotto

1. Aja `supabase-raporttipohjat.sql` Supabasen SQL-editorissa (luo taulun `report_templates`).
   Tiedostot tallentuvat olemassa olevaan `submission-photos`-säiliöön, joten tallennustilan sääntöihin ei tarvita muutoksia.
2. Vie kaikki tiedostot palvelimelle. Service workerin välimuistin versio on nostettu (`aloitussivu-v19`),
   joten puhelimet hakevat uudet tiedostot automaattisesti.
3. Avaa etusivulta **Asetukset ja ylläpito → Raporttipohjat (Word)** ja lisää merkityt pohjat
   (`PBM_katselmusraportti_POHJA_merkitty.docx`, `PBM_tutkimusseloste_LAAJA_POHJA_merkitty.docx`).
   Sivu tarkistaa pohjan merkinnät latauksen yhteydessä.

## Uudet tiedostot

| Tiedosto | Tarkoitus |
|---|---|
| `report-template-engine.js` | Täyttää Word-pohjan merkinnät `{{...}}` kenttälomakkeen tiedoilla |
| `report-templates.js` | Pohjien tallennus, versiot, oletuspohja ja laitteelle välimuistitus (toimii ilman verkkoa) |
| `raporttipohjat.html` | Pohjien hallinta: lisäys, tarkistus, tiedoston vaihto, aiemman version palautus, poisto, merkintäohje |
| `ui-kit.js` | Yhteiset toimintovalikot ja vahvistusikkunat (korvaa selaimen confirm/prompt-ikkunat) |
| `kenttalomake-mobile.css` | PBM-väriteema ja puhelinkäytön parannukset kenttälomakkeelle |
| `manifest.webmanifest`, `icon-192.png`, `icon-512.png`, `pbm-logo.png` | Asennus kotinäytölle ja logo |
| `supabase-raporttipohjat.sql` | Tietokantataulu ja käyttöoikeussäännöt |

## Kenttälomake (`kenttalomake.html`)

- **Word-vienti:** "⬇ Word" avaa listan raporttipohjista (viimeksi käytetty ensin, sitten oletus).
  Vanha vienti on listan lopussa nimellä "Kenttämuistiinpano (ilman raporttipohjaa)".
  Painike näyttää vientiä tehtäessä "Muodostetaan…" eikä reagoi tuplapainallukseen.
- **Kohteen tiedot:** uudet kentät Osoite, Tilaajan yhteyshenkilö ja Projektinumero. Kun nimi ja tutkija on täytetty, kortti näkyy tiivistettynä ("Muokkaa").
- **Liitteet:** tutkimussuunnitelma ja pohjakuva ovat yhdessä avattavassa kortissa, joka on suljettuna, kun molemmat on lisätty.
- **Kirjaukset:** koko kortti avaa kirjauksen; Kopioi, Siirrä ylös/alas ja Poista ovat ⋯-valikossa.
  Termi "menetelmä" tarkoittaa nyt vain pohjaa (esim. pintakosteusmittaus), tehty merkintä on "kirjaus".
- **Kirjauslomake:**
  - Kamera on alapalkissa.
  - Kuvat ja kuvatekstit ovat yhtenä listana.
  - Mikrofoni on kentän sisällä.
  - Taulukkokentät näkyvät puhelimessa kortteina, ellei menetelmään ole valittu muuta näkymää.
- **Yläpalkki:** yksi rivi: takaisin-nuoli, otsikko ja tallennustila. Tilan koko teksti näkyy napauttamalla.
  Sisällön omat takaisin-painikkeet on poistettu.
- **Alapalkki:** piiloutuu, kun kenttään kirjoitetaan (näppäimistö auki).
- **Vahvistukset:** kaikki vahvistukset ovat omia ikkunoita, joiden painikkeissa lukee, mitä tapahtuu.
  Peruuttamattomissa toiminnoissa turvallinen valinta on korostettu.
- **Lisää toimintoja -valikkoon siirrettiin:** Muokkaa menetelmiä, Raporttipohjat ja Tallenna kaikki kuvat laitteelle.
- **Ulkoasu:** isompi teksti ja vähintään 44 px:n painikkeet.

## Etusivu (`index.html`)

- Kesken olevat lomakkeet ensimmäisenä; koko kortti jatkaa lomaketta, poisto ⋯-valikossa (kaksi vahvistusta).
- Käyttäjän valinta yläpalkin painikkeesta.
- Ylläpito (käyttäjät, raporttipohjat, lomake-editori, siirtotyökalu, varmuuskopio, uloskirjautuminen) on suljetussa "Asetukset ja ylläpito" -osiossa.

## Muut

- PBM-väriteema myös omiin lomakkeisiin (`styles.css`, `form.html`) ja kirjautumissivulle (`auth-gate.js`).

## Pohjakuvan merkinnät (`plan-markup.js`)

Pohjakuvalla on kohteen yhteinen merkintäkerros. Sen avaa pohjakuvakortin painikkeesta **✏ Piirrä ja merkitse pohjakuvaan**.

- **Työkalut:**
  - Piirto ja muodot: kynä, korostus, viiva, nuoli, murtoviiva, suorakulmio, ellipsi, monikulmio ja pilvi.
  - Tekstit: tekstilaatikko ja selite nuolella.
  - Symbolit numeroituvat automaattisesti: MP, RA, N, MAK, VM, LK ja numeroitu merkki.
  - Valmiit alueet: kosteusvaurioalue, mikrobivaurioepäily, tutkimaton alue, ilmavuoto ja halkeama.
  - Selitelaatikko listaa sivulla käytetyt symbolit ja alueet automaattisesti.
- **Muotoilu:** viivan ja täytön väri (myös oma väri), viivan paksuus, viivatyyli (yhtenäinen, katko, piste), läpinäkyvyys, täytön peittävyys, tekstin koko ja väri sekä nuolenkärjet viivan kumpaankin päähän.
- **Muokkaus:**
  - Merkinnän voi valita, siirtää ja muotoilla kahvoista.
  - Merkinnän voi monistaa, tuoda päällimmäiseksi ja poistaa.
  - Kumoa ja tee uudelleen.
  - Nipistys- ja painikezoomaus.
  - Useampisivuiset PDF:t.
  - Kirjausten sijaintimerkinnät näkyvät taustalla himmennettyinä.
- **Vienti:** "Vie pohjakuva merkinnöin (PDF)" lisää piirrokset oikeina PDF-kommentteina (Ink, Line, PolyLine, Square, Circle, Polygon/pilvi, FreeText, Stamp). Niitä voi jatkaa muokkaamaan esim. PDF-XChangessa. Merkinnät osuvat oikein myös kierretyille sivuille.
- **Tallennus:** merkinnät tallentuvat laitteelle ja pilveen lomakkeen mukana. Usean käyttäjän muutokset yhdistetään merkinnöittäin, jolloin uusin muokkaus voittaa ja poistot säilyvät.
- **Pohjakuvan vaihto tai poisto** poistaa myös piirrokset, ja tästä varoitetaan ennen vaihtoa.

## Korjauksia (7.11.2026)

- Word-raportin (raporttipohjat) valokuvat ovat nyt allekkain, ei kahdessa sarakkeessa.
- Menetelmien muokkaus: napauta menetelmää avataksesi sen; Muokkaa ja Poista ovat ⋯-valikossa.
- Kirjauksen kuvien pikkukuvat luodaan aina tuoreesta kuvatiedostosta, ja virhetilanteessa yritetään uudelleen.
- Lomake-editorin lomakkeella uloskirjautuminen on sivun lopussa, ei kelluvana painikkeena alapalkin päällä.
- Manifest: erillinen maskable-kuvake ja `id`.

## Kameraluku ja päivämääräsarake (taulukkokentät)

Service workerin välimuistin versio on nostettu (`aloitussivu-v20`).

- **Uusi tiedosto `lukulaite-ocr.js`:** mittalaitteen näytön luku kameralla (Vaisala HM40 -sarja, näkymä T, RH, Td ja a).
- **Menetelmäeditori:** taulukkokentän asetus "Lukemat mittalaitteen näytöltä kameralla". Siinä valitaan sarakkeet, joihin RH (pakollinen), lämpötila, absoluuttinen kosteus ja kuvauspäivä kirjoitetaan.
- **Kirjauslomake:**
  - "Lue mittarista" kuvaa näytöt sarjana, ja jokaisesta kuvasta syntyy rivi heti.
  - Tunnistus tehdään taustalla. Epävarmat arvot merkitään oranssilla.
  - Rivin pikkukuvasta aukeaa tarkistusnäkymä.
  - Kuva tallentuu kirjaukselle, ja kuvateksti muodostuu rivin arvoista.
  - Tallennus odottaa kesken olevat luvut ja kysyy tarkistamattomista riveistä.
- **Sarakkeen tyyppi Päivämäärä:**
  - Puhelimen päivämäärävalitsin.
  - Arvo tallentuu muodossa vvvv-kk-pp.
  - Raporteissa päivä näkyy muodossa p.k.vvvv.
  - Apulauseissa ja näyttöehdoissa on vertailut "ennen" ja "jälkeen".
- **Raporttipohjat (`report-template-engine.js`):**
  - Taulukon päivämäärät muotoillaan.
  - Numerosarakkeiden arvot näytetään kirjatulla tarkkuudella, esim. 8,27 eikä 8,3.
