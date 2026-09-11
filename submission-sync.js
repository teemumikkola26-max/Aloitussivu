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

  async function saveSubmission({ id, formKey, formLabel, title, data }){
    const row = {
      id,
      form_key: formKey,
      form_label: formLabel,
      title: title || "",
      data: data
    };
    const { data: result, error } = await client().from("submissions").upsert(row).select().single();
    if (error) throw error;
    return result;
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
    }catch(e){ /* ei estä rivin poistoa vaikka tiedostojen siivous epäonnistuisi */ }
    const { error } = await client().from("submissions").delete().eq("id", id);
    if (error) throw error;
  }

  async function listMySubmissions(formKey){
    let q = client().from("submissions").select("id,form_key,form_label,title,updated_at").order("updated_at", { ascending:false });
    if (formKey) q = q.eq("form_key", formKey);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
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
    try{ await client().storage.from("submission-photos").remove([path]); }catch(e){}
  }

  return {
    newId, getUserId,
    loadSubmission, saveSubmission, deleteSubmission, listMySubmissions,
    uploadPhoto, downloadPhoto, deletePhotoFile
  };
})();
