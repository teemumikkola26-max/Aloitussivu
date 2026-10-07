"use strict";
/* =========================================================================
   EDITOR.HTML — LOMAKE-EDITORI
   Listaa Supabaseen tallennetut lomakepohjat, ja antaa luoda/muokata niitä.
   Tallentaa "forms"-tauluun (sarake "definition" sisältää saman JSON-muodon
   kuin form-runtime.js lukee).
   ========================================================================= */

let supabaseClient = null;
let editingId = null; // null = uusi lomake
let ed = null; // muokattava lomakepohja (editorin oma tila)
const openHintEditors = new Set();  // mitkä ohjeeditorit ovat auki (säilyy uudelleenpiirrossa)
let condOptionHolders = [];         // ehtojen valintalistat, jotka päivittyvät kun vaihtoehtoja muokataan

function genId(){
  if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID().slice(0,8);
  return Math.random().toString(36).slice(2,10);
}

function blankDef(){
  return {
    meta: { title:"", tag:"", desc:"", icon:"📋" },
    statusScheme: [
      { id:genId(), value:"ok", label:"Kunnossa", color:"#2f6f4e", isDefault:false, attention:false, desc:"" },
      { id:genId(), value:"note", label:"Huomautettavaa", color:"#a15a1e", isDefault:false, attention:true, desc:"" },
      { id:genId(), value:"unchecked", label:"Ei arvioitu", color:"#8c8676", isDefault:true, attention:false, desc:"" }
    ],
    headerFields: [
      { id:genId(), label:"Kohteen osoite", type:"text", full:true },
      { id:genId(), label:"Päivämäärä", type:"date" },
      { id:genId(), label:"Tarkastuksen suorittaja", type:"user" }
    ],
    sections: []
  };
}

function fatalError(message){
  document.documentElement.style.visibility = "visible";
  const banner = document.createElement("div");
  banner.style.cssText =
    "position:fixed;top:0;left:0;right:0;z-index:999999;background:#a13030;color:#fff;" +
    "padding:14px 16px;font-size:.85rem;white-space:pre-wrap;";
  banner.textContent = message;
  document.body.appendChild(banner);
}

let toastTimer = null;
function showToast(msg){
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 3200);
}

function escapeHtml(s){
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

/* ---------- Näkymän vaihto ---------- */
function showListView(){
  document.getElementById("listView").style.display = "";
  document.getElementById("editView").style.display = "none";
  loadFormsList();
}
function showEditView(){
  document.getElementById("listView").style.display = "none";
  document.getElementById("editView").style.display = "";
  renderEditor();
}

/* ---------- Lomakelistaus ---------- */
async function loadFormsList(){
  const wrap = document.getElementById("formsList");
  wrap.innerHTML = '<div style="padding:20px;color:var(--ink-soft);font-size:.85rem;">Ladataan…</div>';
  const { data, error } = await supabaseClient.from("forms").select("id,title,tag,description,icon,updated_at").order("updated_at", { ascending:false });
  if (error){
    wrap.innerHTML = "";
    fatalError("Lomakkeiden haku epäonnistui: " + error.message);
    return;
  }
  wrap.innerHTML = "";
  if (!data || data.length === 0){
    wrap.innerHTML = '<div style="padding:20px;color:var(--ink-soft);font-size:.85rem;">Ei vielä yhtään lomaketta.</div>';
    return;
  }
  data.forEach(row => {
    const card = document.createElement("div");
    card.className = "form-row";
    card.innerHTML =
      '<div class="fr-icon">' + escapeHtml(row.icon || "📋") + '</div>' +
      '<div class="fr-body">' +
        '<div class="fr-title">' + escapeHtml(row.title || "(nimetön)") + '</div>' +
        '<div class="fr-tag">' + escapeHtml(row.tag || "") + '</div>' +
      '</div>' +
      '<div class="fr-actions">' +
        '<button type="button" class="fr-btn" data-action="open">Avaa</button>' +
        '<button type="button" class="fr-btn" data-action="edit">Muokkaa</button>' +
        '<button type="button" class="fr-btn fr-btn-danger" data-action="delete">Poista</button>' +
      '</div>';
    card.querySelector('[data-action="open"]').addEventListener("click", () => {
      window.location.href = "form.html?id=" + encodeURIComponent(row.id);
    });
    card.querySelector('[data-action="edit"]').addEventListener("click", () => {
      loadFormForEdit(row.id);
    });
    card.querySelector('[data-action="delete"]').addEventListener("click", () => {
      confirmDeleteForm(row.id, row.title);
    });
    wrap.appendChild(card);
  });
}

function confirmDeleteForm(id, title){
  showConfirm(
    "Poista lomake?",
    'Lomake "' + title + '" poistetaan pysyvästi kaikkien käyttäjien listalta. Tätä ei voi perua.',
    async () => {
      const { error } = await supabaseClient.from("forms").delete().eq("id", id);
      if (error){ showToast("Poisto epäonnistui: " + error.message); return; }
      showToast("Lomake poistettu.");
      loadFormsList();
    }
  );
}

async function loadFormForEdit(id){
  const { data, error } = await supabaseClient.from("forms").select("*").eq("id", id).single();
  if (error || !data){
    showToast("Lomakkeen lataus epäonnistui.");
    return;
  }
  editingId = id;
  ed = data.definition;
  ed.meta = ed.meta || { title:data.title, tag:data.tag, desc:data.description, icon:data.icon };
  ed.statusScheme = ed.statusScheme || [];
  ed.headerFields = ed.headerFields || [];
  ed.sections = ed.sections || [];
  showEditView();
}

function startNewForm(){
  editingId = null;
  ed = blankDef();
  showEditView();
}

/* ---------- Vahvistusdialogi (uudelleenkäyttö) ---------- */
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

/* ---------- Editorin renderöinti ---------- */
function renderEditor(){
  const root = document.getElementById("editorRoot");
  root.innerHTML = "";
  condOptionHolders = [];

  root.appendChild(buildMetaCard());
  root.appendChild(buildStatusSchemeCard());
  root.appendChild(buildHeaderFieldsCard());
  root.appendChild(buildSectionsCard());
}

function fieldRow(labelText, inputEl){
  const wrap = document.createElement("div");
  wrap.className = "field";
  const label = document.createElement("label");
  label.textContent = labelText;
  wrap.appendChild(label);
  wrap.appendChild(inputEl);
  return wrap;
}

function textInput(value, onInput, placeholder){
  const input = document.createElement("input");
  input.type = "text";
  input.autocomplete = "off";
  input.value = value || "";
  if (placeholder) input.placeholder = placeholder;
  input.addEventListener("input", () => onInput(input.value));
  return input;
}

function buildMetaCard(){
  const card = document.createElement("section");
  card.className = "card";
  card.innerHTML = '<div class="card-header"><h2>Lomakkeen perustiedot</h2></div>';
  const body = document.createElement("div");
  body.className = "card-body";
  body.appendChild(fieldRow("Nimi", textInput(ed.meta.title, v => ed.meta.title = v, "esim. Vesikattotarkastus")));
  body.appendChild(fieldRow("Tunniste/standardi (valinnainen)", textInput(ed.meta.tag, v => ed.meta.tag = v, "esim. RT 12345")));
  body.appendChild(fieldRow("Kuvaus", textInput(ed.meta.desc, v => ed.meta.desc = v, "Lyhyt kuvaus lomakkeesta")));
  body.appendChild(fieldRow("Kuvake (emoji)", textInput(ed.meta.icon, v => ed.meta.icon = v, "📋")));
  card.appendChild(body);
  return card;
}

function buildStatusSchemeCard(){
  const card = document.createElement("section");
  card.className = "card";
  card.innerHTML = '<div class="card-header"><h2>Tilavaihtoehdot (tarkistuskohdille)</h2></div>';
  const body = document.createElement("div");
  body.className = "card-body";
  const sub = document.createElement("div");
  sub.style.cssText = "font-size:.78rem;color:var(--ink-soft);margin-bottom:10px;";
  sub.textContent = "Nämä näkyvät painikkeina jokaisen \"Tarkistuskohta\"-tyyppisen kentän kohdalla, esim. Kunnossa/Huomautettavaa, tai KL 1-5.";
  body.appendChild(sub);

  ed.statusScheme.forEach((opt, idx) => {
    body.appendChild(buildStatusOptionRow(opt, idx));
  });

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "add-row-btn";
  addBtn.textContent = "+ Lisää tilavaihtoehto";
  addBtn.addEventListener("click", () => {
    ed.statusScheme.push({ id:genId(), value:"opt"+genId(), label:"Uusi tila", color:"#33455c", isDefault:false, attention:false, desc:"" });
    renderEditor();
  });
  body.appendChild(addBtn);

  card.appendChild(body);
  return card;
}

function buildStatusOptionRow(opt, idx){
  const row = document.createElement("div");
  row.className = "editor-row";

  const labelInput = textInput(opt.label, v => { opt.label = v; }, "Tilan nimi");
  labelInput.style.flex = "1";

  const colorInput = document.createElement("input");
  colorInput.type = "color";
  colorInput.value = opt.color || "#33455c";
  colorInput.style.cssText = "width:38px;height:38px;border:none;border-radius:7px;padding:0;flex:0 0 auto;";
  colorInput.addEventListener("input", () => { opt.color = colorInput.value; });

  const defaultLabel = document.createElement("label");
  defaultLabel.style.cssText = "display:flex;align-items:center;gap:4px;font-size:.72rem;color:var(--ink-soft);flex:0 0 auto;white-space:nowrap;";
  const defaultCheck = document.createElement("input");
  defaultCheck.type = "checkbox";
  defaultCheck.checked = !!opt.isDefault;
  defaultCheck.addEventListener("change", () => {
    ed.statusScheme.forEach(o => o.isDefault = false);
    opt.isDefault = defaultCheck.checked;
    renderEditor();
  });
  defaultLabel.appendChild(defaultCheck);
  defaultLabel.appendChild(document.createTextNode("Oletus"));

  const attnLabel = document.createElement("label");
  attnLabel.style.cssText = "display:flex;align-items:center;gap:4px;font-size:.72rem;color:var(--ink-soft);flex:0 0 auto;white-space:nowrap;";
  const attnCheck = document.createElement("input");
  attnCheck.type = "checkbox";
  attnCheck.checked = !!opt.attention;
  attnCheck.addEventListener("change", () => { opt.attention = attnCheck.checked; });
  attnLabel.appendChild(attnCheck);
  attnLabel.appendChild(document.createTextNode("Huomio"));

  const delBtn = document.createElement("button");
  delBtn.type = "button";
  delBtn.className = "icon-btn icon-btn-danger";
  delBtn.textContent = "✕";
  delBtn.addEventListener("click", () => {
    ed.statusScheme.splice(idx, 1);
    renderEditor();
  });

  row.appendChild(labelInput);
  row.appendChild(colorInput);
  row.appendChild(defaultLabel);
  row.appendChild(attnLabel);
  row.appendChild(delBtn);
  return row;
}

function buildHeaderFieldsCard(){
  const card = document.createElement("section");
  card.className = "card";
  card.innerHTML = '<div class="card-header"><h2>Kohteen tiedot (lomakkeen alussa)</h2></div>';
  const body = document.createElement("div");
  body.className = "card-body";

  ed.headerFields.forEach((hf, idx) => {
    const row = document.createElement("div");
    row.className = "editor-row";
    const labelInput = textInput(hf.label, v => hf.label = v, "Kentän nimi");
    labelInput.style.flex = "1";
    const typeSelect = document.createElement("select");
    typeSelect.className = "type-select";
    Object.keys(HEADER_TYPE_LABELS).forEach(t => {
      const o = document.createElement("option");
      o.value = t; o.textContent = HEADER_TYPE_LABELS[t];
      if (hf.type === t) o.selected = true;
      typeSelect.appendChild(o);
    });
    typeSelect.addEventListener("change", () => {
      hf.type = typeSelect.value;
      if (hf.type === "select" && !Array.isArray(hf.options)) hf.options = [];
      renderEditor();
    });
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "icon-btn icon-btn-danger";
    delBtn.textContent = "✕";
    delBtn.addEventListener("click", () => { ed.headerFields.splice(idx,1); renderEditor(); });
    row.appendChild(labelInput);
    row.appendChild(typeSelect);
    row.appendChild(delBtn);
    body.appendChild(row);
    if (hf.type === "select") body.appendChild(optionsTextarea(hf));
  });

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "add-row-btn";
  addBtn.textContent = "+ Lisää kenttä";
  addBtn.addEventListener("click", () => {
    ed.headerFields.push({ id:genId(), label:"Uusi kenttä", type:"text" });
    renderEditor();
  });
  body.appendChild(addBtn);

  card.appendChild(body);
  return card;
}

const HEADER_TYPE_LABELS = {
  text:"Teksti",
  date:"Päivämäärä",
  textarea:"Pitkä teksti",
  number:"Numero (esim. rakennusvuosi)",
  select:"Pudotusvalikko (esim. rakennustyyppi)",
  user:"Käyttäjä (valitaan käyttäjistä, esim. tarkastuksen suorittaja)"
};

function optionsTextarea(field){
  const ta = document.createElement("textarea");
  ta.placeholder = "Yksi vaihtoehto per rivi";
  ta.style.cssText = "width:100%;margin-bottom:8px;border:1px solid var(--line-strong);border-radius:7px;padding:8px 9px;font-size:.85rem;font-family:inherit;min-height:56px;box-sizing:border-box;";
  ta.value = (field.options || []).join("\n");
  ta.addEventListener("input", () => {
    field.options = ta.value.split("\n").map(x => x.trim()).filter(Boolean);
    refreshCondOptions();
  });
  return ta;
}

/* ---------- Ehdolliset ohjeet ---------- */
const NUM_OPS = [
  ["lt","on alle (<)"], ["lte","on enintään (≤)"], ["gt","on yli (>)"],
  ["gte","on vähintään (≥)"], ["eq","on täsmälleen (=)"], ["between","on välillä (rajat mukaan)"]
];
const SEL_OPS = [["is","on jokin näistä"], ["isnot","ei ole mikään näistä"]];
function defaultOp(type){ return type === "number" ? "lt" : "is"; }

/* Kentät, joiden arvon perusteella ohjeita voi ehdollistaa: numero- ja pudotusvalikkokentät */
function collectSources(){
  const out = [];
  ed.headerFields.forEach(hf => {
    if (hf.type === "number" || hf.type === "select"){
      out.push({ key:"h:" + hf.id, label:"Kohteen tiedot › " + (hf.label || "(nimetön)"), type:hf.type, options:hf.options || [] });
    }
  });
  ed.sections.forEach(sec => sec.fields.forEach(f => {
    if (f.type === "number" || f.type === "select"){
      out.push({ key:"f:" + sec.id + "_" + f.id, label:(sec.title || "(osio)") + " › " + (f.label || "(nimetön)"), type:f.type, options:f.options || [] });
    }
  }));
  return out;
}

function fillCondOptions(holder, cond, options){
  holder.innerHTML = "";
  if (!options.length){
    holder.textContent = "Kentällä ei ole vielä vaihtoehtoja.";
    return;
  }
  options.forEach(opt => {
    const lab = document.createElement("label");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = (cond.values || []).indexOf(opt) !== -1;
    cb.addEventListener("change", () => {
      if (!Array.isArray(cond.values)) cond.values = [];
      const i = cond.values.indexOf(opt);
      if (cb.checked && i === -1) cond.values.push(opt);
      if (!cb.checked && i !== -1) cond.values.splice(i, 1);
    });
    lab.appendChild(cb);
    lab.appendChild(document.createTextNode(opt));
    holder.appendChild(lab);
  });
}

function refreshCondOptions(){
  const sources = collectSources();
  condOptionHolders.forEach(h => {
    const src = sources.find(x => x.key === h.key);
    if (src) fillCondOptions(h.el, h.cond, src.options);
  });
}

function buildHintsEditor(target, key, titleText){
  if (!Array.isArray(target.hints)) target.hints = [];
  const sources = collectSources();

  const details = document.createElement("details");
  details.className = "hints-editor";
  if (openHintEditors.has(key)) details.open = true;
  details.addEventListener("toggle", () => {
    if (details.open) openHintEditors.add(key); else openHintEditors.delete(key);
  });

  const summary = document.createElement("summary");
  summary.textContent = titleText + (target.hints.length ? " (" + target.hints.length + ")" : "");
  details.appendChild(summary);

  target.hints.forEach((h, i) => details.appendChild(buildHintBlock(target, h, i, sources)));

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "add-row-btn";
  addBtn.style.marginBottom = "10px";
  addBtn.textContent = "+ Lisää ohje";
  addBtn.addEventListener("click", () => {
    target.hints.push({ id:genId(), level:"info", match:"all", text:"", conditions:[] });
    openHintEditors.add(key);
    renderEditor();
  });
  details.appendChild(addBtn);
  return details;
}

function buildHintBlock(target, h, idx, sources){
  if (!Array.isArray(h.conditions)) h.conditions = [];
  const box = document.createElement("div");
  box.className = "hint-edit-block";

  const row = document.createElement("div");
  row.className = "editor-row";
  const levelSel = document.createElement("select");
  levelSel.className = "type-select";
  [["info","💡 Ohje"],["warn","⚠️ Huomio"]].forEach(([v, t]) => {
    const o = document.createElement("option");
    o.value = v; o.textContent = t;
    if ((h.level || "info") === v) o.selected = true;
    levelSel.appendChild(o);
  });
  levelSel.addEventListener("change", () => { h.level = levelSel.value; });
  row.appendChild(levelSel);

  if (h.conditions.length > 1){
    const matchSel = document.createElement("select");
    matchSel.className = "type-select";
    [["all","Kaikki ehdot täyttyvät"],["any","Jokin ehdoista täyttyy"]].forEach(([v, t]) => {
      const o = document.createElement("option");
      o.value = v; o.textContent = t;
      if ((h.match || "all") === v) o.selected = true;
      matchSel.appendChild(o);
    });
    matchSel.addEventListener("change", () => { h.match = matchSel.value; });
    row.appendChild(matchSel);
  }

  const delBtn = document.createElement("button");
  delBtn.type = "button"; delBtn.className = "icon-btn icon-btn-danger"; delBtn.textContent = "✕";
  delBtn.style.marginLeft = "auto";
  delBtn.addEventListener("click", () => { target.hints.splice(idx, 1); renderEditor(); });
  row.appendChild(delBtn);
  box.appendChild(row);

  if (!h.conditions.length){
    const note = document.createElement("div");
    note.className = "hint-note";
    note.textContent = "Ei ehtoja: ohje näkyy aina. Lisää ehto, niin ohje näytetään vain kun ehto täyttyy.";
    box.appendChild(note);
  } else {
    const when = document.createElement("div");
    when.className = "hint-note";
    when.textContent = "Näytetään kun:";
    box.appendChild(when);
  }

  h.conditions.forEach((c, ci) => box.appendChild(buildCondRow(h, c, ci, sources)));

  const addCond = document.createElement("button");
  addCond.type = "button";
  addCond.className = "add-row-btn add-row-btn-sub";
  addCond.textContent = "+ Lisää ehto";
  addCond.addEventListener("click", () => {
    if (!sources.length){
      showToast("Lisää ensin numero- tai pudotusvalikkokenttä (esim. Rakennusvuosi), jonka perusteella ohje näytetään.");
      return;
    }
    h.conditions.push({ id:genId(), source:sources[0].key, op:defaultOp(sources[0].type), values:[], value:"", value2:"" });
    renderEditor();
  });
  box.appendChild(addCond);

  const ta = document.createElement("textarea");
  ta.className = "hint-text-input";
  ta.placeholder = "Ohjeteksti, jonka tarkastaja näkee (rivinvaihdot säilyvät)";
  ta.value = h.text || "";
  ta.addEventListener("input", () => { h.text = ta.value; });
  box.appendChild(ta);
  return box;
}

function numInput(value, onInput){
  const inp = document.createElement("input");
  inp.type = "number"; inp.step = "any"; inp.inputMode = "decimal";
  inp.className = "cond-num";
  inp.value = value == null ? "" : value;
  inp.addEventListener("input", () => onInput(inp.value));
  return inp;
}

function buildCondRow(h, c, ci, sources){
  const row = document.createElement("div");
  row.className = "cond-row";
  const src = sources.find(x => x.key === c.source);

  const line1 = document.createElement("div");
  line1.className = "editor-row";
  line1.style.marginBottom = "0";
  const srcSel = document.createElement("select");
  srcSel.className = "type-select";
  srcSel.style.cssText = "flex:1;min-width:0;";
  if (!src){
    const o = document.createElement("option");
    o.value = c.source; o.textContent = "(poistettu kenttä)";
    srcSel.appendChild(o);
  }
  sources.forEach(x => {
    const o = document.createElement("option");
    o.value = x.key; o.textContent = x.label;
    srcSel.appendChild(o);
  });
  srcSel.value = c.source;
  srcSel.addEventListener("change", () => {
    const ns = sources.find(x => x.key === srcSel.value);
    if (!ns) return;
    c.source = ns.key;
    c.op = defaultOp(ns.type);
    c.values = []; c.value = ""; c.value2 = "";
    renderEditor();
  });
  const del = document.createElement("button");
  del.type = "button"; del.className = "icon-btn icon-btn-danger"; del.textContent = "✕";
  del.addEventListener("click", () => { h.conditions.splice(ci, 1); renderEditor(); });
  line1.appendChild(srcSel);
  line1.appendChild(del);
  row.appendChild(line1);
  if (!src) return row;

  const ops = src.type === "number" ? NUM_OPS : SEL_OPS;
  if (!ops.some(o => o[0] === c.op)) c.op = defaultOp(src.type);

  const line2 = document.createElement("div");
  line2.className = "editor-row";
  line2.style.margin = "6px 0 0";
  const opSel = document.createElement("select");
  opSel.className = "type-select";
  ops.forEach(([v, t]) => {
    const o = document.createElement("option");
    o.value = v; o.textContent = t;
    if (c.op === v) o.selected = true;
    opSel.appendChild(o);
  });
  opSel.addEventListener("change", () => { c.op = opSel.value; renderEditor(); });
  line2.appendChild(opSel);

  if (src.type === "number"){
    line2.appendChild(numInput(c.value, v => { c.value = v; }));
    if (c.op === "between"){
      line2.appendChild(document.createTextNode("–"));
      line2.appendChild(numInput(c.value2, v => { c.value2 = v; }));
    }
    row.appendChild(line2);
  } else {
    row.appendChild(line2);
    const holder = document.createElement("div");
    holder.className = "cond-values";
    if (!Array.isArray(c.values)) c.values = [];
    condOptionHolders.push({ el: holder, cond: c, key: c.source });
    fillCondOptions(holder, c, src.options);
    row.appendChild(holder);
  }
  return row;
}

function validateHints(hints, where, sourceMap){
  for (const h of (hints || [])){
    if (!h.text || !h.text.trim()) return "Ohjeelta puuttuu teksti (" + where + ").";
    for (const c of (h.conditions || [])){
      const src = sourceMap[c.source];
      if (!src) return "Ohjeen ehto viittaa kenttään, jota ei ole enää olemassa (" + where + "). Poista ehto tai valitse toinen kenttä.";
      if (src.type === "number"){
        const okA = c.value != null && String(c.value).trim() !== "" && !isNaN(parseFloat(c.value));
        const okB = c.value2 != null && String(c.value2).trim() !== "" && !isNaN(parseFloat(c.value2));
        if (!okA) return "Ehdolta puuttuu numeroarvo (" + where + ").";
        if (c.op === "between" && !okB) return "Ehdolta puuttuu toinen raja-arvo (" + where + ").";
      } else {
        const valid = (c.values || []).filter(v => (src.options || []).indexOf(v) !== -1);
        if (!valid.length) return "Valitse ehdolle vähintään yksi vaihtoehto (" + where + ").";
      }
    }
  }
  return null;
}

const FIELD_TYPE_LABELS = {
  checklist:"Tarkistuskohta (tila+muistiinpano+kuva)",
  text:"Vapaa teksti",
  number:"Numero",
  date:"Päivämäärä",
  select:"Pudotusvalikko",
  table:"Taulukko (vakiotsikot + täytettävät solut)"
};

function buildSectionsCard(){
  const card = document.createElement("section");
  card.className = "card";
  card.innerHTML = '<div class="card-header"><h2>Osiot ja kentät</h2></div>';
  const body = document.createElement("div");
  body.className = "card-body";

  ed.sections.forEach((sec, secIdx) => {
    body.appendChild(buildSectionBlock(sec, secIdx));
  });

  const addSectionBtn = document.createElement("button");
  addSectionBtn.type = "button";
  addSectionBtn.className = "add-row-btn";
  addSectionBtn.textContent = "+ Lisää osio";
  addSectionBtn.addEventListener("click", () => {
    ed.sections.push({ id:genId(), title:"Uusi osio", fields:[] });
    renderEditor();
  });
  body.appendChild(addSectionBtn);

  card.appendChild(body);
  return card;
}

function buildSectionBlock(sec, secIdx){
  const block = document.createElement("div");
  block.className = "section-block";

  const head = document.createElement("div");
  head.className = "section-block-head";
  const titleInput = textInput(sec.title, v => sec.title = v, "Osion nimi");
  titleInput.style.flex = "1";
  const upBtn = document.createElement("button");
  upBtn.type = "button"; upBtn.className = "icon-btn"; upBtn.textContent = "↑";
  upBtn.disabled = secIdx === 0;
  upBtn.addEventListener("click", () => {
    if (secIdx === 0) return;
    const tmp = ed.sections[secIdx-1]; ed.sections[secIdx-1] = ed.sections[secIdx]; ed.sections[secIdx] = tmp;
    renderEditor();
  });
  const downBtn = document.createElement("button");
  downBtn.type = "button"; downBtn.className = "icon-btn"; downBtn.textContent = "↓";
  downBtn.disabled = secIdx === ed.sections.length - 1;
  downBtn.addEventListener("click", () => {
    if (secIdx === ed.sections.length - 1) return;
    const tmp = ed.sections[secIdx+1]; ed.sections[secIdx+1] = ed.sections[secIdx]; ed.sections[secIdx] = tmp;
    renderEditor();
  });
  const delBtn = document.createElement("button");
  delBtn.type = "button"; delBtn.className = "icon-btn icon-btn-danger"; delBtn.textContent = "✕";
  delBtn.addEventListener("click", () => {
    showConfirm("Poista osio?", 'Osio "' + sec.title + '" ja kaikki sen kentät poistetaan lomakepohjasta.', () => {
      ed.sections.splice(secIdx,1);
      renderEditor();
    });
  });
  head.appendChild(titleInput);
  head.appendChild(upBtn);
  head.appendChild(downBtn);
  head.appendChild(delBtn);
  block.appendChild(head);
  block.appendChild(buildHintsEditor(sec, "s:" + sec.id, "💡 Osion ohjeet (näkyvät osion alussa)"));
  const hintGap = document.createElement("div");
  hintGap.style.height = "10px";
  block.appendChild(hintGap);

  sec.fields.forEach((field, fieldIdx) => {
    block.appendChild(buildFieldBlock(sec, field, fieldIdx));
  });

  const addFieldBtn = document.createElement("button");
  addFieldBtn.type = "button";
  addFieldBtn.className = "add-row-btn add-row-btn-sub";
  addFieldBtn.textContent = "+ Lisää kenttä osioon";
  addFieldBtn.addEventListener("click", () => {
    sec.fields.push({ id:genId(), type:"checklist", label:"Uusi kenttä", allowPhoto:true, allowAction:false, actionLabel:"", unit:"", options:[] });
    renderEditor();
  });
  block.appendChild(addFieldBtn);

  return block;
}

function buildFieldBlock(sec, field, fieldIdx){
  const wrap = buildFieldBlockCore(sec, field, fieldIdx);
  wrap.appendChild(buildHintsEditor(field, "f:" + sec.id + "_" + field.id, "💡 Ohjeet tälle kentälle"));
  return wrap;
}

function buildFieldBlockCore(sec, field, fieldIdx){
  const wrap = document.createElement("div");
  wrap.className = "field-block";

  const row1 = document.createElement("div");
  row1.className = "editor-row";
  const labelInput = textInput(field.label, v => field.label = v, "Kentän teksti");
  labelInput.style.flex = "1";
  const typeSelect = document.createElement("select");
  typeSelect.className = "type-select";
  Object.keys(FIELD_TYPE_LABELS).forEach(t => {
    const o = document.createElement("option");
    o.value = t; o.textContent = FIELD_TYPE_LABELS[t];
    if (field.type === t) o.selected = true;
    typeSelect.appendChild(o);
  });
  typeSelect.addEventListener("change", () => { field.type = typeSelect.value; renderEditor(); });
  const upBtn = document.createElement("button");
  upBtn.type = "button"; upBtn.className = "icon-btn"; upBtn.textContent = "↑";
  upBtn.disabled = fieldIdx === 0;
  upBtn.addEventListener("click", () => {
    if (fieldIdx === 0) return;
    const tmp = sec.fields[fieldIdx-1]; sec.fields[fieldIdx-1] = sec.fields[fieldIdx]; sec.fields[fieldIdx] = tmp;
    renderEditor();
  });
  const downBtn = document.createElement("button");
  downBtn.type = "button"; downBtn.className = "icon-btn"; downBtn.textContent = "↓";
  downBtn.disabled = fieldIdx === sec.fields.length - 1;
  downBtn.addEventListener("click", () => {
    if (fieldIdx === sec.fields.length - 1) return;
    const tmp = sec.fields[fieldIdx+1]; sec.fields[fieldIdx+1] = sec.fields[fieldIdx]; sec.fields[fieldIdx] = tmp;
    renderEditor();
  });
  const delBtn = document.createElement("button");
  delBtn.type = "button"; delBtn.className = "icon-btn icon-btn-danger"; delBtn.textContent = "✕";
  delBtn.addEventListener("click", () => { sec.fields.splice(fieldIdx,1); renderEditor(); });

  row1.appendChild(labelInput);
  row1.appendChild(typeSelect);
  row1.appendChild(upBtn);
  row1.appendChild(downBtn);
  row1.appendChild(delBtn);
  wrap.appendChild(row1);

  const row2 = document.createElement("div");
  row2.className = "editor-row-sub";

  const photoLabel = document.createElement("label");
  photoLabel.style.cssText = "display:flex;align-items:center;gap:4px;font-size:.74rem;color:var(--ink-soft);";
  const photoCheck = document.createElement("input");
  photoCheck.type = "checkbox";
  photoCheck.checked = field.allowPhoto !== false;
  photoCheck.addEventListener("change", () => { field.allowPhoto = photoCheck.checked; });
  photoLabel.appendChild(photoCheck);
  photoLabel.appendChild(document.createTextNode("Salli valokuva"));
  row2.appendChild(photoLabel);

  if (field.type === "checklist"){
    const actionLabelWrap = document.createElement("label");
    actionLabelWrap.style.cssText = "display:flex;align-items:center;gap:4px;font-size:.74rem;color:var(--ink-soft);";
    const actionCheck = document.createElement("input");
    actionCheck.type = "checkbox";
    actionCheck.checked = !!field.allowAction;
    actionCheck.addEventListener("change", () => { field.allowAction = actionCheck.checked; renderEditor(); });
    actionLabelWrap.appendChild(actionCheck);
    actionLabelWrap.appendChild(document.createTextNode("Lisäkenttä (esim. toimenpide-ehdotus)"));
    row2.appendChild(actionLabelWrap);

    if (field.allowAction){
      const actionLabelInput = textInput(field.actionLabel, v => field.actionLabel = v, "Lisäkentän otsikko, esim. Toimenpide");
      actionLabelInput.style.cssText = "margin-top:6px;width:100%;";
      wrap.appendChild(row2);
      wrap.appendChild(actionLabelInput);
      return wrap;
    }
  } else if (field.type === "number"){
    const unitInput = textInput(field.unit, v => field.unit = v, "Yksikkö, esim. mm");
    unitInput.style.cssText = "width:120px;";
    row2.appendChild(unitInput);
  } else if (field.type === "select"){
    wrap.appendChild(row2);
    const optionsArea = document.createElement("textarea");
    optionsArea.placeholder = "Yksi vaihtoehto per rivi";
    optionsArea.style.cssText = "width:100%;margin-top:6px;border:1px solid var(--line-strong);border-radius:7px;padding:8px 9px;font-size:.85rem;font-family:inherit;min-height:56px;";
    optionsArea.value = (field.options || []).join("\n");
    optionsArea.addEventListener("input", () => {
      field.options = optionsArea.value.split("\n").map(s => s.trim()).filter(Boolean);
      refreshCondOptions();
    });
    wrap.appendChild(optionsArea);
    return wrap;
  } else if (field.type === "table"){
    if (!field.tableRows) field.tableRows = 3;
    if (!field.tableCols) field.tableCols = 3;
    if (field.tableCorner == null) field.tableCorner = "";
    if (!field.tableRowHeaders) field.tableRowHeaders = [];
    if (!field.tableColHeaders) field.tableColHeaders = [];
    while (field.tableRowHeaders.length < field.tableRows - 1) field.tableRowHeaders.push("");
    field.tableRowHeaders.length = field.tableRows - 1;
    while (field.tableColHeaders.length < field.tableCols - 1) field.tableColHeaders.push("");
    field.tableColHeaders.length = field.tableCols - 1;
    /*
     * Oletuksena vain ensimmäinen rivi on kiinteä otsikkorivi —
     * ensimmäinen sarake on nykyään tavallinen täytettävä sarake.
     * Jo olemassa olevat taulukot, joissa on oikeasti kirjoitettuja
     * riviotsikoita, pysyvät ennallaan (kiinteä sarake), ettei
     * vanhoja lomakkeita rikota taannehtivasti.
     */
    if (field.tableFixedFirstCol == null){
      field.tableFixedFirstCol = field.tableRowHeaders.some(h => h && h.trim() !== "");
    }

    const dimRow = document.createElement("div");
    dimRow.className = "editor-row-sub";

    const rowsWrap = document.createElement("label");
    rowsWrap.style.cssText = "display:flex;align-items:center;gap:6px;font-size:.76rem;color:var(--ink-soft);";
    const rowsInput = document.createElement("input");
    rowsInput.type = "number"; rowsInput.min = "2"; rowsInput.max = "12";
    rowsInput.value = field.tableRows;
    rowsInput.style.cssText = "width:56px;border:1px solid var(--line-strong);border-radius:6px;padding:4px 6px;";
    rowsInput.addEventListener("change", () => {
      field.tableRows = Math.max(2, Math.min(12, Number(rowsInput.value) || 3));
      renderEditor();
    });
    rowsWrap.appendChild(document.createTextNode("Rivejä"));
    rowsWrap.appendChild(rowsInput);

    const colsWrap = document.createElement("label");
    colsWrap.style.cssText = "display:flex;align-items:center;gap:6px;font-size:.76rem;color:var(--ink-soft);";
    const colsInput = document.createElement("input");
    colsInput.type = "number"; colsInput.min = "2"; colsInput.max = "12";
    colsInput.value = field.tableCols;
    colsInput.style.cssText = "width:56px;border:1px solid var(--line-strong);border-radius:6px;padding:4px 6px;";
    colsInput.addEventListener("change", () => {
      field.tableCols = Math.max(2, Math.min(12, Number(colsInput.value) || 3));
      renderEditor();
    });
    colsWrap.appendChild(document.createTextNode("Sarakkeita"));
    colsWrap.appendChild(colsInput);

    dimRow.appendChild(rowsWrap);
    dimRow.appendChild(colsWrap);
    wrap.appendChild(dimRow);

    const fixedColWrap = document.createElement("label");
    fixedColWrap.style.cssText = "display:flex;align-items:center;gap:4px;font-size:.74rem;color:var(--ink-soft);margin-top:6px;";
    const fixedColCheck = document.createElement("input");
    fixedColCheck.type = "checkbox";
    fixedColCheck.checked = !!field.tableFixedFirstCol;
    fixedColCheck.addEventListener("change", () => {
      field.tableFixedFirstCol = fixedColCheck.checked;
      renderEditor();
    });
    fixedColWrap.appendChild(fixedColCheck);
    fixedColWrap.appendChild(document.createTextNode("Kiinteä ensimmäinen sarake (riviotsikot)"));
    wrap.appendChild(fixedColWrap);

    const cornerInput = textInput(field.tableCorner, v => field.tableCorner = v, "Vasen yläkulma (valinnainen otsikko)");
    cornerInput.style.cssText = "width:100%;margin-top:8px;";
    wrap.appendChild(cornerInput);

    const colHeadersLabel = document.createElement("div");
    colHeadersLabel.style.cssText = "font-size:.74rem;color:var(--ink-soft);margin-top:8px;margin-bottom:3px;";
    colHeadersLabel.textContent = "Sarakeotsikot (kiinteät, ensimmäinen rivi):";
    wrap.appendChild(colHeadersLabel);
    field.tableColHeaders.forEach((val, i) => {
      const inp = textInput(val, v => field.tableColHeaders[i] = v, "Sarake " + (i+2));
      inp.style.cssText = "width:100%;margin-bottom:5px;";
      wrap.appendChild(inp);
    });

    if (field.tableFixedFirstCol){
      const rowHeadersLabel = document.createElement("div");
      rowHeadersLabel.style.cssText = "font-size:.74rem;color:var(--ink-soft);margin-top:6px;margin-bottom:3px;";
      rowHeadersLabel.textContent = "Riviotsikot (kiinteät, ensimmäinen sarake):";
      wrap.appendChild(rowHeadersLabel);
      field.tableRowHeaders.forEach((val, i) => {
        const inp = textInput(val, v => field.tableRowHeaders[i] = v, "Rivi " + (i+2));
        inp.style.cssText = "width:100%;margin-bottom:5px;";
        wrap.appendChild(inp);
      });
    }

    const hint = document.createElement("div");
    hint.style.cssText = "font-size:.74rem;color:var(--ink-soft);margin-top:4px;";
    hint.textContent = "Muut solut jäävät tyhjiksi lomakkeeseen — kentän täyttäjä kirjoittaa ne itse.";
    wrap.appendChild(hint);
    return wrap;
  }

  wrap.appendChild(row2);
  return wrap;
}

/* ---------- Tallennus ---------- */
function validateDef(){
  if (!ed.meta.title || !ed.meta.title.trim()) return "Anna lomakkeelle nimi.";
  if (!ed.sections.length) return "Lisää vähintään yksi osio.";
  for (const sec of ed.sections){
    if (!sec.fields.length) return 'Osiossa "' + sec.title + '" ei ole yhtään kenttää.';
  }
  const sourceMap = {};
  collectSources().forEach(x => { sourceMap[x.key] = x; });
  for (const hf of ed.headerFields){
    if (hf.type === "select" && !(hf.options || []).length) return 'Kohteen tietojen valintakentällä "' + hf.label + '" ei ole vaihtoehtoja.';
  }
  for (const sec of ed.sections){
    const secErr = validateHints(sec.hints, 'osio "' + sec.title + '"', sourceMap);
    if (secErr) return secErr;
    for (const f of sec.fields){
      if (f.type === "select" && !(f.options || []).length) return 'Pudotusvalikolla "' + f.label + '" ei ole vaihtoehtoja.';
      const fErr = validateHints(f.hints, 'kenttä "' + f.label + '"', sourceMap);
      if (fErr) return fErr;
    }
  }
  if (!ed.statusScheme.some(s => s.isDefault)) return "Merkitse jokin tilavaihtoehto oletukseksi.";
  return null;
}

document.getElementById("btnSaveForm").addEventListener("click", async () => {
  const problem = validateDef();
  if (problem){ showToast(problem); return; }

  const btn = document.getElementById("btnSaveForm");
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = "Tallennetaan…";

  const row = {
    title: ed.meta.title,
    tag: ed.meta.tag || null,
    description: ed.meta.desc || null,
    icon: ed.meta.icon || "📋",
    definition: ed
  };

  let result;
  if (editingId){
    result = await supabaseClient.from("forms").update(row).eq("id", editingId).select().single();
  } else {
    result = await supabaseClient.from("forms").insert(row).select().single();
  }

  btn.disabled = false;
  btn.textContent = original;

  if (result.error){
    showToast("Tallennus epäonnistui: " + result.error.message);
    return;
  }

  editingId = result.data.id;
  showToast("Lomake tallennettu.");
  showListView();
});

document.getElementById("btnCancelEdit").addEventListener("click", () => {
  showConfirm("Poistu tallentamatta?", "Tekemättömät muutokset häviävät.", () => {
    showListView();
  });
});

document.getElementById("btnNewForm").addEventListener("click", startNewForm);

/* ---------- Esimerkkipohja: kuntoarvio ohjeilla ---------- */
function exampleDef(){
  const def = blankDef();
  def.meta = {
    title:"Esimerkki: kuntoarvio (ohjeilla)",
    tag:"",
    desc:"Esimerkkipohja, jossa ohjeet näkyvät rakennusvuoden ja rakenteen tyypin mukaan. Muokkaa ohjetekstit omiksi.",
    icon:"🏠"
  };
  const hYear = genId(), hType = genId();
  def.headerFields = [
    { id:genId(), label:"Kohteen osoite", type:"text", full:true },
    { id:genId(), label:"Päivämäärä", type:"date" },
    { id:hYear, label:"Rakennusvuosi", type:"number" },
    { id:hType, label:"Rakennustyyppi", type:"select", options:["Omakotitalo","Rivi- tai paritalo","Kerrostalo","Muu"] }
  ];
  const secAla = genId(), fAlaType = genId(), fAlaKunto = genId();
  const secJul = genId(), fJulKunto = genId();
  const secHai = genId(), fHaiKunto = genId();
  const cond = (source, op, extra) => Object.assign({ id:genId(), source, op, values:[], value:"", value2:"" }, extra);
  def.sections = [
    { id:secAla, title:"Alapohja", hints:[], fields:[
      { id:fAlaType, type:"select", label:"Alapohjan rakenne", allowPhoto:false, options:["Maanvarainen laatta","Tuulettuva ryömintätila","Kellari tai muu"] },
      { id:fAlaKunto, type:"checklist", label:"Alapohjan kunto ja kosteusolosuhteet", allowPhoto:true, allowAction:true, actionLabel:"Toimenpide-ehdotus", hints:[
        { id:genId(), level:"info", match:"all",
          text:"Tarkista ryömintätilan kosteus- ja tuuletusolosuhteet, maanpinnan muodot (vesi ei saa valua rakennuksen alle) sekä mahdollinen orgaaninen aines ja mikrobikasvusto.\nKirjaa myös ilmavuodot ja hajuhavainnot sisätiloissa.",
          conditions:[ cond("f:" + secAla + "_" + fAlaType, "is", { values:["Tuulettuva ryömintätila"] }) ] },
        { id:genId(), level:"info", match:"all",
          text:"Vanhemmissa maanvaraisissa laatoissa lämmöneristys ja kosteudenhallinta eroavat nykyrakenteista. Tarkista lattiapinnoitteiden (esim. muovimatto) alle jäänyt kosteus sekä salaojien ja sokkelin ympäristön kunto.",
          conditions:[ cond("f:" + secAla + "_" + fAlaType, "is", { values:["Maanvarainen laatta"] }), cond("h:" + hYear, "lt", { value:"1980" }) ] }
      ] }
    ] },
    { id:secJul, title:"Julkisivu ja ulkoseinät", fields:[
      { id:fJulKunto, type:"checklist", label:"Ulkoseinien ja julkisivun kunto", allowPhoto:true, allowAction:true, actionLabel:"Toimenpide-ehdotus" }
    ], hints:[
      { id:genId(), level:"info", match:"all",
        text:"Betonielementtirakenteisissa kerrostaloissa tarkista elementtisaumojen ja julkisivupintojen kunto (halkeamat, saumojen irtoaminen, kosteusjäljet sisäpuolella).",
        conditions:[ cond("h:" + hType, "is", { values:["Kerrostalo"] }), cond("h:" + hYear, "between", { value:"1960", value2:"1979" }) ] }
    ] },
    { id:secHai, title:"Haitta-aineet", fields:[
      { id:fHaiKunto, type:"checklist", label:"Haitta-ainehavainnot ja -epäilyt", allowPhoto:true, allowAction:true, actionLabel:"Toimenpide-ehdotus" }
    ], hints:[
      { id:genId(), level:"warn", match:"all",
        text:"Rakennusvuosi ennen vuotta 1994: rakennusmateriaaleissa voi olla asbestia (esim. tasoitteet, laatta- ja mattoliimat, levyt). Merkitse epäilyt raporttiin ja suosita haitta-ainekartoitusta ennen korjaus- tai purkutöitä.",
        conditions:[ cond("h:" + hYear, "lt", { value:"1994" }) ] },
      { id:genId(), level:"warn", match:"all",
        text:"Rakennusvuosi 1955–1975: elastisissa saumausmassoissa voi olla PCB:tä. Huomioi saumat ikkunoiden ja elementtien ympärillä.",
        conditions:[ cond("h:" + hYear, "between", { value:"1955", value2:"1975" }) ] }
    ] }
  ];
  return def;
}

document.getElementById("btnExampleForm").addEventListener("click", () => {
  editingId = null;
  ed = exampleDef();
  showEditView();
});


/* ---------- Käynnistys ---------- */
function waitForSupabaseClient(cb, triesLeft){
  if (typeof triesLeft !== "number") triesLeft = 100;
  if (window.__supabaseClient) return cb(window.__supabaseClient);
  if (triesLeft <= 0){ fatalError("Supabase-yhteyttä ei saatu muodostettua (auth-gate.js ei latautunut)."); return; }
  setTimeout(() => waitForSupabaseClient(cb, triesLeft - 1), 50);
}

waitForSupabaseClient((client) => {
  supabaseClient = client;
  showListView();
});
