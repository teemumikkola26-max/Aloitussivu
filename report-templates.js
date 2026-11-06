"use strict";
/* =========================================================================
   REPORT-TEMPLATES.JS
   Word-raporttipohjien tallennus ja haku.
   - Pohjien tiedot: Supabasen taulu "report_templates" (supabase-raporttipohjat.sql).
   - Tiedostot: "submission-photos"-säiliö, polku <user_id>/_raporttipohjat/<tiedosto>.docx
   - Lista ja tiedostot välimuistitetaan laitteelle, joten raportin voi viedä
     myös ilman verkkoyhteyttä, kun pohja on kerran haettu.
   - Tiedostoa vaihdettaessa edellinen versio säilyy historiassa (5 viimeisintä)
     ja sen voi palauttaa.
   Vaatii: submission-sync.js (tiedostojen lataus) ja auth-gate.js (__supabaseClient).
   ========================================================================= */
window.ReportTemplates = (function(){
  const TABLE = "report_templates";
  const LIST_CACHE = "aloitussivu.reportTemplates.v1";
  const LAST_USED = "aloitussivu.reportTemplate.lastUsed.v1";
  const DB_NAME = "aloitussivuReportTemplates";
  const STORE = "files";
  const HISTORY_MAX = 5;
  const MAX_BYTES = 30 * 1024 * 1024;

  function client(){
    if (!window.__supabaseClient) throw new Error("Yhteys ei ole vielä valmis.");
    return window.__supabaseClient;
  }
  function isMissingTable(err){ return !!(err && (err.code === "42P01" || err.code === "PGRST205")); }

  /* ---------- laitteen välimuisti (IndexedDB) ---------- */
  function db(){
    return new Promise((resolve, reject) => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE); };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  async function cacheGet(key){
    try{
      const d = await db();
      return await new Promise((res) => {
        const q = d.transaction(STORE, "readonly").objectStore(STORE).get(key);
        q.onsuccess = () => res(q.result || null); q.onerror = () => res(null);
      });
    }catch(e){ return null; }
  }
  async function cachePut(key, buf){
    try{
      const d = await db();
      await new Promise((res) => {
        const tx = d.transaction(STORE, "readwrite"); tx.objectStore(STORE).put(buf, key);
        tx.oncomplete = res; tx.onerror = res;
      });
    }catch(e){}
  }

  async function cacheDel(key){
    try{
      const d = await db();
      await new Promise((res) => { const tx = d.transaction(STORE, "readwrite"); tx.objectStore(STORE).delete(key); tx.oncomplete = res; tx.onerror = res; });
    }catch(e){}
  }

  function readListCache(){
    try{ const a = JSON.parse(localStorage.getItem(LIST_CACHE) || "[]"); return Array.isArray(a) ? a : []; }catch(e){ return []; }
  }
  function writeListCache(list){ try{ localStorage.setItem(LIST_CACHE, JSON.stringify(list)); }catch(e){} }

  function sortList(list){
    return list.slice().sort((a, b) => (b.is_default ? 1 : 0) - (a.is_default ? 1 : 0) || String(a.name).localeCompare(String(b.name), "fi"));
  }

  /* Palauttaa { list, offline, missingTable } */
  async function list(){
    try{
      const { data, error } = await client().from(TABLE)
        .select("id,name,description,is_default,file_path,file_name,file_size,history,updated_at,updated_by")
        .order("name", { ascending:true });
      if (error) throw error;
      const l = sortList(data || []);
      writeListCache(l);
      return { list:l, offline:false, missingTable:false };
    }catch(err){
      return { list:sortList(readListCache()), offline:true, missingTable:isMissingTable(err), error:err };
    }
  }

  /* Pohjan tiedosto ArrayBufferina: ensin laitteelta, sitten pilvestä. */
  async function getBytes(tpl){
    const cached = await cacheGet(tpl.file_path);
    if (cached) return cached;
    const blob = await window.SubmissionSync.downloadPhoto(tpl.file_path);
    const buf = await blob.arrayBuffer();
    await cachePut(tpl.file_path, buf);
    return buf;
  }

  /* Hakee kaikki pohjat laitteelle valmiiksi (kutsutaan kun verkko on käytössä). */
  async function prefetch(){
    const { list:l, offline } = await list();
    if (offline) return;
    for (const t of l){
      if (!t.file_path) continue;
      if (await cacheGet(t.file_path)) continue;
      try{ await getBytes(t); }catch(e){ console.warn("Raporttipohjan esihaku epäonnistui", t.name, e); }
    }
  }

  function checkFile(file){
    if (!file) throw new Error("Valitse tiedosto.");
    if (!/\.docx$/i.test(file.name || "")) throw new Error("Valitse Word-tiedosto (.docx). Jos pohja on .dotx-muodossa, tallenna se ensin Wordissa .docx-tiedostoksi.");
    if (file.size > MAX_BYTES) throw new Error("Tiedosto on liian suuri (enintään 30 Mt).");
  }
  function safeName(s){ return String(s || "pohja").normalize("NFKD").replace(/[^\w.-]+/g, "_").slice(0, 60); }

  async function uploadFile(file){
    const name = Date.now().toString(36) + "-" + safeName(file.name);
    const path = await window.SubmissionSync.uploadPhoto("_raporttipohjat", name,
      new Blob([file], { type:"application/vnd.openxmlformats-officedocument.wordprocessingml.document" }));
    try{ await cachePut(path, await file.arrayBuffer()); }catch(e){}
    return path;
  }

  async function create({ name, description, file, isDefault, by }){
    checkFile(file);
    const path = await uploadFile(file);
    const row = { name:name.trim(), description:(description || "").trim(), file_path:path, file_name:file.name,
      file_size:file.size, history:[], is_default:!!isDefault, updated_by:by || null, updated_at:new Date().toISOString() };
    const { data, error } = await client().from(TABLE).insert(row).select().single();
    if (error){ window.SubmissionSync.deletePhotoFile(path); throw error; }
    if (isDefault){
      try{ await setDefault(data.id); }catch(e){ console.warn("Oletuspohjan asetus epäonnistui", e); }
    }
    return data;
  }

  async function getRow(id){
    const { data, error } = await client().from(TABLE).select("*").eq("id", id).single();
    if (error) throw error;
    return data;
  }

  async function replaceFile(id, file, by){
    checkFile(file);
    const row = await getRow(id);
    const path = await uploadFile(file);
    const history = [{ file_path:row.file_path, file_name:row.file_name, file_size:row.file_size, replaced_at:new Date().toISOString(), updated_by:row.updated_by || null }]
      .concat(Array.isArray(row.history) ? row.history : []);
    const dropped = history.slice(HISTORY_MAX);
    const { error } = await client().from(TABLE).update({
      file_path:path, file_name:file.name, file_size:file.size, history:history.slice(0, HISTORY_MAX),
      updated_by:by || null, updated_at:new Date().toISOString()
    }).eq("id", id);
    if (error){ window.SubmissionSync.deletePhotoFile(path); throw error; }
    dropped.forEach(h => { if (h.file_path){ window.SubmissionSync.deletePhotoFile(h.file_path); cacheDel(h.file_path); } });
  }

  async function restoreVersion(id, index, by){
    const row = await getRow(id);
    const hist = Array.isArray(row.history) ? row.history.slice() : [];
    const h = hist[index];
    if (!h) throw new Error("Versiota ei löytynyt.");
    hist.splice(index, 1);
    hist.unshift({ file_path:row.file_path, file_name:row.file_name, file_size:row.file_size, replaced_at:new Date().toISOString(), updated_by:row.updated_by || null });
    const { error } = await client().from(TABLE).update({
      file_path:h.file_path, file_name:h.file_name, file_size:h.file_size || null, history:hist.slice(0, HISTORY_MAX),
      updated_by:by || null, updated_at:new Date().toISOString()
    }).eq("id", id);
    if (error) throw error;
  }

  async function updateMeta(id, { name, description }){
    const { error } = await client().from(TABLE).update({ name:name.trim(), description:(description || "").trim() }).eq("id", id);
    if (error) throw error;
  }

  async function setDefault(id){
    const c = client();
    const { error:e1 } = await c.from(TABLE).update({ is_default:false }).neq("id", id);
    if (e1) throw e1;
    const { error:e2 } = await c.from(TABLE).update({ is_default:true }).eq("id", id);
    if (e2) throw e2;
  }

  async function remove(id){
    const row = await getRow(id);
    const { error } = await client().from(TABLE).delete().eq("id", id);
    if (error) throw error;
    [row.file_path].concat((row.history || []).map(h => h.file_path)).filter(Boolean)
      .forEach(p => { window.SubmissionSync.deletePhotoFile(p); cacheDel(p); });
  }

  function getLastUsed(formKey){
    try{ return (JSON.parse(localStorage.getItem(LAST_USED) || "{}") || {})[formKey] || ""; }catch(e){ return ""; }
  }
  function setLastUsed(formKey, id){
    try{
      const m = JSON.parse(localStorage.getItem(LAST_USED) || "{}") || {};
      m[formKey] = id; localStorage.setItem(LAST_USED, JSON.stringify(m));
    }catch(e){}
  }

  return { list, getBytes, prefetch, create, replaceFile, restoreVersion, updateMeta, setDefault, remove,
    getLastUsed, setLastUsed, isMissingTable };
})();
