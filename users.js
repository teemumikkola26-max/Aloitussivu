"use strict";
/* =========================================================================
   USERS.JS
   Useita käyttäjiä samoilla kirjautumistunnuksilla.
   - Käyttäjälista on Supabasen taulussa "app_users" (rivi kuuluu kirjautuneelle
     tilille, katso supabase-kayttajat.sql) ja välimuistissa laitteella.
   - "Aktiivinen käyttäjä" on laitekohtainen valinta (localStorage): se
     esivalitaan uusiin lomakkeisiin tarkastuksen suorittajaksi.
   Lataa tämä script auth-gate.js:n jälkeen. window.AppUsers on heti käytössä
   (välimuistista); "appusers:changed" -tapahtuma laukeaa kun lista päivittyy.
   ========================================================================= */
window.AppUsers = (function(){
  const CACHE_KEY = "aloitussivu.users.v1";
  const ACTIVE_KEY = "aloitussivu.activeUser.v1";
  let users = readCache();
  let tableMissing = false;
  let lastError = null;
  /* Pääkäyttäjät: sarake app_users.is_admin (supabase-paakayttajat.sql).
     Jos saraketta ei vielä ole, lista toimii kuten ennen eikä pääkäyttäjiä ole. */
  let adminColumnMissing = false;

  function readCache(){
    try{
      const a = JSON.parse(localStorage.getItem(CACHE_KEY) || "[]");
      return Array.isArray(a) ? a : [];
    }catch(e){ return []; }
  }
  function writeCache(){ try{ localStorage.setItem(CACHE_KEY, JSON.stringify(users)); }catch(e){} }
  function sortUsers(){ users.sort((a,b) => String(a.name).localeCompare(String(b.name), "fi")); }
  function emit(){ try{ window.dispatchEvent(new CustomEvent("appusers:changed")); }catch(e){} }

  function list(){ return users.slice(); }
  function names(){ return users.map(u => u.name); }
  function status(){ return { tableMissing, error: lastError, adminColumnMissing }; }

  /* Pääkäyttäjät. Ei tietoturvaratkaisu (kaikilla samat tunnukset), vaan
     selkeyttää kenttätutkijan näkymää: ylläpitotoiminnot näkyvät vain
     pääkäyttäjille. Jos pääkäyttäjiä ei ole valittu, kaikki näkevät ne. */
  function isAdmin(name){ return users.some(u => u.name === name && u.is_admin === true); }
  function admins(){ return users.filter(u => u.is_admin === true).map(u => u.name); }
  function hasAdmins(){ return admins().length > 0; }
  function activeIsAdmin(){ return !hasAdmins() || isAdmin(getActive()); }

  function getActive(){
    let n = "";
    try{ n = localStorage.getItem(ACTIVE_KEY) || ""; }catch(e){}
    return names().indexOf(n) !== -1 ? n : "";
  }
  function setActive(name){
    try{
      if (name) localStorage.setItem(ACTIVE_KEY, name);
      else localStorage.removeItem(ACTIVE_KEY);
    }catch(e){}
    emit();
  }

  function waitForClient(tries){
    return new Promise(resolve => {
      (function check(left){
        if (window.__supabaseClient) return resolve(window.__supabaseClient);
        if (left <= 0) return resolve(null);
        setTimeout(() => check(left - 1), 50);
      })(typeof tries === "number" ? tries : 100);
    });
  }

  function isMissingTable(error){
    // Vain oikea "taulua ei löydy" -virhe; muut virheet (esim. oikeudet) näytetään sellaisenaan.
    return !!(error && (error.code === "42P01" || error.code === "PGRST205"));
  }

  async function refresh(){
    const c = await waitForClient();
    if (!c) return list();
    try{
      const { data: sess } = await c.auth.getSession();
      if (!sess || !sess.session) return list();   // ei kirjautunut -> älä tyhjennä välimuistia
    }catch(e){ return list(); }
    let { data, error } = await c.from("app_users").select("id,name,created_at,is_admin");
    if (error && isMissingColumn(error)){
      adminColumnMissing = true;
      ({ data, error } = await c.from("app_users").select("id,name,created_at"));
    }else if (!error){
      adminColumnMissing = false;
    }
    if (error){
      lastError = error;
      tableMissing = isMissingTable(error);
      emit();
      return list();
    }
    tableMissing = false; lastError = null;
    users = data || [];
    sortUsers();
    writeCache();
    emit();
    return list();
  }

  async function add(name){
    name = String(name || "").replace(/\s+/g, " ").trim();
    if (!name) throw new Error("Anna käyttäjän nimi.");
    if (names().some(n => n.toLowerCase() === name.toLowerCase())) throw new Error("Samanniminen käyttäjä on jo olemassa.");
    const c = await waitForClient();
    if (!c) throw new Error("Supabase-yhteyttä ei ole.");
    const { data, error } = await c.from("app_users").insert({ name }).select("id,name,created_at").single();
    if (error){
      if (isMissingTable(error)) tableMissing = true;
      throw error;
    }
    users.push(data); sortUsers(); writeCache(); emit();
    return data;
  }

  async function setAdmin(id, value){
    const c = await waitForClient();
    if (!c) throw new Error("Supabase-yhteyttä ei ole.");
    if (adminColumnMissing) throw Object.assign(new Error("Pääkäyttäjäsarake puuttuu."), { adminColumnMissing:true });
    const { error } = await c.from("app_users").update({ is_admin: !!value }).eq("id", id);
    if (error){
      if (isMissingColumn(error)){ adminColumnMissing = true; emit(); throw Object.assign(new Error("Pääkäyttäjäsarake puuttuu."), { adminColumnMissing:true }); }
      throw error;
    }
    users = users.map(u => u.id === id ? Object.assign({}, u, { is_admin: !!value }) : u);
    writeCache(); emit();
  }

  function isMissingColumn(error){
    const m = String((error && (error.message || error.details)) || "");
    return (error && error.code === "42703") || /is_admin/.test(m) && /column|sarake|schema cache/i.test(m);
  }

  async function remove(id){
    const c = await waitForClient();
    if (!c) throw new Error("Supabase-yhteyttä ei ole.");
    const gone = users.find(u => u.id === id);
    const { error } = await c.from("app_users").delete().eq("id", id);
    if (error) throw error;
    users = users.filter(u => u.id !== id);
    writeCache();
    if (gone && localStorage.getItem(ACTIVE_KEY) === gone.name) setActive("");
    else emit();
  }

  /* Täyttää <select>-elementin käyttäjillä. Jos nykyinen arvo ei ole listassa
     (esim. poistettu käyttäjä tai vanha lomake), se säilytetään valintana. */
  function populateSelect(select, current){
    if (!select) return;
    const value = current != null ? String(current) : select.value;
    select.innerHTML = "";
    const empty = document.createElement("option");
    empty.value = ""; empty.textContent = "— valitse —";
    select.appendChild(empty);
    const all = names();
    if (value && all.indexOf(value) === -1) all.push(value);
    all.forEach(n => {
      const o = document.createElement("option");
      o.value = n; o.textContent = n;
      select.appendChild(o);
    });
    select.value = value;
  }

  // Päivitä lista taustalla, kun sivu latautuu ja kun kirjautuminen onnistuu.
  waitForClient().then(c => {
    if (!c) return;
    try{
      c.auth.onAuthStateChange((event, session) => { if (session) refresh(); });
    }catch(e){}
    refresh();
  });

  setTimeout(emit, 0);

  return { list, names, status, getActive, setActive, refresh, add, remove, populateSelect,
           isAdmin, admins, hasAdmins, activeIsAdmin, setAdmin };
})();
