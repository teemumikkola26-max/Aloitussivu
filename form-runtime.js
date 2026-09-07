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
function saveDebounced(){
  setSaveIndicator("Tallennetaan…");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(doSave, 500);
}
async function doSave(){
  await idbPut("meta", { key:"header", value: state.header });
  for (const id of Object.keys(state.items)){
    const it = state.items[id];
    await idbPut("items", { id, status: it.status, note: it.note, action: it.action, value: it.value });
  }
  setSaveIndicator("Tallennettu");
}

async function loadFromStorage(){
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
    }
  });

  const photoRows = await idbGetAll("photos");
  photoRows.forEach(row => {
    if (state.items[row.itemId]){
      const url = URL.createObjectURL(row.blob);
      state.items[row.itemId].photos.push({ id: row.id, blob: row.blob, url, w: row.w, h: row.h });
    }
  });
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
  arr.splice(idx, 1);
  if (db) idbDelete("photos", photoId);
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
    "Kaikki tämänhetkiset tiedot, merkinnät ja kuvat poistetaan pysyvästi tästä laitteesta. Tätä ei voi perua.",
    async () => {
      Object.values(state.items).forEach(it => it.photos.forEach(p => URL.revokeObjectURL(p.url)));
      if (db) await idbClearAll();
      resetState();
      renderHeaderFields();
      renderSections();
      showToast("Lomake tyhjennetty.");
    }
  );
});

function resetState(){
  state = { header:{}, items:{} };
  allItemIds().forEach(id => state.items[id] = { status:DEFAULT_STATUS, note:"", action:"", value:"", photos:[] });
}

/* ---------- .DOCX-VIENTI ---------- */
function xmlEsc(s){
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
function paraXml(text, opts){
  opts = opts || {};
  const rPr = [];
  if (opts.bold) rPr.push("<w:b/>");
  if (opts.color) rPr.push('<w:color w:val="' + opts.color + '"/>');
  if (opts.sz) rPr.push('<w:sz w:val="' + opts.sz + '"/><w:szCs w:val="' + opts.sz + '"/>');
  const pPr = [];
  if (opts.before || opts.after){
    pPr.push('<w:spacing' + (opts.before?' w:before="'+opts.before+'"':'') + (opts.after?' w:after="'+opts.after+'"':'') + '/>');
  }
  const lines = String(text == null ? "" : text).split(/\r?\n/);
  const runs = lines.map((line, i) => (i>0?"<w:br/>":"") + '<w:t xml:space="preserve">' + xmlEsc(line) + '</w:t>').join("");
  return '<w:p>' + (pPr.length?'<w:pPr>'+pPr.join('')+'</w:pPr>':'') + '<w:r>' + (rPr.length?'<w:rPr>'+rPr.join('')+'</w:rPr>':'') + runs + '</w:r></w:p>';
}
function imageXml(rId, cx, cy, docPrId){
  return '<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="'+cx+'" cy="'+cy+'"/><wp:docPr id="'+docPrId+'" name="Kuva'+docPrId+'"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="'+docPrId+'" name="Kuva'+docPrId+'"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId'+rId+'"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="'+cx+'" cy="'+cy+'"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
}

async function buildDocx(){
  const bodyParts = [];
  const relParts = [];
  const mediaFiles = [];
  let relCounter = 4;
  let docPrCounter = 100;

  bodyParts.push(paraXml(DEF.meta.title || "Lomake", { bold:true, sz:44, after:80 }));
  if (DEF.meta.desc){
    bodyParts.push(paraXml(DEF.meta.desc, { color:"4A5568", sz:18, after:200 }));
  }
  const headerLines = (DEF.headerFields||[]).map(f => f.label + ": " + (state.header[f.id] || "—")).join("\n");
  bodyParts.push(paraXml(headerLines, { after:240 }));

  DEF.sections.forEach((sec, secIdx) => {
    bodyParts.push(paraXml((secIdx+1) + ". " + sec.title, { bold:true, sz:28, before:260, after:120 }));

    sec.fields.forEach((field) => {
      const itemId = sec.id + "_" + field.id;
      const it = state.items[itemId];
      bodyParts.push(paraXml(field.label, { bold:true, after:20 }));

      if (field.type === "checklist"){
        const scheme = (DEF.statusScheme||[]).find(s => s.value === it.status) || { label:it.status, color:"8C8676" };
        const statusLine = scheme.label + (scheme.desc ? " — " + scheme.desc : "");
        bodyParts.push(paraXml(statusLine, { color:(scheme.color||"#8C8676").replace("#",""), bold:true, sz:19, after:(it.note||it.action||it.photos.length)?40:120 }));
        if (it.note) bodyParts.push(paraXml(it.note, { after:(it.action||it.photos.length)?60:140 }));
        if (it.action) bodyParts.push(paraXml((field.actionLabel||"Lisätoimenpide") + ": " + it.action, { color:"33455C", after: it.photos.length?60:140 }));
      } else {
        let displayVal = it.value || "—";
        if (field.type === "number" && field.unit && it.value) displayVal = it.value + " " + field.unit;
        bodyParts.push(paraXml(displayVal, { after: it.photos.length ? 60 : 140 }));
      }

      for (const p of it.photos){
        const maxCx = 4938000;
        let cx = p.w * 9525, cy = p.h * 9525;
        if (cx > maxCx){ const s = maxCx/cx; cx = Math.round(cx*s); cy = Math.round(cy*s); }
        const rId = relCounter++;
        const mediaName = "image" + (mediaFiles.length+1) + ".jpeg";
        mediaFiles.push({ name: mediaName, blob: p.blob });
        relParts.push('<Relationship Id="rId'+rId+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/'+mediaName+'"/>');
        bodyParts.push(imageXml(rId, cx, cy, docPrCounter++));
      }
    });
  });

  const documentXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>'+bodyParts.join('')+'<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417"/></w:sectPr></w:body></w:document>';

  const contentTypesXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>';

  const rootRelsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>';

  const docRelsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+relParts.join('')+'</Relationships>';

  const coreXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>'+xmlEsc(DEF.meta.title||"Lomake")+'</dc:title></cp:coreProperties>';

  const appXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Kenttalomake</Application></Properties>';

  const zip = new JSZip();
  zip.file("[Content_Types].xml", contentTypesXml);
  zip.folder("_rels").file(".rels", rootRelsXml);
  const wordFolder = zip.folder("word");
  wordFolder.file("document.xml", documentXml);
  wordFolder.folder("_rels").file("document.xml.rels", docRelsXml);
  const mediaFolder = wordFolder.folder("media");
  mediaFiles.forEach(m => mediaFolder.file(m.name, m.blob));
  zip.folder("docProps").file("core.xml", coreXml);
  zip.folder("docProps").file("app.xml", appXml);

  return zip.generateAsync({ type:"blob", mimeType:"application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
}

document.getElementById("btnExport").addEventListener("click", async () => {
  const btn = document.getElementById("btnExport");
  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = "Kootaan raporttia…";
  try{
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

/* ---------- Käynnistys ---------- */
function waitForSupabaseClient(cb, triesLeft){
  if (typeof triesLeft !== "number") triesLeft = 100;
  if (window.__supabaseClient) return cb(window.__supabaseClient);
  if (triesLeft <= 0){ fatalError("Supabase-yhteyttä ei saatu muodostettua (auth-gate.js ei latautunut)."); return; }
  setTimeout(() => waitForSupabaseClient(cb, triesLeft - 1), 50);
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

      db = await openDb("dynform_" + FORM_ID.replace(/-/g,"") + "_db");
      await loadFromStorage();

      renderHeaderFields();
      renderSections();
    }catch(err){
      fatalError("Odottamaton virhe lomaketta ladatessa: " + (err && err.message ? err.message : err));
    }
  });
})();
