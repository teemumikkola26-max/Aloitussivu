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
             label, allowPhoto?, allowAction?, actionLabel?, unit?, options?,
             hints?: [ { id, text, level:"info"|"warn", match:"all"|"any",
                         conditions:[ { source:"h:<headerFieldId>"|"f:<secId>_<fieldId>",
                                        op, values?, value?, value2? } ] } ] }
         ],
         hints?: [ ...samat kuin kentällä, näytetään osion alussa ]
       }
     ]
   }
   headerFields-kentän type voi olla myös "number" tai "select" (options).
   ========================================================================= */

let DEF = null;
let FORM_ID = null;
let SUBMISSION_ID = null;
let READ_ONLY = false;   // true, kun toinen käyttäjä täyttää samaa lomaketta
let DEFAULT_STATUS = "unchecked";
let state = { header:{}, items:{} };
let saveTimer = null;
let db = null;
const openSections = new Set();
let hintHolders = [];   // { el, hints, sec }
let sectionBadges = []; // { el, sec }

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
  // Käyttäjävalinta (tarkastuksen suorittaja) ei kelpaa lomakkeen otsikoksi.
  const userIds = {};
  ((DEF && DEF.headerFields) || []).forEach(h => { if (h.type === "user") userIds[h.id] = true; });
  const entry = Object.entries(state.header).find(([k, v]) => !userIds[k] && v && String(v).trim());
  return (entry && entry[1]) || (DEF && DEF.meta && DEF.meta.title) || "(nimetön kohde)";
}
// Lomakkeen "käyttäjä"-tyyppisistä kentistä ensimmäinen, johon on valittu henkilö.
function deriveInspector(){
  const f = ((DEF && DEF.headerFields) || []).find(h => h.type === "user" && state.header[h.id] && String(state.header[h.id]).trim());
  return f ? String(state.header[f.id]).trim() : "";
}

let cloudSyncInFlight = false;
function saveDebounced(){
  if (READ_ONLY) return;
  setSaveIndicator("Tallennetaan…");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(doSave, 500);
}
async function doSave(){
  if (READ_ONLY) return;
  await idbPut("meta", { key:"header", value: state.header });
  for (const id of Object.keys(state.items)){
    const it = state.items[id];
    await idbPut("items", { id, status: it.status, note: it.note, action: it.action, value: it.value, table: it.table });
  }
  setSaveIndicator("Tallennettu laitteelle…");
  syncToCloud();
}

async function syncToCloud(){
  if (READ_ONLY) return;
  if (cloudSyncInFlight) return;
  cloudSyncInFlight = true;
  try{
    for (const id of Object.keys(state.items)){
      const it = state.items[id];
      for (const p of it.photos){
        if (!p.path && p.blob){
          try{ p.path = await window.SubmissionSync.uploadPhoto(SUBMISSION_ID, "p" + p.id + ".jpg", p.blob); }catch(e){ console.warn("Valokuvan lataus pilveen epäonnistui", e); }
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
      title: deriveTitle(), inspectorName: deriveInspector(), data: { header: state.header, items: cloudItems }
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
          }catch(e){ console.warn("Yksittäisen kuvan lataus epäonnistui -- jatketaan muilla", e); }
        }
      }
      loadedFromCloud = true;
    }
  }catch(e){ console.warn("Ei pilviyhteyttä -- jatketaan paikallisella kopiolla", e); }

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

/* ---------- Kuvien katselu, poisto, piirto ja muodot ---------- */
const PV_COLORS = ["#e11d48","#facc15","#2563eb","#16a34a","#ffffff","#111111"];

function pvHtml(html){
  const d = document.createElement("div");
  d.innerHTML = html.trim();
  return d.firstElementChild;
}

async function openPhotoViewer(itemId, photo){
  let objUrl = null;
  let srcUrl = photo.url;
  if (photo.blob instanceof Blob){
    objUrl = URL.createObjectURL(photo.blob);
    srcUrl = objUrl;
  }
  if (!srcUrl){ showToast("Kuva ei ole saatavilla."); return; }
  const img = new Image();
  img.src = srcUrl;
  try{ await img.decode(); }catch(err){
    showToast("Kuvan avaaminen epäonnistui.");
    if (objUrl) URL.revokeObjectURL(objUrl);
    return;
  }
  const NW = img.naturalWidth, NH = img.naturalHeight;
  const overlay = pvHtml(`
    <div class="pv-overlay" role="dialog" aria-modal="true" aria-label="Kuva">
      <div class="pv-top">
        <button type="button" class="pv-btn" data-a="close">✕ Sulje</button>
        <span class="sp"></span>
        <button type="button" class="pv-btn danger" data-a="del" aria-label="Poista kuva">🗑 Poista</button>
      </div>
      <div class="pv-stage"><canvas></canvas></div>
      <div class="pv-tools">
        <div class="pv-row" data-row="tools"></div>
        <div class="pv-row" data-row="colors"></div>
        <div class="pv-row">
          <button type="button" class="pv-btn" data-a="undo" disabled>↶ Kumoa</button>
          <button type="button" class="pv-apply" data-a="apply" disabled>Tallenna merkinnät kuvaan</button>
        </div>
      </div>
    </div>
  `);
  const canvas = overlay.querySelector("canvas");
  canvas.width = NW;
  canvas.height = NH;
  const ctx = canvas.getContext("2d");
  let shapes = [], draft = null, tool = "view", color = PV_COLORS[0], level = 1, activeId = null;
  const WIDTHS = [.0035,.0065,.011];
  const lw = () => WIDTHS[level] * Math.max(NW, NH);

  function drawShape(c, sh){
    c.strokeStyle = sh.color; c.fillStyle = sh.color; c.lineWidth = sh.w;
    c.lineCap = "round"; c.lineJoin = "round";
    if (sh.t === "pen"){
      c.beginPath();
      sh.p.forEach(([x,y], i) => { i ? c.lineTo(x,y) : c.moveTo(x,y); });
      if (sh.p.length === 1) c.lineTo(sh.p[0][0] + .1, sh.p[0][1]);
      c.stroke();
    } else if (sh.t === "rect"){
      c.strokeRect(Math.min(sh.x0,sh.x1), Math.min(sh.y0,sh.y1), Math.abs(sh.x1-sh.x0), Math.abs(sh.y1-sh.y0));
    } else if (sh.t === "ellipse"){
      c.beginPath();
      c.ellipse((sh.x0+sh.x1)/2, (sh.y0+sh.y1)/2, Math.max(1,Math.abs(sh.x1-sh.x0)/2), Math.max(1,Math.abs(sh.y1-sh.y0)/2), 0, 0, Math.PI*2);
      c.stroke();
    } else if (sh.t === "arrow"){
      const a = Math.atan2(sh.y1-sh.y0, sh.x1-sh.x0);
      const head = Math.max(sh.w*4.5, .025*Math.max(NW,NH));
      c.beginPath(); c.moveTo(sh.x0, sh.y0);
      c.lineTo(sh.x1 - Math.cos(a)*head*.7, sh.y1 - Math.sin(a)*head*.7);
      c.stroke();
      c.beginPath(); c.moveTo(sh.x1, sh.y1);
      c.lineTo(sh.x1 - head*Math.cos(a-.42), sh.y1 - head*Math.sin(a-.42));
      c.lineTo(sh.x1 - head*Math.cos(a+.42), sh.y1 - head*Math.sin(a+.42));
      c.closePath(); c.fill();
    }
  }
  function redraw(){
    ctx.drawImage(img, 0, 0, NW, NH);
    shapes.forEach(sh => drawShape(ctx, sh));
    if (draft) drawShape(ctx, draft);
  }
  redraw();

  const undoBtn = overlay.querySelector('[data-a="undo"]');
  const applyBtn = overlay.querySelector('[data-a="apply"]');
  const syncButtons = () => { undoBtn.disabled = !shapes.length; applyBtn.disabled = !shapes.length; };

  const toolRow = overlay.querySelector('[data-row="tools"]');
  function setTool(t){
    tool = t;
    [...toolRow.children].forEach(b => b.setAttribute("aria-pressed", String(b.dataset.tool === t)));
    canvas.style.touchAction = t === "view" ? "auto" : "none";
  }
  [["view","✋ Katsele"],["pen","✏ Kynä"],["ellipse","◯ Ympyrä"],["rect","▭ Nelikulmio"],["arrow","➚ Nuoli"]].forEach(([t,label]) => {
    const b = pvHtml(`<button type="button" class="pv-btn" data-tool="${t}">${label}</button>`);
    b.onclick = () => setTool(t);
    toolRow.appendChild(b);
  });
  setTool("view");

  const colorRow = overlay.querySelector('[data-row="colors"]');
  PV_COLORS.forEach((c, i) => {
    const b = pvHtml(`<button type="button" class="pv-sw" aria-label="Väri ${i+1}" style="background:${c}"></button>`);
    b.setAttribute("aria-pressed", String(i === 0));
    b.onclick = () => {
      color = c;
      [...colorRow.querySelectorAll(".pv-sw")].forEach(x => x.setAttribute("aria-pressed","false"));
      b.setAttribute("aria-pressed","true");
      if (tool === "view") setTool("pen");
    };
    colorRow.appendChild(b);
  });
  [["S",0],["M",1],["L",2]].forEach(([label, lv]) => {
    const b = pvHtml(`<button type="button" class="pv-btn" data-w="${lv}" style="min-width:44px;padding:0 8px;">${label}</button>`);
    b.setAttribute("aria-pressed", String(lv === level));
    b.onclick = () => {
      level = lv;
      [...colorRow.querySelectorAll("[data-w]")].forEach(x => x.setAttribute("aria-pressed", String(Number(x.dataset.w) === lv)));
    };
    colorRow.appendChild(b);
  });

  const toImg = ev => {
    const rc = canvas.getBoundingClientRect();
    return [(ev.clientX-rc.left)*NW/rc.width, (ev.clientY-rc.top)*NH/rc.height];
  };
  canvas.addEventListener("pointerdown", ev => {
    if (tool === "view" || !ev.isPrimary) return;
    ev.preventDefault();
    activeId = ev.pointerId;
    try{ canvas.setPointerCapture(ev.pointerId); }catch(e){}
    const [x,y] = toImg(ev);
    draft = tool === "pen" ? { t:"pen", color, w:lw(), p:[[x,y]] } : { t:tool, color, w:lw(), x0:x, y0:y, x1:x, y1:y };
    redraw();
  });
  canvas.addEventListener("pointermove", ev => {
    if (!draft || ev.pointerId !== activeId) return;
    const [x,y] = toImg(ev);
    if (draft.t === "pen") draft.p.push([x,y]); else { draft.x1 = x; draft.y1 = y; }
    redraw();
  });
  const endDraw = ev => {
    if (!draft || ev.pointerId !== activeId) return;
    const d = draft; draft = null; activeId = null;
    if (d.t === "pen" || Math.hypot(d.x1-d.x0, d.y1-d.y0) > Math.max(NW,NH)*.01) shapes.push(d);
    redraw(); syncButtons();
  };
  canvas.addEventListener("pointerup", endDraw);
  canvas.addEventListener("pointercancel", endDraw);
  undoBtn.onclick = () => { shapes.pop(); redraw(); syncButtons(); };

  const closeViewer = () => { if (objUrl) URL.revokeObjectURL(objUrl); overlay.remove(); };
  overlay.querySelector('[data-a="close"]').onclick = () => {
    if (shapes.length && !confirm("Hylätäänkö tallentamattomat merkinnät?")) return;
    closeViewer();
  };
  overlay.querySelector('[data-a="del"]').onclick = () => {
    if (!confirm("Poistetaanko kuva?")) return;
    closeViewer();
    removePhoto(itemId, photo.id);
  };
  applyBtn.onclick = async () => {
    applyBtn.disabled = true;
    redraw();
    const blob = await new Promise(res => canvas.toBlob(res, "image/jpeg", .9));
    if (!blob){ showToast("Tallennus epäonnistui."); applyBtn.disabled = false; return; }
    try{ URL.revokeObjectURL(photo.url); }catch(e){}
    photo.blob = blob;
    photo.url = URL.createObjectURL(blob);
    photo.w = NW; photo.h = NH;
    /* Sama tiedostonimi ylikirjoitetaan pilvessä seuraavassa synkronoinnissa. */
    photo.path = null;
    if (db){
      try{ await idbPut("photos", { id: photo.id, itemId, blob, w: NW, h: NH, ts: Date.now() }); }catch(e){ console.warn(e); }
    }
    closeViewer();
    renderSections();
    saveDebounced();
    showToast("Merkinnät tallennettu kuvaan.");
  };
  document.body.appendChild(overlay);
}

/* ---------- Sanelu (puheentunnistus) ---------- */
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
let activeDictation = null;

function stopDictation(){
  if (activeDictation){
    activeDictation.stopped = true;
    try{ activeDictation.rec.stop(); }catch(e){}
  }
}
document.addEventListener("visibilitychange", () => { if (document.hidden) stopDictation(); });

/* Palauttaa kentän ympäröivän kääreen, jossa on 🎤-painike (jos selain tukee). */
function withDictation(input){
  if (!SpeechRec) return input;
  const wrap = document.createElement("div");
  wrap.className = "dict-wrap " + (input.tagName === "TEXTAREA" ? "ta" : "in");
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "dictate-btn";
  btn.textContent = "🎤";
  btn.title = "Sanele";
  btn.setAttribute("aria-label", "Sanele");
  wrap.appendChild(input);
  wrap.appendChild(btn);
  const setRec = on => {
    btn.classList.toggle("rec", on);
    btn.textContent = on ? "⏹" : "🎤";
    btn.setAttribute("aria-label", on ? "Lopeta sanelu" : "Sanele");
  };
  btn.addEventListener("click", () => {
    if (activeDictation && activeDictation.btn === btn){ stopDictation(); return; }
    stopDictation();
    const rec = new SpeechRec();
    rec.lang = "fi-FI";
    rec.continuous = true;
    rec.interimResults = true;
    const st = { rec, btn, stopped:false };
    let base = input.value;
    const sep = () => base && !/\s$/.test(base) ? " " : "";
    rec.onresult = e => {
      /* Android toistaa saman lauseen kasvavina osittaistuloksina -- yhdistetään ne. */
      const pieces = [];
      for (let i = 0; i < e.results.length; i++){
        const t = String(e.results[i][0].transcript || "").trim();
        if (!t) continue;
        const last = pieces.length ? pieces[pieces.length-1] : null;
        const tl = t.toLowerCase();
        if (last !== null && tl.startsWith(last.toLowerCase())) pieces[pieces.length-1] = t;
        else if (last !== null && last.toLowerCase().startsWith(tl)) continue;
        else pieces.push(t);
      }
      const txt = pieces.join(" ").trim();
      if (!txt) return;
      input.value = base + sep() + txt;
      input.dispatchEvent(new Event("input", { bubbles:true }));
    };
    rec.onerror = e => {
      const err = e.error;
      if (err === "no-speech" || err === "aborted") return;
      st.stopped = true;
      if (err === "not-allowed" || err === "service-not-allowed") showToast("Mikrofonin käyttö on estetty selaimen asetuksissa.");
      else if (err === "network") showToast("Sanelu vaatii verkkoyhteyden.");
      else if (err === "audio-capture") showToast("Mikrofonia ei löytynyt.");
      else showToast("Sanelu epäonnistui.");
    };
    rec.onend = () => {
      if (!st.stopped && activeDictation === st){
        base = input.value;
        try{ rec.start(); return; }catch(e){}
      }
      setRec(false);
      if (activeDictation === st) activeDictation = null;
    };
    activeDictation = st;
    try{ rec.start(); setRec(true); }catch(err){ activeDictation = null; showToast("Sanelua ei voitu käynnistää."); }
  });
  return wrap;
}

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
  // Uuteen lomakkeeseen esivalitaan laitteella aktiivinen käyttäjä.
  const freshForm = !Object.keys(state.header).length;
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
    } else if (f.type === "user"){
      input = document.createElement("select");
      input.style.cssText = "width:100%;border:1px solid var(--line-strong);border-radius:7px;padding:9px 10px;font-size:.95rem;font-family:inherit;background:#fff;";
      if (freshForm && !state.header[f.id] && window.AppUsers && window.AppUsers.getActive()){
        state.header[f.id] = window.AppUsers.getActive();
      }
      if (window.AppUsers) window.AppUsers.populateSelect(input, state.header[f.id] || "");
      window.addEventListener("appusers:changed", () => {
        if (window.AppUsers && document.body.contains(input)) window.AppUsers.populateSelect(input, state.header[f.id] || "");
      });
    } else if (f.type === "select"){
      input = document.createElement("select");
      input.style.cssText = "width:100%;border:1px solid var(--line-strong);border-radius:7px;padding:9px 10px;font-size:.95rem;font-family:inherit;background:#fff;";
      const emptyOpt = document.createElement("option");
      emptyOpt.value = ""; emptyOpt.textContent = "— valitse —";
      input.appendChild(emptyOpt);
      (f.options || []).forEach(optText => {
        const o = document.createElement("option");
        o.value = optText; o.textContent = optText;
        input.appendChild(o);
      });
    } else {
      input = document.createElement("input");
      input.type = f.type === "date" ? "date" : (f.type === "number" ? "number" : "text");
      if (f.type === "number"){ input.inputMode = "decimal"; input.step = "any"; }
    }
    input.id = "hf_" + f.id;
    input.autocomplete = "off";
    input.value = state.header[f.id] || "";
    input.addEventListener("input", () => {
      state.header[f.id] = input.value;
      refreshHints();
      saveDebounced();
    });
    div.appendChild(input);
    wrap.appendChild(div);
  });
}

/* ---------- Ehdolliset ohjeet ---------- */
function getSourceValue(src){
  if (typeof src !== "string") return null;
  if (src.indexOf("h:") === 0) return state.header[src.slice(2)];
  if (src.indexOf("f:") === 0){
    const it = state.items[src.slice(2)];
    return it ? it.value : null;
  }
  return null;
}

function condMet(c){
  const raw = getSourceValue(c.source);
  if (raw == null || String(raw).trim() === "") return false;   // ei vielä vastattu -> ehto ei täyty
  if (c.op === "is") return (c.values || []).indexOf(String(raw)) !== -1;
  if (c.op === "isnot") return (c.values || []).indexOf(String(raw)) === -1;
  const n = parseFloat(String(raw).replace(",", "."));
  if (isNaN(n)) return false;
  const a = parseFloat(String(c.value).replace(",", "."));
  const b = parseFloat(String(c.value2).replace(",", "."));
  switch (c.op){
    case "lt":  return !isNaN(a) && n <  a;
    case "lte": return !isNaN(a) && n <= a;
    case "gt":  return !isNaN(a) && n >  a;
    case "gte": return !isNaN(a) && n >= a;
    case "eq":  return !isNaN(a) && n === a;
    case "between": return !isNaN(a) && !isNaN(b) && n >= Math.min(a,b) && n <= Math.max(a,b);
  }
  return false;
}

function hintActive(h){
  if (!h || !h.text || !String(h.text).trim()) return false;
  const conds = h.conditions || [];
  if (!conds.length) return true;                                // ei ehtoja -> näytetään aina
  return h.match === "any" ? conds.some(condMet) : conds.every(condMet);
}

function renderHintBoxes(container, active){
  container.innerHTML = "";
  active.forEach(h => {
    const box = document.createElement("div");
    box.className = "hint-box " + (h.level === "warn" ? "hint-warn" : "hint-info");
    const label = document.createElement("div");
    label.className = "hint-label";
    label.textContent = h.level === "warn" ? "⚠️ Huomio" : "💡 Ohje";
    const text = document.createElement("div");
    text.className = "hint-text";
    text.textContent = h.text;
    box.appendChild(label);
    box.appendChild(text);
    container.appendChild(box);
  });
}

function refreshHints(){
  const counts = new Map();
  hintHolders.forEach(h => {
    const active = (h.hints || []).filter(hintActive);
    renderHintBoxes(h.el, active);
    counts.set(h.sec, (counts.get(h.sec) || 0) + active.length);
  });
  sectionBadges.forEach(b => {
    const n = counts.get(b.sec) || 0;
    b.el.textContent = n ? ("💡" + n) : "";
    b.el.style.display = n ? "" : "none";
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

/*
 * Lomakkeen kolme tasoa: ryhmä (valinnainen, sec.group) > osio > kenttä.
 * Peräkkäiset osiot, joilla on sama ryhmän nimi, kuuluvat samaan ryhmään.
 * Ryhmätön osio on ylimmällä tasolla. Sama logiikka numeroi Word-otsikot (1, 1.1).
 */
function computeSectionNumbering(){
  let top = 0, sub = 0, lastGroup = null;
  return DEF.sections.map(sec => {
    const g = String(sec.group || "").trim();
    if (g){
      const newGroup = g !== lastGroup;
      if (newGroup){ top++; sub = 0; lastGroup = g; }
      sub++;
      return { group:g, groupStart:newGroup, groupNum:top, label: top + "." + sub };
    }
    top++; sub = 0; lastGroup = null;
    return { group:"", groupStart:false, groupNum:top, label:String(top) };
  });
}

function renderSections(){
  stopDictation();
  const main = document.getElementById("sections");
  main.innerHTML = "";
  hintHolders = [];
  sectionBadges = [];
  const secNums = computeSectionNumbering();
  DEF.sections.forEach((sec, secIdx) => {
    const { done, total, notes } = fieldCounts(sec);
    if (secNums[secIdx].groupStart){
      const gh = document.createElement("div");
      gh.className = "group-head";
      gh.innerHTML = '<span class="section-num">' + secNums[secIdx].groupNum + '</span><span>' + escapeHtml(secNums[secIdx].group) + '</span>';
      main.appendChild(gh);
    }
    const secDiv = document.createElement("div");
    secDiv.className = "section" + (openSections.has(sec.id) ? " open" : "");
    secDiv.id = "sec_" + sec.id;

    const head = document.createElement("div");
    head.className = "section-head";
    head.innerHTML =
      '<div class="section-title-wrap"><span class="section-num">' + secNums[secIdx].label + '</span>' +
      '<h2>' + escapeHtml(sec.title) + '</h2></div>' +
      '<span class="hint-badge" data-badge style="display:none"></span>' +
      '<span class="section-count ' + (done===total?'complete':(notes>0?'has-notes':'')) + '">' + done + '/' + total + '</span>' +
      '<span class="chevron"></span>';
    sectionBadges.push({ el: head.querySelector("[data-badge]"), sec });
    head.addEventListener("click", () => {
      if (openSections.has(sec.id)) openSections.delete(sec.id); else openSections.add(sec.id);
      renderSections();
    });
    secDiv.appendChild(head);

    const itemsWrap = document.createElement("div");
    itemsWrap.className = "section-items";

    const secHintHolder = document.createElement("div");
    secHintHolder.className = "hint-holder hint-holder-section";
    itemsWrap.appendChild(secHintHolder);
    hintHolders.push({ el: secHintHolder, hints: sec.hints || [], sec });

    sec.fields.forEach((field) => {
      const itemId = sec.id + "_" + field.id;
      const itState = state.items[itemId];
      const itemDiv = document.createElement("div");
      itemDiv.className = "item";

      const textDiv = document.createElement("div");
      textDiv.className = "item-text";
      textDiv.textContent = field.label;
      itemDiv.appendChild(textDiv);

      const fieldHintHolder = document.createElement("div");
      fieldHintHolder.className = "hint-holder";
      itemDiv.appendChild(fieldHintHolder);
      hintHolders.push({ el: fieldHintHolder, hints: field.hints || [], sec });

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
        noteArea.appendChild(withDictation(noteTextarea));
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
          actionArea.appendChild(withDictation(actionInput));
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
        const fixedFirstCol = !!field.tableFixedFirstCol;
        for (let r = 0; r < rows; r++){
          const tr = document.createElement("tr");
          for (let c = 0; c < cols; c++){
            const isHeaderCell = (r === 0) || (c === 0 && fixedFirstCol);
            const cell = document.createElement(isHeaderCell ? "th" : "td");
            cell.style.cssText = "border:1px solid var(--line-strong);padding:6px 8px;text-align:left;" +
              (isHeaderCell ? "background:#f1efe8;font-weight:600;white-space:nowrap;" : "");
            if (r === 0 && c === 0){
              cell.textContent = field.tableCorner || "";
            } else if (r === 0){
              cell.textContent = (field.tableColHeaders && field.tableColHeaders[c-1]) || "";
            } else if (c === 0 && fixedFirstCol){
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
          refreshHints();
          saveDebounced();
        });
        valArea.appendChild((field.type === "text" || (input.tagName === "INPUT" && input.type === "text")) ? withDictation(input) : input);
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
          img.addEventListener("click", () => openPhotoViewer(itemId, p));
          img.alt = "Avaa kuva";
          const rm = document.createElement("button");
          rm.className = "rm";
          rm.textContent = "✕";
          rm.setAttribute("aria-label", "Poista kuva");
          rm.addEventListener("click", (e) => { e.stopPropagation(); if (confirm("Poistetaanko kuva?")) removePhoto(itemId, p.id); });
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

  refreshHints();
  updateProgress();
  renderQuickNav();
}

function renderQuickNav(){
  const wrap = document.getElementById("quickNav");
  if (!wrap) return;
  wrap.innerHTML = "";
  const secNums = computeSectionNumbering();
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
    chip.textContent = secNums[i].label;
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
      try{ await window.SubmissionSync.deleteSubmission(SUBMISSION_ID); }catch(e){ console.warn("Lomaketäytön poisto pilvestä epäonnistui", e); }

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
    loadedDocStyle = window.DocxStyleEngine.mergeStyle(data.style);
    await fetchDocxAttachments(loadedDocStyle);
  }catch(err){
    loadedDocStyle = window.DocxStyleEngine.defaultStyle();
  }
}

/*
 * Hakee käyttäjän lataamat .docx-liitteet (kansilehti ja/tai vakiotekstisivut)
 * Supabase Storagesta ja liittää tavut _docxBytes-kenttään, jota
 * docx-style-engine.js käyttää altChunk-upotukseen. Jos haku epäonnistuu,
 * kenttä jää tyhjäksi ja moottori näyttää huomautuksen sen paikalla.
 */
async function fetchDocxAttachment(path){
  try{
    const { data, error } = await window.__supabaseClient.storage.from("submission-photos").download(path);
    if (error || !data) return null;
    return await data.arrayBuffer();
  }catch(err){
    console.warn("Word-liitteen haku epäonnistui", path, err);
    return null;
  }
}

async function fetchDocxAttachments(s){
  if (s.coverPage && s.coverPage.sourceMode === "docx" && s.coverPage.docxPath){
    s.coverPage._docxBytes = await fetchDocxAttachment(s.coverPage.docxPath);
  }
  for (const page of (s.pagesBefore || []).concat(s.pagesAfter || [])){
    if (page.sourceMode === "docx" && page.docxPath){
      page._docxBytes = await fetchDocxAttachment(page.docxPath);
    }
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

  const secNums = computeSectionNumbering();
  const fieldsAsHeadings = !(s.headingNumbering && s.headingNumbering.fieldHeadings === false);
  DEF.sections.forEach((sec, secIdx) => {
    const nm = secNums[secIdx];
    if (nm.groupStart){
      // Taso 1: ryhmä = Heading1; sen alla osiot Heading2 (numerointi 1 / 1.1)
      bodyParts.push(engine.paraXml(nm.group, { bold:true, sz:engine.pt2hp(s.fonts.headingSize), font:s.fonts.heading, color:s.colors.heading, pStyle:"Heading1", before:260, after:120 }));
    }
    if (nm.group){
      bodyParts.push(engine.paraXml(sec.title, { bold:true, sz:engine.pt2hp(s.fonts.subheadingSize || 11), font:s.fonts.heading, color:s.colors.heading, pStyle:"Heading2", before:200, after:100 }));
    } else {
      bodyParts.push(engine.paraXml(sec.title, { bold:true, sz:engine.pt2hp(s.fonts.headingSize), font:s.fonts.heading, color:s.colors.heading, pStyle:"Heading1", before:260, after:120 }));
    }

    sec.fields.forEach((field) => {
      const itemId = sec.id + "_" + field.id;
      const it = state.items[itemId];
      if (fieldsAsHeadings){
        // Taso 3: kenttä = otsikko (ryhmällisessä lomakkeessa Heading3 = 1.1.1, ryhmättömässä Heading2 = 1.1)
        bodyParts.push(engine.paraXml(field.label, { bold:true, sz:engine.pt2hp(s.fonts.subheadingSize || 11), font:s.fonts.heading, color:s.colors.heading, pStyle: nm.group ? "Heading3" : "Heading2", before:120, after:40 }));
      } else {
        bodyParts.push(engine.paraXml(field.label, { bold:true, font:s.fonts.body, sz:engine.pt2hp(s.fonts.bodySize), color:s.colors.body, after:20 }));
      }

      if (field.type === "checklist"){
        const scheme = (DEF.statusScheme||[]).find(sc => sc.value === it.status) || { label:it.status, color:"8C8676" };
        const statusLine = scheme.label + (scheme.desc ? " — " + scheme.desc : "");
        bodyParts.push(engine.paraXml(statusLine, { color:(scheme.color||"#8C8676"), bold:true, font:s.fonts.body, sz:engine.pt2hp(s.fonts.bodySize), after:(it.note||it.action||it.photos.length)?40:120 }));
        if (it.note) bodyParts.push(engine.paraXml(it.note, { font:s.fonts.body, sz:engine.pt2hp(s.fonts.bodySize), color:s.colors.body, after:(it.action||it.photos.length)?60:140 }));
        if (it.action) bodyParts.push(engine.paraXml((field.actionLabel||"Lisätoimenpide") + ": " + it.action, { color:"33455C", font:s.fonts.body, sz:engine.pt2hp(s.fonts.bodySize), after: it.photos.length?60:140 }));
      } else if (field.type === "table"){
        const rows = field.tableRows || 3;
        const cols = field.tableCols || 3;
        const fixedFirstCol = !!field.tableFixedFirstCol;
        const tableRows2D = [];
        for (let r = 0; r < rows; r++){
          const row = [];
          for (let c = 0; c < cols; c++){
            if (r === 0 && c === 0) row.push(field.tableCorner || "");
            else if (r === 0) row.push((field.tableColHeaders && field.tableColHeaders[c-1]) || "");
            else if (c === 0 && fixedFirstCol) row.push((field.tableRowHeaders && field.tableRowHeaders[r-1]) || "");
            else row.push((it.table && it.table["r"+r+"_c"+c]) || "");
          }
          tableRows2D.push(row);
        }
        bodyParts.push(engine.tableXml(tableRows2D, { headerRowCount:1, headerColCount:(fixedFirstCol?1:0), font:s.fonts.body, sz:engine.pt2hp(s.fonts.bodySize), color:s.colors.body }));
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


/* ---------- "Käytössä"-merkintä ja varoitus samanaikaisesta täytöstä ---------- */
const LOCK_STALE_MS = 120000;   // merkintä vanhenee, jos sykettä ei ole 2 minuuttiin
const LOCK_BEAT_MS = 30000;
let lockTimer = null;
let lockBanner = null;

function lockUserLabel(){
  return (window.AppUsers && window.AppUsers.getActive()) || "";
}
function lockIsFresh(lock){
  if (!lock || !lock.locked_at) return false;
  const t = new Date(lock.locked_at).getTime();
  return isFinite(t) && (Date.now() - t) < LOCK_STALE_MS;
}
function lockIsForeign(lock){
  return lockIsFresh(lock) && lock.device_id !== window.SubmissionSync.deviceId();
}
function lockWho(lock){
  return (lock && lock.user_name) ? lock.user_name : "Toinen käyttäjä";
}

function setFormInert(on){
  ["headerCard", "sections"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.inert = !!on;
  });
  ["btnNew", "btnStyle"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = !!on;
  });
}

function showLockBanner(html, buttons, tone){
  if (!lockBanner){
    lockBanner = document.createElement("div");
    lockBanner.setAttribute("role", "status");
    const top = document.querySelector("header.topbar");
    if (top) top.insertAdjacentElement("afterend", lockBanner);
    else document.body.insertBefore(lockBanner, document.body.firstChild);
  }
  const bg = tone === "ok" ? "#e6f4ea" : "#fff7e0";
  const bd = tone === "ok" ? "#8fb79c" : "#e5c76b";
  lockBanner.style.cssText = "margin:12px 14px;padding:12px 14px;border:1px solid " + bd + ";background:" + bg +
    ";border-radius:10px;font-size:.9rem;color:#1c2430;";
  lockBanner.innerHTML = '<div style="margin-bottom:8px;">' + html + '</div><div class="lock-actions" style="display:flex;gap:8px;flex-wrap:wrap;"></div>';
  const row = lockBanner.querySelector(".lock-actions");
  (buttons || []).forEach(b => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn " + (b.primary ? "btn-primary" : "btn-secondary");
    btn.style.cssText = "min-height:44px;padding:8px 14px;";
    btn.textContent = b.label;
    btn.addEventListener("click", b.onClick);
    row.appendChild(btn);
  });
}
function hideLockBanner(){
  if (lockBanner){ lockBanner.remove(); lockBanner = null; }
}

async function enterReadOnly(lock){
  if (!READ_ONLY){
    // Tallenna omat viimeiset muutokset ennen lukitusta
    try{ clearTimeout(saveTimer); await doSave(); }catch(e){}
  }
  READ_ONLY = true;
  setFormInert(true);
  setSaveIndicator("Vain luku -tila");
  const who = escapeHtml(lockWho(lock));
  showLockBanner(
    "🔒 <strong>" + who + "</strong> täyttää tätä lomaketta parhaillaan. Lomake on vain luku -tilassa, jotta muutokset eivät ylikirjoitu.",
    [
      { label:"Päivitä tila", onClick: checkLockStatus },
      { label:"Ota silti käyttöön", onClick: takeOverLock }
    ],
    "warn"
  );
}

async function checkLockStatus(){
  const lock = await window.SubmissionSync.getLock(SUBMISSION_ID);
  if (!lockIsForeign(lock)){
    showLockBanner(
      "✅ Lomake on nyt vapaana. Lataa uusin versio ja jatka täyttöä.",
      [{ label:"Lataa ja jatka", primary:true, onClick: async () => {
          await window.SubmissionSync.touchLock(SUBMISSION_ID, lockUserLabel());
          window.location.reload();
      } }],
      "ok"
    );
  } else {
    enterReadOnly(lock);
  }
}

async function takeOverLock(){
  if (!confirm("Toinen käyttäjä on merkitty täyttämään tätä lomaketta. Jos otat lomakkeen käyttöösi, hänen tallentamattomat muutoksensa voivat hävitä.\n\nOtetaanko lomake silti käyttöön?")) return;
  await window.SubmissionSync.touchLock(SUBMISSION_ID, lockUserLabel());
  window.location.reload();
}

async function lockBeat(){
  if (!SUBMISSION_ID || READ_ONLY) return;
  if (document.visibilityState === "hidden") return;
  const lock = await window.SubmissionSync.getLock(SUBMISSION_ID);
  if (lockIsForeign(lock)){ enterReadOnly(lock); return; }
  window.SubmissionSync.touchLock(SUBMISSION_ID, lockUserLabel());
}

async function startUsageLock(){
  if (!window.SubmissionSync || !SUBMISSION_ID) return;
  const lock = await window.SubmissionSync.getLock(SUBMISSION_ID);
  if (lockIsForeign(lock)){
    await enterReadOnly(lock);
    // Seurataan tilannetta: kun lomake vapautuu, ilmoitetaan siitä.
    lockTimer = setInterval(async () => {
      const l = await window.SubmissionSync.getLock(SUBMISSION_ID);
      if (!lockIsForeign(l)){ clearInterval(lockTimer); checkLockStatus(); }
    }, 20000);
    return;
  }
  window.SubmissionSync.touchLock(SUBMISSION_ID, lockUserLabel());
  lockTimer = setInterval(lockBeat, LOCK_BEAT_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") lockBeat();
  });
  const release = () => { if (!READ_ONLY) window.SubmissionSync.releaseLock(SUBMISSION_ID); };
  window.addEventListener("pagehide", release);
  // "← Omat lomakkeet" -linkki vapauttaa merkinnän ennen siirtymistä
  const back = document.querySelector('header.topbar a[href="index.html"]');
  if (back){
    back.addEventListener("click", async (e) => {
      if (READ_ONLY) return;
      e.preventDefault();
      try{
        await Promise.race([
          window.SubmissionSync.releaseLock(SUBMISSION_ID),
          new Promise(r => setTimeout(r, 1500))
        ]);
      }catch(err){}
      window.location.href = "index.html";
    });
  }
}

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
      await startUsageLock();
    }catch(err){
      fatalError("Odottamaton virhe lomaketta ladatessa: " + (err && err.message ? err.message : err));
    }
  });
})();
