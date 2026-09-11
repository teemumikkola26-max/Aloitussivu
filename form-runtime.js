"use strict";
/* =========================================================================
   FORM.HTML — YLEINEN LOMAKEMOOTTORI
   Lataa lomakepohjan Supabasesta (taulu "forms", sarake "definition")
   URL-parametrin ?id=<uuid> perusteella ja piirtää sen. Sama moottori
   toimii mille tahansa editorilla luodulle lomakkeelle.

   LOMAKEPOHJAN MUOTO (definition-sarake, JSON):
   {
     meta: { title, tag, desc, icon },
     statusScheme: [ { value, label, color, desc?, isDefault? }, ... ],
     headerFields: [ { id, label, type: "text"|"date"|"textarea", full? }, ... ],
     sections: [
       { id, title,
         fields: [
           { id, type: "checklist"|"text"|"number"|"date"|"select",
             label, allowPhoto?, allowAction?, actionLabel?, unit?, options? }
         ]
       }
     ]
   }
   ========================================================================= */

let DEF = null;
let FORM_ID = null;
let SUBMISSION_ID = null;
let DEFAULT_STATUS = "unchecked";
let state = { header:{}, items:{} };
let saveTimer = null;
let db = null;
const openSections = new Set();

function fatalError(message){
  document.documentElement.style.visibility = "visible";
  const banner = document.createElement("div");
  banner.style.cssText =
    "position:fixed;top:0;left:0;right:0;z-index:999999;background:#a13030;color:#fff;" +
    "padding:14px 16px;font-size:.85rem;white-space:pre-wrap;";
  banner.textContent = message;
  document.body.appendChild(banner);
}

function allItemIds(){
  const ids = [];
  DEF.sections.forEach(sec => sec.fields.forEach(f => ids.push(sec.id + "_" + f.id)));
  return ids;
}

function isFieldDone(field, itemId){
  const it = state.items[itemId];
  if (field.type === "checklist") return it.status !== DEFAULT_STATUS;
  if (field.type === "table") return Object.values(it.table || {}).some(v => v && String(v).trim() !== "");
  return !!(it.value && String(it.value).trim() !== "");
}

function sectionAndFieldOf(itemId){
  for (const sec of DEF.sections){
    for (const f of sec.fields){
      if (sec.id + "_" + f.id === itemId) return { sec, field: f };
    }
  }
  return null;
}

/* ---------- IndexedDB ---------- */
function openDb(dbName){
  return new Promise((resolve) => {
    if (!window.indexedDB){ resolve(null); return; }
    const req = indexedDB.open(dbName, 1);
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains("meta")) d.createObjectStore("meta", { keyPath:"key" });
      if (!d.objectStoreNames.contains("items")) d.createObjectStore("items", { keyPath:"id" });
      if (!d.objectStoreNames.contains("photos")) d.createObjectStore("photos", { keyPath:"id", autoIncrement:true });
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = () => resolve(null);
  });
}
function idbPut(storeName, value){
  return new Promise((resolve) => {
    if (!db){ resolve(false); return; }
    try{
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).put(value);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    }catch(e){ resolve(false); }
  });
}
function idbDelete(storeName, key){
  return new Promise((resolve) => {
    if (!db){ resolve(false); return; }
    try{
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).delete(key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    }catch(e){ resolve(false); }
  });
}
function idbGetAll(storeName){
  return new Promise((resolve) => {
    if (!db){ resolve([]); return; }
    try{
      const tx = db.transaction(storeName, "readonly");
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    }catch(e){ resolve([]); }
  });
}
function idbClearAll(){
  return new Promise((resolve) => {
    if (!db){ resolve(false); return; }
    try{
      const tx = db.transaction(["meta","items","photos"], "readwrite");
      tx.objectStore("meta").clear();
      tx.objectStore("items").clear();
      tx.objectStore("photos").clear();
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    }catch(e){ resolve(false); }
  });
}

function setSaveIndicator(text){
  const el = document.getElementById("saveIndicator");
  if (el) el.textContent = text;
}
function deriveTitle(){
  const firstVal = Object.values(state.header).find(v => v && String(v).trim());
  return firstVal || (DEF && DEF.meta && DEF.meta.title) || "(nimetön kohde)";
}

let cloudSyncInFlight = false;
function saveDebounced(){
  setSaveIndicator("Tallennetaan…");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(doSave, 500);
}
async function doSave(){
  await idbPut("meta", { key:"header", value: state.header });
  for (const id of Object.keys(state.items)){
    const it = state.items[id];
    await idbPut("items", { id, status: it.status, note: it.note, action: it.action, value: it.value, table: it.table });
  }
  setSaveIndicator("Tallennettu laitteelle…");
  syncToCloud();
}

async function syncToCloud(){
  if (cloudSyncInFlight) return;
  cloudSyncInFlight = true;
  try{
    for (const id of Object.keys(state.items)){
      const it = state.items[id];
      for (const p of it.photos){
        if (!p.path && p.blob){
          try{ p.path = await window.SubmissionSync.uploadPhoto(SUBMISSION_ID, "p" + p.id + ".jpg", p.blob); }catch(e){}
        }
      }
    }
    const cloudItems = {};
    Object.keys(state.items).forEach(id => {
      const it = state.items[id];
      cloudItems[id] = {
        status: it.status, note: it.note, action: it.action, value: it.value, table: it.table,
        photos: it.photos.filter(p => p.path).map(p => ({ id:p.id, path:p.path, w:p.w, h:p.h }))
      };
    });
    await window.SubmissionSync.saveSubmission({
      id: SUBMISSION_ID, formKey: FORM_ID, formLabel: (DEF && DEF.meta && DEF.meta.title) || "Lomake",
      title: deriveTitle(), data: { header: state.header, items: cloudItems }
    });
    setSaveIndicator("Tallennettu pilveen");
  }catch(e){
    setSaveIndicator("Tallennettu laitteelle (ei pilviyhteyttä)");
  }finally{
    cloudSyncInFlight = false;
  }
}

async function loadFromStorage(){
  let loadedFromCloud = false;
  try{
    const sub = await window.SubmissionSync.loadSubmission(SUBMISSION_ID);
    if (sub && sub.data){
      state.header = sub.data.header || {};
      const items = sub.data.items || {};
      for (const id of Object.keys(items)){
        if (!state.items[id]) continue;
        state.items[id].status = items[id].status || DEFAULT_STATUS;
        state.items[id].note = items[id].note || "";
        state.items[id].action = items[id].action || "";
        state.items[id].value = items[id].value || "";
        state.items[id].table = items[id].table || {};
        for (const p of (items[id].photos || [])){
          try{
            const blob = await window.SubmissionSync.downloadPhoto(p.path);
            const url = URL.createObjectURL(blob);
            state.items[id].photos.push({ id:p.id, path:p.path, blob, url, w:p.w, h:p.h });
          }catch(e){ /* yksittäisen kuvan lataus epäonnistui -- jatketaan muilla */ }
        }
      }
      loadedFromCloud = true;
    }
  }catch(e){ /* ei pilviyhteyttä -- jatketaan paikallisella kopiolla alla */ }

  if (!loadedFromCloud){
    const metaRows = await idbGetAll("meta");
    const headerRow = metaRows.find(r => r.key === "header");
    if (headerRow) state.header = headerRow.value || {};

    const itemRows = await idbGetAll("items");
    itemRows.forEach(row => {
      if (state.items[row.id]){
        state.items[row.id].status = row.status || DEFAULT_STATUS;
        state.items[row.id].note = row.note || "";
        state.items[row.id].action = row.action || "";
        state.items[row.id].value = row.value || "";
        state.items[row.id].table = row.table || {};
      }
    });

    const photoRows = await idbGetAll("photos");
    photoRows.forEach(row => {
      if (state.items[row.itemId]){
        const url = URL.createObjectURL(row.blob);
        state.items[row.itemId].photos.push({ id: row.id, blob: row.blob, url, w: row.w, h: row.h });
      }
    });
    if (headerRow || itemRows.length){
      showToast("Ei pilviyhteyttä juuri nyt — näytetään laitteelle tallennettu kopio.");
    }
  }
}

/* ---------- Kuvat: kamera -> canvas-uudelleenpiirto (poistaa EXIFin) -> Blob ---------- */
const MAX_DIM = 1600;
function fileToStrippedBlob(file){
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => { img.src = reader.result; };
    reader.onerror = reject;
    img.onload = () => {
      let w = img.naturalWidth, h = img.naturalHeight;
      if (w > MAX_DIM || h > MAX_DIM){
        const scale = MAX_DIM / Math.max(w, h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob((blob) => {
        if (blob) resolve({ blob, w, h }); else reject(new Error("toBlob failed"));
      }, "image/jpeg", 0.82);
    };
    img.onerror = reject;
    reader.readAsDataURL(file);
  });
}

let pendingPhotoItemId = null;
document.getElementById("cameraInput").addEventListener("change", async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = "";
  if (!file || !pendingPhotoItemId) return;
  const itemId = pendingPhotoItemId;
  try{
    const { blob, w, h } = await fileToStrippedBlob(file);
    let id;
    if (db){
      id = await new Promise((resolve) => {
        const tx = db.transaction("photos", "readwrite");
        const req = tx.objectStore("photos").add({ itemId, blob, w, h, ts: Date.now() });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve("local_" + Date.now());
      });
    } else {
      id = "local_" + Date.now();
    }
    const url = URL.createObjectURL(blob);
    state.items[itemId].photos.push({ id, blob, url, w, h });
    renderSections();
    saveDebounced();
  }catch(err){
    showToast("Kuvan käsittely epäonnistui.");
  }
});

function removePhoto(itemId, photoId){
  const arr = state.items[itemId].photos;
  const idx = arr.findIndex(p => p.id === photoId);
  if (idx === -1) return;
  URL.revokeObjectURL(arr[idx].url);
  const removedPath = arr[idx].path;
  arr.splice(idx, 1);
  if (db) idbDelete("photos", photoId);
  if (removedPath) window.SubmissionSync.deletePhotoFile(removedPath).catch(()=>{});
  renderSections();
  saveDebounced();
}

/* ---------- Renderöinti ---------- */
function renderHeaderFields(){
  const wrap = document.getElementById("headerFields");
  wrap.innerHTML = "";
  (DEF.headerFields || []).forEach(f => {
    const div = document.createElement("div");
    div.className = "field";
    const label = document.createElement("label");
    label.textContent = f.label;
    label.setAttribute("for", "hf_" + f.id);
    div.appendChild(label);
    let input;
    if (f.type === "textarea"){
      input = document.createElement("textarea");
    } else {
      input = document.createElement("input");
      input.type = f.type === "date" ? "date" : "text";
    }
    input.id = "hf_" + f.id;
    input.autocomplete = "off";
    input.value = state.header[f.id] || "";
    input.addEventListener("input", () => {
      state.header[f.id] = input.value;
      saveDebounced();
    });
    div.appendChild(input);
    wrap.appendChild(div);
  });
}

function fieldCounts(sec){
  let done = 0, notes = 0;
  sec.fields.forEach(f => {
    const itemId = sec.id + "_" + f.id;
    if (isFieldDone(f, itemId)) done++;
    const it = state.items[itemId];
    if (f.type === "checklist"){
      const scheme = (DEF.statusScheme || []).find(s => s.value === it.status);
      if (scheme && scheme.attention) notes++;
    }
  });
  return { done, total: sec.fields.length, notes };
}

function colorWithAlpha(hex, alpha){
  if (!hex) return "#eee";
  const h = hex.replace("#","");
  return "#" + h + alpha;
}

function renderSections(){
  const main = document.getElementById("sections");
  main.innerHTML = "";
  DEF.sections.forEach((sec, secIdx) => {
    const { done, total, notes } = fieldCounts(sec);
    const secDiv = document.createElement("div");
    secDiv.className = "section" + (openSections.has(sec.id) ? " open" : "");
    secDiv.id = "sec_" + sec.id;

    const head = document.createElement("div");
    head.className = "section-head";
    head.innerHTML =
      '<div class="section-title-wrap"><span class="section-num">' + (secIdx+1) + '</span>' +
      '<h2>' + escapeHtml(sec.title) + '</h2></div>' +
      '<span class="section-count ' + (done===total?'complete':(notes>0?'has-notes':'')) + '">' + done + '/' + total + '</span>' +
      '<span class="chevron"></span>';
    head.addEventListener("click", () => {
      if (openSections.has(sec.id)) openSections.delete(sec.id); else openSections.add(sec.id);
      renderSections();
    });
    secDiv.appendChild(head);

    const itemsWrap = document.createElement("div");
    itemsWrap.className = "section-items";

    sec.fields.forEach((field) => {
      const itemId = sec.id + "_" + field.id;
      const itState = state.items[itemId];
      const itemDiv = document.createElement("div");
      itemDiv.className = "item";

      const textDiv = document.createElement("div");
      textDiv.className = "item-text";
      textDiv.textContent = field.label;
      itemDiv.appendChild(textDiv);

      if (field.type === "checklist"){
        const statusRow = document.createElement("div");
        statusRow.className = "status-row";
        (DEF.statusScheme || []).forEach(opt => {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "status-btn";
          const active = itState.status === opt.value;
          btn.style.cssText = active
            ? ("background:" + colorWithAlpha(opt.color,"22") + ";border-color:" + opt.color + ";color:" + opt.color + ";font-weight:600;")
            : "";
          btn.textContent = opt.label;
          btn.addEventListener("click", () => {
            itState.status = opt.value;
            renderSections();
            saveDebounced();
          });
          statusRow.appendChild(btn);
        });
        itemDiv.appendChild(statusRow);

        const activeScheme = (DEF.statusScheme || []).find(s => s.value === itState.status);
        if (activeScheme && activeScheme.desc){
          const descDiv = document.createElement("div");
          descDiv.style.cssText = "font-size:.74rem;color:var(--ink-soft);margin:-4px 0 8px;";
          descDiv.textContent = activeScheme.desc;
          itemDiv.appendChild(descDiv);
        }

        const noteArea = document.createElement("div");
        noteArea.className = "note-area show";
        const noteTextarea = document.createElement("textarea");
        noteTextarea.placeholder = "Kirjaa havainto tai lisätieto…";
        noteTextarea.autocomplete = "off";
        noteTextarea.value = itState.note;
        noteTextarea.addEventListener("input", () => {
          itState.note = noteTextarea.value;
          saveDebounced();
        });
        noteArea.appendChild(noteTextarea);
        itemDiv.appendChild(noteArea);

        if (field.allowAction){
          const actionArea = document.createElement("div");
          actionArea.className = "action-area";
          const actionLabel = document.createElement("label");
          actionLabel.textContent = field.actionLabel || "Lisätoimenpide";
          const actionInput = document.createElement("input");
          actionInput.type = "text";
          actionInput.autocomplete = "off";
          actionInput.value = itState.action;
          actionInput.addEventListener("input", () => {
            itState.action = actionInput.value;
            saveDebounced();
          });
          actionArea.appendChild(actionLabel);
          actionArea.appendChild(actionInput);
          itemDiv.appendChild(actionArea);
        }
      } else if (field.type === "table"){
        if (!itState.table) itState.table = {};
        const tableWrap = document.createElement("div");
        tableWrap.style.cssText = "overflow-x:auto;margin-bottom:8px;";
        const tableEl = document.createElement("table");
        tableEl.style.cssText = "border-collapse:collapse;width:100%;font-size:.85rem;";
        const rows = field.tableRows || 3;
        const cols = field.tableCols || 3;
        for (let r = 0; r < rows; r++){
          const tr = document.createElement("tr");
          for (let c = 0; c < cols; c++){
            const isHeaderCell = (r === 0 || c === 0);
            const cell = document.createElement(isHeaderCell ? "th" : "td");
            cell.style.cssText = "border:1px solid var(--line-strong);padding:6px 8px;text-align:left;" +
              (isHeaderCell ? "background:#f1efe8;font-weight:600;white-space:nowrap;" : "");
            if (r === 0 && c === 0){
              cell.textContent = field.tableCorner || "";
            } else if (r === 0){
              cell.textContent = (field.tableColHeaders && field.tableColHeaders[c-1]) || "";
            } else if (c === 0){
              cell.textContent = (field.tableRowHeaders && field.tableRowHeaders[r-1]) || "";
            } else {
              const key = "r" + r + "_c" + c;
              const cellInput = document.createElement("input");
              cellInput.type = "text";
              cellInput.autocomplete = "off";
              cellInput.style.cssText = "width:100%;min-width:70px;border:1px solid var(--line-strong);border-radius:5px;padding:5px 6px;font-size:.85rem;box-sizing:border-box;";
              cellInput.value = itState.table[key] || "";
              cellInput.addEventListener("input", () => {
                itState.table[key] = cellInput.value;
                saveDebounced();
              });
              cell.appendChild(cellInput);
            }
            tr.appendChild(cell);
          }
          tableEl.appendChild(tr);
        }
        tableWrap.appendChild(tableEl);
        itemDiv.appendChild(tableWrap);
      } else {
        const valArea = document.createElement("div");
        valArea.className = "note-area show";
        let input;
        if (field.type === "text"){
          input = document.createElement("textarea");
          input.placeholder = "Kirjaa tiedot…";
        } else if (field.type === "select"){
          input = document.createElement("select");
          input.style.cssText = "width:100%;border:1px solid var(--line-strong);border-radius:7px;padding:9px 10px;font-size:.95rem;font-family:inherit;background:#fff;";
          const emptyOpt = document.createElement("option");
          emptyOpt.value = ""; emptyOpt.textContent = "— valitse —";
          input.appendChild(emptyOpt);
          (field.options || []).forEach(optText => {
            const o = document.createElement("option");
            o.value = optText; o.textContent = optText;
            input.appendChild(o);
          });
        } else {
          input = document.createElement("input");
          input.type = field.type === "date" ? "date" : (field.type === "number" ? "number" : "text");
        }
        input.autocomplete = "off";
        input.value = itState.value || "";
        input.addEventListener("input", () => {
          itState.value = input.value;
          saveDebounced();
        });
        valArea.appendChild(input);
        if (field.unit){
          const unitSpan = document.createElement("div");
          unitSpan.style.cssText = "font-size:.76rem;color:var(--ink-soft);margin-top:4px;";
          unitSpan.textContent = "Yksikkö: " + field.unit;
          valArea.appendChild(unitSpan);
        }
        itemDiv.appendChild(valArea);
      }

      if (field.type === "checklist" ? (field.allowPhoto !== false) : !!field.allowPhoto){
        const photoRow = document.createElement("div");
        photoRow.className = "photo-row";
        itState.photos.forEach(p => {
          const thumb = document.createElement("div");
          thumb.className = "photo-thumb";
          const img = document.createElement("img");
          img.src = p.url;
          img.addEventListener("click", () => openPhotoView(p.url));
          const rm = document.createElement("button");
          rm.className = "rm";
          rm.textContent = "✕";
          rm.addEventListener("click", (e) => { e.stopPropagation(); removePhoto(itemId, p.id); });
          thumb.appendChild(img);
          thumb.appendChild(rm);
          photoRow.appendChild(thumb);
        });
        const addBtn = document.createElement("button");
        addBtn.className = "add-photo-btn";
        addBtn.type = "button";
        addBtn.textContent = "📷";
        addBtn.addEventListener("click", () => {
          pendingPhotoItemId = itemId;
          document.getElementById("cameraInput").click();
        });
        photoRow.appendChild(addBtn);
        itemDiv.appendChild(photoRow);
      }

      itemsWrap.appendChild(itemDiv);
    });

    secDiv.appendChild(itemsWrap);
    main.appendChild(secDiv);
  });

  updateProgress();
  renderQuickNav();
}

function renderQuickNav(){
  const wrap = document.getElementById("quickNav");
  if (!wrap) return;
  wrap.innerHTML = "";
  DEF.sections.forEach((sec, i) => {
    const { done, total, notes } = fieldCounts(sec);
    const chip = document.createElement("button");
    chip.type = "button";
    let cls = "qn-chip";
    if (done === total) cls += " qn-complete";
    else if (done > 0) cls += " qn-partial";
    if (notes > 0) cls += " qn-attention";
    if (openSections.has(sec.id)) cls += " qn-active";
    chip.className = cls;
    chip.textContent = String(i + 1);
    chip.title = sec.title + " (" + done + "/" + total + ")";
    chip.addEventListener("click", () => jumpToSection(sec.id));
    wrap.appendChild(chip);
  });
}

function jumpToSection(id){
  if (openSections.has(id) && openSections.size === 1) openSections.clear();
  else { openSections.clear(); openSections.add(id); }
  renderSections();
  if (openSections.has(id)){
    requestAnimationFrame(() => {
      const el = document.getElementById("sec_" + id);
      if (el) el.scrollIntoView({ behavior:"smooth", block:"start" });
    });
  }
}

function updateProgress(){
  const ids = allItemIds();
  const done = ids.filter(id => {
    const sf = sectionAndFieldOf(id);
    return sf && isFieldDone(sf.field, id);
  }).length;
  const pct = ids.length ? Math.round((done/ids.length)*100) : 0;
  document.getElementById("progressBar").style.width = pct + "%";
  document.getElementById("progressText").textContent = done + " / " + ids.length + " kohtaa käsitelty";
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

function openPhotoView(url){
  document.getElementById("photoViewImg").src = url;
  document.getElementById("photoView").classList.add("show");
}
document.getElementById("photoViewClose").addEventListener("click", () => {
  document.getElementById("photoView").classList.remove("show");
});
document.getElementById("photoView").addEventListener("click", (e) => {
  if (e.target.id === "photoView") document.getElementById("photoView").classList.remove("show");
});

let toastTimer = null;
function showToast(msg){
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 3200);
}

/* ---------- Tyhjennys ---------- */
function showConfirm(title, text, onOk){
  document.getElementById("confirmTitle").textContent = title;
  document.getElementById("confirmText").textContent = text;
  const backdrop = document.getElementById("confirmBackdrop");
  backdrop.classList.add("show");
  const okBtn = document.getElementById("confirmOk");
  const cancelBtn = document.getElementById("confirmCancel");
  const cleanup = () => {
    backdrop.classList.remove("show");
    okBtn.removeEventListener("click", onOkHandler);
    cancelBtn.removeEventListener("click", onCancelHandler);
  };
  const onOkHandler = () => { cleanup(); onOk(); };
  const onCancelHandler = () => { cleanup(); };
  okBtn.addEventListener("click", onOkHandler);
  cancelBtn.addEventListener("click", onCancelHandler);
}

document.getElementById("btnNew").addEventListener("click", () => {
  showConfirm(
    "Tyhjennä lomake?",
    "Kaikki tämänhetkiset tiedot, merkinnät ja kuvat poistetaan pysyvästi — myös pilvestä. Tätä ei voi perua.",
    async () => {
      Object.values(state.items).forEach(it => it.photos.forEach(p => URL.revokeObjectURL(p.url)));
      if (db) await idbClearAll();
      try{ await window.SubmissionSync.deleteSubmission(SUBMISSION_ID); }catch(e){}

      SUBMISSION_ID = window.SubmissionSync.newId();
      const params = new URLSearchParams(window.location.search);
      params.set("submission", SUBMISSION_ID);
      window.history.replaceState(null, "", window.location.pathname + "?" + params.toString());

      resetState();
      db = await openDb("dynsub_" + SUBMISSION_ID.replace(/-/g,"") + "_db");
      renderHeaderFields();
      renderSections();
      showToast("Lomake tyhjennetty. Uusi täyttö aloitettu.");
    }
  );
});

function resetState(){
  state = { header:{}, items:{} };
  allItemIds().forEach(id => state.items[id] = { status:DEFAULT_STATUS, note:"", action:"", value:"", table:{}, photos:[] });
}

/* ---------- .DOCX-VIENTI (jaettu DocxStyleEngine) ---------- */
let loadedDocStyle = null;

async function loadDocStyle(){
  try{
    const { data, error } = await window.__supabaseClient
      .from("doc_styles")
      .select("style")
      .eq("form_key", FORM_ID)
      .maybeSingle();
    if (error || !data){ loadedDocStyle = window.DocxStyleEngine.defaultStyle(); return; }
    const d = window.DocxStyleEngine.defaultStyle();
    const s = data.style || {};
    loadedDocStyle = {
      coverPage: Object.assign({}, d.coverPage, s.coverPage || {}),
      header: Object.assign({}, d.header, s.header || {}),
      footer: Object.assign({}, d.footer, s.footer || {}),
      fonts: Object.assign({}, d.fonts, s.fonts || {}),
      colors: Object.assign({}, d.colors, s.colors || {}),
      toc: Object.assign({}, d.toc, s.toc || {}),
      pagesBefore: s.pagesBefore || [],
      pagesAfter: s.pagesAfter || []
    };
  }catch(err){
    loadedDocStyle = window.DocxStyleEngine.defaultStyle();
  }
}

async function buildDocx(){
  const engine = window.DocxStyleEngine;
  const s = loadedDocStyle || engine.defaultStyle();
  const bodyParts = [];
  const extraMedia = [];
  let imgRelCounter = 200;   // pidetään selvästi erillään moottorin omista (10-13) rel-id:istä
  let imgDocPrCounter = 1000;

  const headerLines = (DEF.headerFields||[]).map(f => f.label + ": " + (state.header[f.id] || "—")).join("\n");
  bodyParts.push(engine.paraXml(headerLines, { font:s.fonts.body, sz:engine.pt2hp(s.fonts.bodySize), color:s.colors.body, after:240 }));

  DEF.sections.forEach((sec, secIdx) => {
    bodyParts.push(engine.paraXml((secIdx+1) + ". " + sec.title, { bold:true, sz:engine.pt2hp(s.fonts.headingSize), font:s.fonts.heading, color:s.colors.heading, pStyle:"Heading1", before:260, after:120 }));

    sec.fields.forEach((field) => {
      const itemId = sec.id + "_" + field.id;
      const it = state.items[itemId];
      bodyParts.push(engine.paraXml(field.label, { bold:true, font:s.fonts.body, sz:engine.pt2hp(s.fonts.bodySize), color:s.colors.body, after:20 }));

      if (field.type === "checklist"){
        const scheme = (DEF.statusScheme||[]).find(sc => sc.value === it.status) || { label:it.status, color:"8C8676" };
        const statusLine = scheme.label + (scheme.desc ? " — " + scheme.desc : "");
        bodyParts.push(engine.paraXml(statusLine, { color:(scheme.color||"#8C8676"), bold:true, font:s.fonts.body, sz:engine.pt2hp(s.fonts.bodySize), after:(it.note||it.action||it.photos.length)?40:120 }));
        if (it.note) bodyParts.push(engine.paraXml(it.note, { font:s.fonts.body, sz:engine.pt2hp(s.fonts.bodySize), color:s.colors.body, after:(it.action||it.photos.length)?60:140 }));
        if (it.action) bodyParts.push(engine.paraXml((field.actionLabel||"Lisätoimenpide") + ": " + it.action, { color:"33455C", font:s.fonts.body, sz:engine.pt2hp(s.fonts.bodySize), after: it.photos.length?60:140 }));
      } else if (field.type === "table"){
        const rows = field.tableRows || 3;
        const cols = field.tableCols || 3;
        const tableRows2D = [];
        for (let r = 0; r < rows; r++){
          const row = [];
          for (let c = 0; c < cols; c++){
            if (r === 0 && c === 0) row.push(field.tableCorner || "");
            else if (r === 0) row.push((field.tableColHeaders && field.tableColHeaders[c-1]) || "");
            else if (c === 0) row.push((field.tableRowHeaders && field.tableRowHeaders[r-1]) || "");
            else row.push((it.table && it.table["r"+r+"_c"+c]) || "");
          }
          tableRows2D.push(row);
        }
        bodyParts.push(engine.tableXml(tableRows2D, { headerRowCount:1, headerColCount:1, font:s.fonts.body, sz:engine.pt2hp(s.fonts.bodySize), color:s.colors.body }));
        bodyParts.push(engine.paraXml("", { after:140 }));
      } else {
        let displayVal = it.value || "—";
        if (field.type === "number" && field.unit && it.value) displayVal = it.value + " " + field.unit;
        bodyParts.push(engine.paraXml(displayVal, { font:s.fonts.body, sz:engine.pt2hp(s.fonts.bodySize), color:s.colors.body, after: it.photos.length ? 60 : 140 }));
      }

      for (const p of it.photos){
        const { cx, cy } = engine.scaledDims(p.w, p.h, 4938000);
        const rId = imgRelCounter++;
        const mediaName = "image" + (extraMedia.length+1) + ".jpeg";
        extraMedia.push({ rId, name: mediaName, blob: p.blob });
        bodyParts.push(engine.imageXml(rId, cx, cy, imgDocPrCounter++));
      }
    });
  });

  return engine.assembleDocx({ meta:{ title: DEF.meta.title }, bodyParts, style: s, extraMedia });
}


document.getElementById("btnExport").addEventListener("click", async () => {
  const btn = document.getElementById("btnExport");
  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = "Kootaan raporttia…";
  try{
    if (!loadedDocStyle) await loadDocStyle();
    const blob = await buildDocx();
    const titleSlug = (DEF.meta.title || "lomake").replace(/[^a-zA-Z0-9åäöÅÄÖ ]/g,"").trim().replace(/\s+/g,"_") || "lomake";
    const dateStr = new Date().toISOString().slice(0,10);
    const filename = titleSlug + "_" + dateStr + ".docx";
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    showToast("Raportti viety: " + filename);
  }catch(err){
    console.error(err);
    showToast("Raportin vienti epäonnistui. Yritä uudelleen.");
  }finally{
    btn.disabled = false;
    btn.textContent = originalText;
  }
});

document.getElementById("btnStyle").addEventListener("click", () => {
  const backUrl = "form.html?id=" + encodeURIComponent(FORM_ID);
  window.location.href = "style-editor.html?form=" + encodeURIComponent(FORM_ID) +
    "&label=" + encodeURIComponent(DEF.meta.title || "lomake") +
    "&back=" + encodeURIComponent(backUrl);
});

/* ---------- Käynnistys ---------- */
function waitForSupabaseClient(cb, triesLeft){
  if (typeof triesLeft !== "number") triesLeft = 100;
  if (window.__supabaseClient) return cb(window.__supabaseClient);
  if (triesLeft <= 0){ fatalError("Supabase-yhteyttä ei saatu muodostettua (auth-gate.js ei latautunut)."); return; }
  setTimeout(() => waitForSupabaseClient(cb, triesLeft - 1), 50);
}

function initSubmissionId(){
  const params = new URLSearchParams(window.location.search);
  let id = params.get("submission");
  if (!id){
    id = window.SubmissionSync.newId();
    params.set("submission", id);
    const newUrl = window.location.pathname + "?" + params.toString();
    window.history.replaceState(null, "", newUrl);
  }
  return id;
}

(async function init(){
  FORM_ID = new URLSearchParams(window.location.search).get("id");
  if (!FORM_ID){
    fatalError("Lomaketta ei löytynyt: osoitteesta puuttuu ?id=-parametri.");
    return;
  }

  waitForSupabaseClient(async (supabaseClient) => {
    try{
      const { data, error } = await supabaseClient.from("forms").select("*").eq("id", FORM_ID).single();
      if (error || !data){
        fatalError("Lomakepohjan lataus epäonnistui: " + (error ? error.message : "lomaketta ei löytynyt"));
        return;
      }
      DEF = data.definition;
      if (!DEF.statusScheme) DEF.statusScheme = [];
      if (!DEF.sections) DEF.sections = [];
      const defaultEntry = DEF.statusScheme.find(s => s.isDefault);
      DEFAULT_STATUS = defaultEntry ? defaultEntry.value : (DEF.statusScheme[0] ? DEF.statusScheme[0].value : "unchecked");

      document.title = (DEF.meta.title || "Lomake") + " — kenttälomake";
      document.getElementById("formTitleEl").textContent = DEF.meta.title || "Lomake";
      document.getElementById("formSubEl").textContent = DEF.meta.desc || "";
      document.getElementById("headerCardTitle").textContent = "Kohteen ja lomakkeen tiedot";

      resetState();

      SUBMISSION_ID = initSubmissionId();
      db = await openDb("dynsub_" + SUBMISSION_ID.replace(/-/g,"") + "_db");
      await loadFromStorage();

      renderHeaderFields();
      renderSections();
    }catch(err){
      fatalError("Odottamaton virhe lomaketta ladatessa: " + (err && err.message ? err.message : err));
    }
  });
})();
