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

### Korjaus: kameraluvun kuvaus (aloitussivu-v21)

- **Tarkempi kuva:**
  - Kamera tarkentaa jatkuvasti, ja esikatselun napautus tarkentaa kyseiseen kohtaan.
  - Jos selain tukee sitä (Chrome/Android), laukaisin ottaa täysresoluutioisen valokuvan esikatselukuvan sijaan. Valokuvaa käytetään vain, jos sen rajaus vastaa esikatselua.
- **Epätarkkuuden tunnistus:**
  - Epätarkka kuva hylätään heti, ja käyttäjää pyydetään kuvaamaan uudelleen.
  - Kahden hylkäyksen jälkeen kuva hyväksytään, ettei kuvaus jumiudu.
- **Galleria:**
  - Kamera suljetaan valinnan ajaksi ja käynnistyy uudelleen, jos valinta perutaan.
  - Avaamaton kuva ilmoitetaan.
  - Ohje kertoo, että näyttö rajataan ja painetaan laukaisinta.
- **Uskottavuus:** lämpötilat rajataan välille −30…50 °C, joten siirtyneet tunnistusrivit eivät enää tuota näennäisesti johdonmukaisia arvoja.
- **Diagnostiikka:**
  - Tarkistusnäkymässä on "Tunnistuksen tiedot", joista näkyvät kuvaustapa, tarkkuus ja tunnistettu teksti.
  - Epäonnistuneen luvun syy näkyy rivillä.

## Laskettu sarake taulukkoihin (aloitussivu-v22)

- **Uusi tiedosto `formula.js`:** yhteinen kaavamoottori. Kaavaa ei ajeta koodina, vaan se lasketaan sovelluksen omalla laskimella.
- **Sarakkeen tyyppi "Laskettu (kaava)":** sama tyyppi menetelmäeditorissa (`kenttalomake.html`) ja lomake-editorissa (`editor-runtime.js`, `form-runtime.js`).
- **Kaavan kirjoittaminen:**
  - Sarakkeisiin viitataan nimellä aaltosulkeissa, esim. `{RH (%)}`. Sarakkeen voi lisätä kaavaan myös napauttamalla sen nimeä.
  - Kaava tarkistetaan kirjoitettaessa.
  - Kaava tallennetaan sarakkeiden tunnisteilla, joten se säilyy, vaikka sarake nimettäisiin uudelleen.
- **Kaavan osat:**
  - laskutoimitukset + − * / ^ ja sulut
  - min, max, keskiarvo ja itseisarvo
  - abskost(T; RH), kastepiste(T; RH) ja suhtkost(T; a)
  - päivämäärien erotus vuorokausina
- **Laskettu arvo:**
  - Lomakkeella arvo on vain luettava ja päivittyy heti, kun arvoja kirjoitetaan. Se päivittyy myös kameraluvun jälkeen.
  - Arvo tallennetaan riville, joten raportit, apulauseet ja synkronointi käyttävät sitä sellaisenaan.
  - Apulauseissa laskettua saraketta verrataan kuten numeroa.
- **Kosteusfunktioiden kaava:** sama Magnus-kaava kuin raporttipohjamoottorissa. Tulos voi poiketa mittalaitteen näyttämästä noin 1 %.
- **Tallennuksen tarkistukset:** kaavan virheet, viittaukset puuttuviin sarakkeisiin ja kehäviittaukset estetään tallennettaessa.

## Tutkimussuunnitelman tarkistuslista (aloitussivu-v23)

- **Kohdenäkymä:** uusi kortti "Tutkimussuunnitelma". Siitä näkee edistymisen (käsitellyt / kaikki kohdat) ja pääsee tarkistuslistaan.
- **Listan kokoaminen:**
  - Tutkija valitsee kohdalle menetelmän ja voi lisätä tarkennuksen ja sijainnin, määrän sekä rakenneosan tai osion.
  - Kohta voi olla myös vapaa tehtävä, joka kuitataan käsin.
  - "Lisää ja lisää seuraava" nopeuttaa koko suunnitelman syöttämistä, ja rakenneosa muistetaan edellisestä kohdasta.
  - Valmiita pohjia ei ole.
- **Kohdan toiminnot:**
  - uusi kirjaus suoraan kohtaan
  - kohtaan liitettyjen kirjausten avaaminen
  - tehtävän kuittaus
  - "Ei tehdä", johon syy on pakollinen
  - muokkaus ja poisto
- **Menetelmän valinta:** menetelmäruudussa näkyy, montako suunnitelman kohtaa menetelmällä on avoinna.
- **Kirjauslomake:**
  - Lomakkeessa valitaan, mihin suunnitelman kohtaan kirjaus kuuluu, tai "Ei suunnitelmassa".
  - Ainoa avoin kohta valitaan valmiiksi.
  - Valinta on pakollinen, jos menetelmällä on kohtia listalla.
- **Kirjauslista:** kohta näkyy kirjauksen tiedoissa (📋).
- **Yhteenveto:** suunnitellut ja toteutuneet tutkimukset, tekemättä jätetyt syineen sekä suunnitelman ulkopuoliset kirjaukset. Yhteenveto ei vielä tulostu Word-raporttiin.
- **Tallennus:** linkki tallentuu kirjaukseen arvona `values.__planItem`, ja se synkronoituu kirjauksen mukana. Tarkistuslista synkronoidaan kohdittain (`data.studyPlan`): uusin muokkaus voittaa, eivätkä poistetut kohdat palaa.

## Selkeämpi käyttö kaikille tutkijoille (aloitussivu-v24)

- **Pääkäyttäjät:**
  - Asetukset ja ylläpito → Käyttäjät -kohdassa rastitetaan, ketkä ovat pääkäyttäjiä. Pääkäyttäjiä voi olla useita.
  - Vain pääkäyttäjä voi muuttaa valintaa. Jos pääkäyttäjiä ei ole valittu, kaikki näkevät ylläpitotoiminnot kuten ennen.
  - Tieto tallentuu sarakkeeseen `app_users.is_admin`, joka luodaan ajamalla kerran `supabase-paakayttajat.sql`. Ilman saraketta sovellus toimii kuten ennen.
  - Kyse ei ole tietoturvaratkaisusta (kaikilla on samat tunnukset), vaan valinta selkeyttää kenttätutkijan näkymää.
- **Ylläpito erillään:**
  - Kenttälomakkeen "Lisää toimintoja" -valikossa menetelmien muokkaus, raporttipohjat, ulkoasu ja kohteen poisto näkyvät vain pääkäyttäjille omassa osiossaan.
  - Etusivulla raporttipohjat, lomake-editori, siirtotyökalu, varmuuskopio sekä käyttäjien lisäys ja poisto näkyvät vain pääkäyttäjille. Muille kerrotaan, ketkä ovat pääkäyttäjiä.
- **Tallennuksen tila selkokielellä:**
  - Yläpalkissa lukee esimerkiksi "Tallessa laitteella", "✓ Pilvessä klo 11.40", "3 kuvaa odottaa", "Tallentaa…" tai "Uusi kohde", eikä varoitusmerkkiä käytetä turhaan.
  - Napautus avaa selityksen siitä, missä tiedot ovat ja tarvitseeko tehdä jotain. Virhetilanteessa selityksessä on "Yritä uudelleen".
- **Menetelmät pysyvät paikoillaan:** järjestys ei enää muutu käytön mukaan, ja viimeksi käytetty menetelmä on merkitty.
- **Yhtenäiset termit:**
  - "Kirjaus tallennettu" (ennen "Menetelmä tallennettu")
  - "Poista kohde ja kaikki sen tiedot…" (ennen "Tyhjennä koko lomake…")
  - "Uusi kohde" (ennen "Uusi lomake") ja "Avataan…" (ennen "Käynnistetään")
- **Kertavinkit** tallennuksen tilasta, tarkistuslistasta ja kameraluvusta. Vinkki näytetään kerran käyttäjää kohden tällä laitteella.

## Etusivun ryhmät ja kohteen avaaminen (aloitussivu-v25)

- **Etusivu, "Kesken olevat":**
  - Oman ryhmän (laitteen valittu käyttäjä) kohteet näkyvät aina.
  - Muiden käyttäjien kohteet ovat nimen alla kokoon taitettuina, ja ne avataan nuolipainikkeesta. Painikkeessa näkyy kohteiden määrä.
  - Avatut ryhmät muistetaan selainistunnon ajan.
  - Jos ryhmiä on vain yksi, sen kohteet näkyvät suoraan.
- **Kohde avautuu aina alkuun (kohteen tiedot), ei viimeksi auki olleeseen näkymään:**
  - Aiemmin tallennetun kirjauksen muokkaukset ovat jo kirjauksessa.
  - Kesken jäänyt uusi kirjaus näytetään kohdenäkymän yläosassa kortissa "Kesken jäänyt kirjaus", jossa ovat valinnat "Jatka kirjausta" ja "Hylkää". Tyhjä kesken jäänyt kirjaus hylätään automaattisesti.
  - Jos uusi kirjaus aloitetaan (myös kopioimalla tai tarkistuslistalta) kesken jääneen kirjauksen ollessa olemassa, käyttäjältä kysytään, jatketaanko vanhaa vai hylätäänkö se.

## Osiot ja kirjauksen tunniste (aloitussivu-v26)

- **Osio korvaa Tunnus/Tilan:**
  - Kirjauksen ensimmäinen kenttä on nyt Osio, ja Tunnus/Tila-kenttä on poistettu.
  - Osio valitaan pääkäyttäjän listalta tai kirjoitetaan itse.
  - Osio on pakollinen, kun osiolista on määritetty.
- **Osiolista:** pääkäyttäjä hallitsee listaa Menetelmät-sivun Osiot-kortissa (lisäys, uudelleennimeäminen, järjestys, poisto). Järjestys on raportin pääotsikoiden järjestys.
  - Lista tallentuu sarakkeeseen `custom_methods.settings`, joka luodaan ajamalla kerran `supabase-osiot.sql`. Ilman saraketta lista on laitekohtainen.
  - Lista on mukana etusivun varmuuskopiossa.
- **Oletusosio:** menetelmäeditorissa valitaan menetelmälle oletusosio, joka on valmiiksi valittuna uudessa kirjauksessa. Kirjausta kopioitaessa osio säilyy.
- **Kirjauksen tunniste:**
  - Tunnisteena käytetään menetelmän ensimmäisen kentän arvoa. Menetelmäeditorissa on tästä ohje.
  - Tunniste näkyy kirjauslistassa, pohjakuvan merkinnöissä, kuvien tiedostonimissä, kenttämuistiinpanossa ja raporttien alaotsikoissa.
  - Kirjausta kopioitaessa tunniste tyhjennetään.
- **Vanhat kirjaukset:** Tunnus/Tila säilyy, näkyy tunnisteena ja on muokattavissa kentässä "Tunnus/Tila (aiempi kenttä)".
- **Raporttipohjat:**
  - Uusi merkintä `{{kirjaukset osioittain}}`: osiot pääotsikoina osiolistan järjestyksessä, itse kirjoitetut osiot niiden jälkeen ja osiottomat kirjaukset otsikon "Muut havainnot" alle.
  - Uudet merkinnät `{{osio}}` ja `{{tunniste}}`. `{{paikka}}` toimii kuten `{{tunniste}}`.
  - `{{kirjaukset tiloittain}}` ryhmittelee vanhan Tunnus/Tilan tai osion mukaan.
  - `{{taulukko:…}}`-merkinnän ensimmäinen sarake on osio.
- **Korjaus:** lomakkeen näkyvyyspäivitys ei kaadu, kun lomake suljetaan tallennuksen jälkeen.

## Osiot pohjan omien otsikoiden alle (aloitussivu-v27)

- **Uusi raporttipohjan merkintä `{{osio:nimi}}`:** yhden osion kirjaukset tulevat pohjan oman otsikon alle ilman uutta otsikkoa. Pohjan otsikko, numerointi ja vakioteksti säilyvät.
- **`{{kirjaukset osioittain}}` ohittaa osiot, joilla on pohjassa oma `{{osio:…}}`.** Mikään osio ei siis tule kahdesti, eikä mikään kirjaus jää pois.
- **Uusi ehto `{{jos osio:nimi}} … {{/jos}}`:** osa poistetaan raportista, jos osiossa ei ole kirjauksia.
- **Nimien vertailu:** osioiden nimiä verrataan kirjainkoosta ja välilyönneistä riippumatta.
- **Pohjan tarkistus:** raporttipohjasivu huomauttaa, jos merkinnän osiota ei ole osiolistalla.
- **Opastus:**
  - Raporttipohjasivulla on oma ohje "Osiot raportin otsikoina": vaiheittainen selitys, esimerkkipohja ja nykyiset osiot merkintöineen kopioitavina.
  - Kenttälomakkeen Osiot-kortissa on lyhyt ohje ja linkki suoraan tähän ohjeeseen.
