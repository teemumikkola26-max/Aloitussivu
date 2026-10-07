"use strict";
/* =========================================================================
   SUBMISSION-SYNC.JS
   Jaettu moduuli keskeneräisten lomaketäyttöjen tallentamiseen Supabaseen
   (taulu "submissions") ja valokuvien tallentamiseen Supabase Storageen
   ("submission-photos" -bucket, polku <user_id>/<submission_id>/<tiedosto>).

   Käyttö: lataa tämä script auth-gate.js:n jälkeen. window.SubmissionSync
   on käytettävissä heti kun window.__supabaseClient on olemassa.
   ========================================================================= */
window.SubmissionSync = (function(){

  function client(){
    if (!window.__supabaseClient) throw new Error("Supabase-yhteyttä ei ole vielä muodostettu.");
    return window.__supabaseClient;
  }

  function newId(){
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return "id-" + Date.now() + "-" + Math.random().toString(36).slice(2,10);
  }

  async function getUserId(){
    const { data, error } = await client().auth.getUser();
    if (error || !data || !data.user) throw new Error("Käyttäjää ei tunnistettu.");
    return data.user.id;
  }

  /* ---------- Lomaketäytöt (submissions-taulu) ---------- */

  async function loadSubmission(id){
    const { data, error } = await client().from("submissions").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data || null;
  }

  // Puuttuuko inspector_name-sarake (supabase-kayttajat.sql ajamatta)?
  function isMissingInspectorColumn(error){
    return !!(error && String(error.message || "").indexOf("inspector_name") !== -1);
  }

  async function saveSubmission({ id, formKey, formLabel, title, data, inspectorName }){
    const row = {
      id,
      form_key: formKey,
      form_label: formLabel,
      title: title || "",
      data: data
    };
    if (inspectorName !== undefined) row.inspector_name = inspectorName ? String(inspectorName) : null;
    let res = await client().from("submissions").upsert(row).select().single();
    if (res.error && "inspector_name" in row && isMissingInspectorColumn(res.error)){
      // Sarake puuttuu vielä -> tallenna ilman sitä, jotta lomake ei jää tallentamatta.
      delete row.inspector_name;
      res = await client().from("submissions").upsert(row).select().single();
    }
    if (res.error) throw res.error;
    return res.data;
  }

  async function deleteSubmission(id){
    // Poistaa ensin kaikki tallennustilan tiedostot kyseiseltä lomaketäytöltä, sitten itse rivin.
    try{
      const userId = await getUserId();
      const prefix = userId + "/" + id;
      const { data: files } = await client().storage.from("submission-photos").list(prefix);
      if (files && files.length){
        const paths = files.map(f => prefix + "/" + f.name);
        await client().storage.from("submission-photos").remove(paths);
      }
    }catch(e){ console.warn("Valokuvatiedostojen siivous epäonnistui -- rivi poistetaan silti", e); }
    try{ await client().from("submission_locks").delete().eq("submission_id", id); }catch(e){}
    const { error } = await client().from("submissions").delete().eq("id", id);
    if (error) throw error;
  }

  async function listMySubmissions(formKey){
    function build(cols){
      let q = client().from("submissions").select(cols).order("updated_at", { ascending:false });
      if (formKey) q = q.eq("form_key", formKey);
      return q;
    }
    let res = await build("id,form_key,form_label,title,updated_at,inspector_name");
    if (res.error && isMissingInspectorColumn(res.error)){
      res = await build("id,form_key,form_label,title,updated_at");
    }
    if (res.error) throw res.error;
    return res.data || [];
  }

  /* ---------- Valokuvat (Storage) ---------- */

  async function uploadPhoto(submissionId, fileName, blob){
    const userId = await getUserId();
    const path = userId + "/" + submissionId + "/" + fileName;
    const { error } = await client().storage.from("submission-photos").upload(path, blob, { upsert:true, contentType: blob.type || "image/jpeg" });
    if (error) throw error;
    return path;
  }

  async function downloadPhoto(path){
    const { data, error } = await client().storage.from("submission-photos").download(path);
    if (error) throw error;
    return data; // Blob
  }

  async function deletePhotoFile(path){
    try{ await client().storage.from("submission-photos").remove([path]); }catch(e){ console.warn("Yksittäisen valokuvan poisto epäonnistui", e); }
  }

  /* ---------- "Käytössä"-merkintä (submission_locks-taulu) ----------
     Neuvoa-antava lukitus: kertoo muille, että joku täyttää lomaketta juuri nyt.
     Jos taulua ei ole (supabase-kayttajat.sql ajamatta), toiminnot ohitetaan hiljaa. */

  const DEVICE_KEY = "aloitussivu.deviceId.v1";
  function deviceId(){
    try{
      let d = localStorage.getItem(DEVICE_KEY);
      if (!d){ d = newId(); localStorage.setItem(DEVICE_KEY, d); }
      return d;
    }catch(e){ return "tmp-" + Math.random().toString(36).slice(2,10); }
  }

  async function getLock(submissionId){
    try{
      const { data, error } = await client().from("submission_locks")
        .select("submission_id,user_name,device_id,locked_at").eq("submission_id", submissionId).maybeSingle();
      if (error) return null;
      return data || null;
    }catch(e){ return null; }
  }

  async function touchLock(submissionId, userName){
    try{
      const { error } = await client().from("submission_locks").upsert({
        submission_id: submissionId,
        user_name: userName || "",
        device_id: deviceId(),
        locked_at: new Date().toISOString()
      });
      return !error;
    }catch(e){ return false; }
  }

  async function releaseLock(submissionId){
    try{
      await client().from("submission_locks").delete()
        .eq("submission_id", submissionId).eq("device_id", deviceId());
    }catch(e){}
  }

  return {
    newId, getUserId, deviceId,
    loadSubmission, saveSubmission, deleteSubmission, listMySubmissions,
    uploadPhoto, downloadPhoto, deletePhotoFile,
    getLock, touchLock, releaseLock
  };
})();
