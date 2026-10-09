"use strict";
/* =========================================================================
   STYLE-EDITOR-RUNTIME.JS
   Yhteinen Word-ulkoasueditori. Käytetään URL-parametreilla:
     style-editor.html?form=<form_key>&label=<Näkyvä nimi>&back=<paluu-url>
   form_key on kiinteä merkkijono staattisille lomakkeille tai editorilla
   luodun lomakkeen uuid.
   ========================================================================= */

let supabaseClient = null;
let FORM_KEY = null;
let BACK_URL = null;
let style = null;

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

function fieldRow(labelText, inputEl){
  const wrap = document.createElement("div");
  wrap.className = "field";
  const label = document.createElement("label");
  label.textContent = labelText;
  wrap.appendChild(label);
  wrap.appendChild(inputEl);
  return wrap;
}

function toggleRow(labelText, checked, onChange){
  const wrap = document.createElement("label");
  wrap.style.cssText = "display:flex;align-items:center;gap:8px;font-size:.88rem;color:var(--ink);margin-bottom:10px;";
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.checked = !!checked;
  cb.addEventListener("change", () => onChange(cb.checked));
  wrap.appendChild(cb);
  wrap.appendChild(document.createTextNode(labelText));
  return { wrap, checkbox: cb };
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

function textareaInput(value, onInput, placeholder){
  const input = document.createElement("textarea");
  input.autocomplete = "off";
  input.value = value || "";
  input.style.minHeight = "70px";
  if (placeholder) input.placeholder = placeholder;
  input.addEventListener("input", () => onInput(input.value));
  return input;
}

function colorPicker(value, onChange){
  const input = document.createElement("input");
  input.type = "color";
  input.value = value || "#000000";
  input.style.cssText = "width:60px;height:38px;border:none;border-radius:7px;padding:0;";
  input.addEventListener("input", () => onChange(input.value));
  return input;
}

function alignSelect(value, onChange){
  const sel = document.createElement("select");
  sel.className = "type-select";
  sel.style.width = "100%";
  [["left","Vasemmalle"],["center","Keskelle"],["right","Oikealle"]].forEach(([v,label]) => {
    const o = document.createElement("option");
    o.value = v; o.textContent = label;
    if (v === value) o.selected = true;
    sel.appendChild(o);
  });
  sel.addEventListener("change", () => onChange(sel.value));
  return sel;
}

function sizeSelect(value, choices, onChange){
  const sel = document.createElement("select");
  sel.className = "type-select";
  sel.style.width = "100%";
  choices.forEach(pt => {
    const o = document.createElement("option");
    o.value = pt; o.textContent = pt + " pt";
    if (Number(value) === pt) o.selected = true;
    sel.appendChild(o);
  });
  sel.addEventListener("change", () => onChange(Number(sel.value)));
  return sel;
}

function renderEditor(){
  const root = document.getElementById("editorRoot");
  root.innerHTML = "";
  root.appendChild(buildCoverCard());
  root.appendChild(buildHeaderCard());
  root.appendChild(buildFooterCard());
  root.appendChild(buildFontsCard());
  root.appendChild(buildNumberingCard());
  root.appendChild(buildTocCard());
  root.appendChild(buildPagesCard("Vakiotekstisivut ennen lomaketta", "pagesBefore"));
  root.appendChild(buildPagesCard("Vakiotekstisivut lomakkeen jälkeen", "pagesAfter"));
}

function buildTocCard(){
  const card = document.createElement("section");
  card.className = "card";
  card.innerHTML = '<div class="card-header"><h2>Sisällysluettelo</h2></div>';
  const body = document.createElement("div");
  body.className = "card-body";

  if (!style.toc) style.toc = { enabled:false, variant:"classic" };

  const t = toggleRow("Lisää sisällysluettelo (heti kansilehden jälkeen)", style.toc.enabled, (v) => {
    style.toc.enabled = v;
    renderEditor();
  });
  body.appendChild(t.wrap);

  if (style.toc.enabled){
    const variantWrap = document.createElement("div");
    variantWrap.className = "field";
    const variantLabel = document.createElement("label");
    variantLabel.textContent = "Luettelon tyyli";
    variantWrap.appendChild(variantLabel);
    const variantSelect = document.createElement("select");
    variantSelect.className = "type-select";
    variantSelect.style.width = "100%";
    [["classic","Sivunumeroilla ja pisteviivalla"],["simple","Yksinkertainen (vain otsikot)"]].forEach(([v,label]) => {
      const o = document.createElement("option");
      o.value = v; o.textContent = label;
      if (style.toc.variant === v) o.selected = true;
      variantSelect.appendChild(o);
    });
    variantSelect.addEventListener("change", () => style.toc.variant = variantSelect.value);
    variantWrap.appendChild(variantSelect);
    body.appendChild(variantWrap);

    const hint = document.createElement("div");
    hint.style.cssText = "font-size:.76rem;color:var(--ink-soft);margin-top:-4px;";
    hint.textContent = "Sisällysluettelo poimii lomakkeen osioiden otsikot sekä alla lisättävien vakiotekstisivujen otsikot. Word näyttää tekstin \"Päivitä kenttä painamalla F9\" — se päivittyy automaattisesti oikeiksi sivunumeroiksi, kun tiedosto avataan Wordissa.";
    body.appendChild(hint);
  }

  card.appendChild(body);
  return card;
}

const BLOCK_TYPES = [
  ["heading", "Otsikko"],
  ["subheading", "Väliotsikko"],
  ["paragraph", "Kappale"],
  ["bullets", "Luettelo (luettelomerkit)"],
  ["numbered", "Numeroitu luettelo"]
];

function blockTypeSelect(value, onChange){
  const sel = document.createElement("select");
  sel.className = "type-select";
  sel.style.width = "auto";
  BLOCK_TYPES.forEach(([v,label]) => {
    const o = document.createElement("option");
    o.value = v; o.textContent = label;
    if (v === value) o.selected = true;
    sel.appendChild(o);
  });
  sel.addEventListener("change", () => onChange(sel.value));
  return sel;
}


/* ---------- Rikas teksti (lihavointi + väri yksittäiselle sanalle) ---------- */
const RICH_COLORS = ["#000000","#c0392b","#d35400","#1e7a46","#1f5fa8","#7a3fa0"];

function richRunsToHtml(runs){
  const esc = t => String(t).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  return (runs || []).map(r => {
    let h = esc(r.text || "").replace(/\n/g, "<br>");
    if (r.color) h = '<span style="color:' + r.color + '">' + h + '</span>';
    if (r.bold) h = "<b>" + h + "</b>";
    return h;
  }).join("");
}

function plainToRuns(text){ return text ? [{ text: String(text) }] : []; }

function rgbToHex(c){
  if (!c) return "";
  c = c.trim();
  if (/^#[0-9a-f]{6}$/i.test(c)) return c.toLowerCase();
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c);
  if (!m) return "";
  return "#" + [m[1],m[2],m[3]].map(n => ("0" + Number(n).toString(16)).slice(-2)).join("");
}

// Lukee contenteditable-elementin riveiksi, joista kukin on lista {text,bold,color}-pätkiä.
function richParseLines(root){
  const lines = [];
  let cur = [];
  const flush = () => { lines.push(cur); cur = []; };
  function push(text, fmt){
    const last = cur[cur.length - 1];
    if (last && !!last.bold === !!fmt.bold && (last.color || "") === (fmt.color || "")) last.text += text;
    else { const r = { text }; if (fmt.bold) r.bold = true; if (fmt.color) r.color = fmt.color; cur.push(r); }
  }
  function walk(node, fmt){
    if (node.nodeType === 3){
      const t = node.nodeValue.replace(/\u00a0/g, " ");
      if (t) push(t, fmt);
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = node.tagName;
    if (tag === "BR"){ flush(); return; }
    const f = Object.assign({}, fmt);
    if (tag === "B" || tag === "STRONG") f.bold = true;
    const fw = node.style && node.style.fontWeight;
    if (fw === "bold" || (fw && Number(fw) >= 600)) f.bold = true;
    if (fw === "normal" || (fw && Number(fw) > 0 && Number(fw) < 600)) f.bold = false;
    if (tag === "FONT" && node.getAttribute("color")) f.color = rgbToHex(node.getAttribute("color")) || f.color;
    if (node.style && node.style.color) f.color = rgbToHex(node.style.color) || f.color;
    const isBlock = tag === "DIV" || tag === "P" || tag === "LI";
    if (isBlock && cur.length) flush();
    node.childNodes.forEach(ch => walk(ch, f));
    if (isBlock && cur.length) flush();
  }
  root.childNodes.forEach(ch => walk(ch, {}));
  if (cur.length) flush();
  return lines;
}

function richLinesToRuns(lines){
  const out = [];
  lines.forEach((line, i) => {
    if (i > 0) out.push({ text: "\n" });
    line.forEach(r => out.push(r));
  });
  return out;
}

function runsToLines(runs){
  const lines = [[]];
  (runs || []).forEach(r => {
    String(r.text || "").split("\n").forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (part) { const x = { text: part }; if (r.bold) x.bold = true; if (r.color) x.color = r.color; lines[lines.length - 1].push(x); }
    });
  });
  return lines;
}

/*
 * Rikastekstieditori. mode "paragraph": koko sisältö = b.runs (rivinvaihdot "\n").
 * mode "list": jokainen rivi = yksi kohta (b.itemRuns).
 * b.text / b.items pidetään rinnalla pelkkänä tekstinä (vanhat tallenteet ja varalle).
 */
function richEditor(b, mode, placeholder, baseColorFn){
  const wrap = document.createElement("div");

  const bar = document.createElement("div");
  bar.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:6px;";
  const ed = document.createElement("div");
  ed.contentEditable = "true";
  ed.setAttribute("role", "textbox");
  ed.setAttribute("aria-multiline", "true");
  ed.style.cssText = "min-height:80px;padding:9px 11px;border:1px solid var(--line-strong);border-radius:8px;background:#fff;white-space:pre-wrap;word-break:break-word;font-size:.92rem;line-height:1.4;outline:none;";
  ed.style.color = baseColorFn();
  ed.dataset.placeholder = placeholder || "";

  const initial = mode === "list"
    ? (Array.isArray(b.itemRuns) && b.itemRuns.length ? richLinesToRuns(b.itemRuns) : plainToRuns((b.items || []).join("\n")))
    : (Array.isArray(b.runs) && b.runs.length ? b.runs : plainToRuns(b.text));
  ed.innerHTML = richRunsToHtml(initial);

  function sync(){
    const lines = richParseLines(ed);
    if (mode === "list"){
      b.itemRuns = lines;
      b.items = lines.map(l => l.map(r => r.text).join(""));
    } else {
      b.runs = richLinesToRuns(lines);
      b.text = b.runs.map(r => r.text).join("");
    }
  }
  ed.addEventListener("input", sync);
  ed.addEventListener("paste", (e) => {
    e.preventDefault();
    const t = (e.clipboardData || window.clipboardData).getData("text/plain");
    document.execCommand("insertText", false, t);
  });

  // Valinta talteen, jotta värinvalitsimen avaaminen ei hukkaa sitä.
  let savedRange = null;
  function saveSel(){
    const sel = window.getSelection();
    if (sel.rangeCount && ed.contains(sel.anchorNode)) savedRange = sel.getRangeAt(0).cloneRange();
  }
  ["keyup","mouseup","touchend","blur"].forEach(ev => ed.addEventListener(ev, saveSel));
  document.addEventListener("selectionchange", () => { if (document.activeElement === ed) saveSel(); });
  function restoreSel(){
    ed.focus();
    if (savedRange){ const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(savedRange); }
  }
  function applyCmd(cmd, val){
    restoreSel();
    document.execCommand("styleWithCSS", false, true);
    document.execCommand(cmd, false, val);
    saveSel();
    sync();
  }
  function barBtn(label, title, onClick, extraStyle){
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "icon-btn";
    btn.title = title;
    btn.style.cssText = "min-width:34px;" + (extraStyle || "");
    btn.innerHTML = label;
    btn.addEventListener("mousedown", (e) => e.preventDefault()); // säilytä valinta
    btn.addEventListener("click", onClick);
    return btn;
  }
  bar.appendChild(barBtn("<b>B</b>", "Lihavoi valittu teksti", () => applyCmd("bold")));
  RICH_COLORS.forEach(c => {
    bar.appendChild(barBtn("A", "Vaihda valitun tekstin väri", () => applyCmd("foreColor", c), "color:" + c + ";font-weight:700;"));
  });
  const custom = document.createElement("input");
  custom.type = "color";
  custom.title = "Oma väri valitulle tekstille";
  custom.value = "#c0392b";
  custom.style.cssText = "width:34px;height:30px;border:none;padding:0;background:none;";
  custom.addEventListener("change", () => applyCmd("foreColor", custom.value));
  bar.appendChild(custom);
  bar.appendChild(barBtn("Tyhjennä", "Poista lihavointi ja väri valitulta tekstiltä", () => applyCmd("removeFormat"), "font-size:.74rem;"));

  wrap.appendChild(bar);
  wrap.appendChild(ed);
  const hint = document.createElement("div");
  hint.style.cssText = "font-size:.74rem;color:var(--ink-soft);margin-top:4px;";
  hint.textContent = mode === "list"
    ? "Yksi kohta per rivi (Enter = uusi kohta). Valitse sana ja paina B tai väriä."
    : "Valitse sana tai lause ja paina B (lihavointi) tai väriä — voit muotoilla myös yksittäisen sanan lauseen keskeltä.";
  wrap.appendChild(hint);
  wrap.setBaseColor = c => { ed.style.color = c; };
  return wrap;
}

function renderBlockEditor(blocks, idx, rerenderBlocks){
  const b = blocks[idx];
  const wrap = document.createElement("div");
  wrap.className = "section-block";
  wrap.style.cssText = "background:var(--paper);margin-top:8px;padding:10px;";

  const head = document.createElement("div");
  head.style.cssText = "display:flex;gap:6px;align-items:center;margin-bottom:6px;";

  const typeSel = blockTypeSelect(b.type, (v) => {
    const wasList = b.type === "bullets" || b.type === "numbered";
    const toList = v === "bullets" || v === "numbered";
    if (!wasList && toList){
      const lines = (Array.isArray(b.runs) && b.runs.length) ? runsToLines(b.runs) : String(b.text || "").split("\n").map(t => t ? [{ text:t }] : []);
      b.itemRuns = lines.length ? lines : [[]];
      b.items = b.itemRuns.map(l => l.map(r => r.text).join(""));
    } else if (wasList && !toList){
      b.runs = (Array.isArray(b.itemRuns) && b.itemRuns.length) ? richLinesToRuns(b.itemRuns) : plainToRuns((b.items || []).join("\n"));
      b.text = b.runs.map(r => r.text).join("");
    }
    if (v === "heading" || v === "subheading"){
      b.text = (b.runs && b.runs.length ? b.runs.map(r => r.text).join("") : (wasList ? (b.items || []).join("\n") : b.text)) || "";
    }
    b.type = v;
    if (toList && !b.items) b.items = [""];
    rerenderBlocks();
  });
  head.appendChild(typeSel);

  const spacer = document.createElement("div");
  spacer.style.flex = "1";
  head.appendChild(spacer);

  const upBtn = document.createElement("button");
  upBtn.type = "button"; upBtn.className = "icon-btn"; upBtn.textContent = "↑";
  upBtn.disabled = idx === 0;
  upBtn.addEventListener("click", () => {
    if (idx === 0) return;
    const tmp = blocks[idx-1]; blocks[idx-1] = blocks[idx]; blocks[idx] = tmp;
    rerenderBlocks();
  });
  const downBtn = document.createElement("button");
  downBtn.type = "button"; downBtn.className = "icon-btn"; downBtn.textContent = "↓";
  downBtn.disabled = idx === blocks.length - 1;
  downBtn.addEventListener("click", () => {
    if (idx === blocks.length - 1) return;
    const tmp = blocks[idx+1]; blocks[idx+1] = blocks[idx]; blocks[idx] = tmp;
    rerenderBlocks();
  });
  const delBtn = document.createElement("button");
  delBtn.type = "button"; delBtn.className = "icon-btn icon-btn-danger"; delBtn.textContent = "✕";
  delBtn.addEventListener("click", () => { blocks.splice(idx,1); rerenderBlocks(); });

  head.appendChild(upBtn);
  head.appendChild(downBtn);
  head.appendChild(delBtn);
  wrap.appendChild(head);

  if (b.type === "heading"){
    const t = textInput(b.text, v => b.text = v, "Otsikon teksti");
    t.style.width = "100%";
    wrap.appendChild(t);
  } else if (b.type === "subheading"){
    const t = textInput(b.text, v => b.text = v, "Väliotsikon teksti");
    t.style.width = "100%";
    wrap.appendChild(t);
    const colorRow = document.createElement("div");
    colorRow.style.cssText = "display:flex;align-items:center;gap:8px;margin-top:6px;font-size:.78rem;color:var(--ink-soft);";
    colorRow.appendChild(document.createTextNode("Väri"));
    colorRow.appendChild(colorPicker(b.color || style.colors.heading, v => b.color = v));
    wrap.appendChild(colorRow);
  } else if (b.type === "paragraph"){
    const re = richEditor(b, "paragraph", "Kappaleen teksti…", () => b.color || style.colors.body);
    wrap.appendChild(re);
    const colorRow = document.createElement("div");
    colorRow.style.cssText = "display:flex;align-items:center;gap:8px;margin-top:6px;font-size:.78rem;color:var(--ink-soft);";
    colorRow.appendChild(document.createTextNode("Koko kappaleen oletusväri"));
    colorRow.appendChild(colorPicker(b.color || style.colors.body, v => { b.color = v; re.setBaseColor(v); }));
    wrap.appendChild(colorRow);
  } else if (b.type === "bullets" || b.type === "numbered"){
    const re = richEditor(b, "list", "Yksi kohta per rivi…", () => b.color || style.colors.body);
    wrap.appendChild(re);
    const colorRow = document.createElement("div");
    colorRow.style.cssText = "display:flex;align-items:center;gap:8px;margin-top:6px;font-size:.78rem;color:var(--ink-soft);";
    colorRow.appendChild(document.createTextNode("Koko luettelon oletusväri"));
    colorRow.appendChild(colorPicker(b.color || style.colors.body, v => { b.color = v; re.setBaseColor(v); }));
    wrap.appendChild(colorRow);
  }

  return wrap;
}

function buildPagesCard(titleText, key){
  const card = document.createElement("section");
  card.className = "card";
  card.innerHTML = '<div class="card-header"><h2>' + titleText + '</h2></div>';
  const body = document.createElement("div");
  body.className = "card-body";

  if (!style[key]) style[key] = [];
  const pages = style[key];

  // Migroi vanhat "content"-sivut blocks-muotoon kertaalleen, jotta editori
  // näyttää ne heti uudessa lohkoeditorissa ja tallennus tapahtuu jatkossa
  // blocks-muodossa. docx-vienti osaisi lukea kumpaakin joka tapauksessa.
  pages.forEach(page => {
    if (!page.blocks){
      page.blocks = window.DocxStyleEngine.normalizePage(page);
      delete page.content;
    }
  });

  pages.forEach((page, idx) => {
    const pageEl = document.createElement("div");
    pageEl.className = "section-block";

    const head = document.createElement("div");
    head.className = "section-block-head";
    const titleInput = textInput(page.title, v => page.title = v, "Sivun otsikko");
    titleInput.style.flex = "1";
    const upBtn = document.createElement("button");
    upBtn.type = "button"; upBtn.className = "icon-btn"; upBtn.textContent = "↑";
    upBtn.disabled = idx === 0;
    upBtn.addEventListener("click", () => {
      if (idx === 0) return;
      const tmp = pages[idx-1]; pages[idx-1] = pages[idx]; pages[idx] = tmp;
      renderEditor();
    });
    const downBtn = document.createElement("button");
    downBtn.type = "button"; downBtn.className = "icon-btn"; downBtn.textContent = "↓";
    downBtn.disabled = idx === pages.length - 1;
    downBtn.addEventListener("click", () => {
      if (idx === pages.length - 1) return;
      const tmp = pages[idx+1]; pages[idx+1] = pages[idx]; pages[idx] = tmp;
      renderEditor();
    });
    const delBtn = document.createElement("button");
    delBtn.type = "button"; delBtn.className = "icon-btn icon-btn-danger"; delBtn.textContent = "✕";
    delBtn.addEventListener("click", () => { pages.splice(idx,1); renderEditor(); });

    head.appendChild(titleInput);
    head.appendChild(upBtn);
    head.appendChild(downBtn);
    head.appendChild(delBtn);
    pageEl.appendChild(head);

    pageEl.appendChild(buildDocxSourceControl(page, page.id, renderEditor));

    if ((page.sourceMode || "generated") !== "docx"){
      const blocksWrap = document.createElement("div");
      pageEl.appendChild(blocksWrap);

      function rerenderBlocks(){
        blocksWrap.innerHTML = "";
        page.blocks.forEach((b, bIdx) => {
          blocksWrap.appendChild(renderBlockEditor(page.blocks, bIdx, rerenderBlocks));
        });
      }
      rerenderBlocks();

      const addBlockRow = document.createElement("div");
      addBlockRow.style.cssText = "display:flex;gap:6px;margin-top:8px;";
      const newBlockType = { value: "paragraph" };
      const addTypeSel = blockTypeSelect(newBlockType.value, v => newBlockType.value = v);
      addTypeSel.style.flex = "1";
      const addBlockBtn = document.createElement("button");
      addBlockBtn.type = "button";
      addBlockBtn.className = "add-row-btn";
      addBlockBtn.style.marginTop = "0";
      addBlockBtn.textContent = "+ Lisää lohko";
      addBlockBtn.addEventListener("click", () => {
        const t = newBlockType.value;
        const blk = { type: t };
        if (t === "bullets" || t === "numbered") blk.items = [""];
        else blk.text = "";
        page.blocks.push(blk);
        rerenderBlocks();
      });
      addBlockRow.appendChild(addTypeSel);
      addBlockRow.appendChild(addBlockBtn);
      pageEl.appendChild(addBlockRow);
    }

    body.appendChild(pageEl);
  });

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "add-row-btn";
  addBtn.textContent = "+ Lisää sivu";
  addBtn.addEventListener("click", () => {
    pages.push({ id: "pg" + Date.now(), title:"Uusi sivu", blocks:[{ type:"paragraph", text:"" }] });
    renderEditor();
  });
  body.appendChild(addBtn);

  card.appendChild(body);
  return card;
}

function buildCoverCard(){
  const card = document.createElement("section");
  card.className = "card";
  card.innerHTML = '<div class="card-header"><h2>Kansilehti</h2></div>';
  const body = document.createElement("div");
  body.className = "card-body";

  const t = toggleRow("Lisää erillinen kansilehti raportin alkuun", style.coverPage.enabled, (v) => {
    style.coverPage.enabled = v;
    renderEditor();
  });
  body.appendChild(t.wrap);

  if (style.coverPage.enabled){
    body.appendChild(buildDocxSourceControl(style.coverPage, "cover", renderEditor));
  }

  if (style.coverPage.enabled && style.coverPage.sourceMode !== "docx"){
    body.appendChild(fieldRow("Otsikko (tyhjä = lomakkeen nimi)", textInput(style.coverPage.title, v => style.coverPage.title = v, "esim. Kuntotarkastusraportti")));
    body.appendChild(fieldRow("Alaotsikko", textInput(style.coverPage.subtitle, v => style.coverPage.subtitle = v, "esim. Osoite tai tilaaja")));
    body.appendChild(fieldRow("Korostusviivan väri (otsikon alla)", colorPicker(style.coverPage.accentColor, v => style.coverPage.accentColor = v)));
    body.appendChild(fieldRow("Yritystiedot (näytetään kansilehden alaosassa)", textareaInput(style.coverPage.companyInfo, v => style.coverPage.companyInfo = v, "esim. Yritys Oy\nOsoite\nwww.yritys.fi")));

    const logoWrap = document.createElement("div");
    logoWrap.className = "field";
    const logoLabel = document.createElement("label");
    logoLabel.textContent = "Logo";
    logoWrap.appendChild(logoLabel);

    if (style.coverPage.logoDataUrl){
      const preview = document.createElement("img");
      preview.src = style.coverPage.logoDataUrl;
      preview.style.cssText = "max-width:140px;max-height:90px;display:block;margin-bottom:8px;border:1px solid var(--line-strong);border-radius:6px;background:#fff;padding:4px;";
      logoWrap.appendChild(preview);
      const rmBtn = document.createElement("button");
      rmBtn.type = "button";
      rmBtn.className = "fr-btn fr-btn-danger";
      rmBtn.textContent = "Poista logo";
      rmBtn.style.marginBottom = "8px";
      rmBtn.addEventListener("click", () => { style.coverPage.logoDataUrl = ""; renderEditor(); });
      logoWrap.appendChild(rmBtn);
    }

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.id = "logoFileInput";
    fileInput.accept = "image/*";
    fileInput.addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      try{
        const dataUrl = await resizeImageToDataUrl(file, 500);
        style.coverPage.logoDataUrl = dataUrl;
        renderEditor();
      }catch(err){
        showToast("Logon käsittely epäonnistui.");
      }
    });
    logoWrap.appendChild(fileInput);

    const pickBtn = document.createElement("button");
    pickBtn.type = "button";
    pickBtn.className = "add-row-btn";
    pickBtn.style.marginTop = "0";
    pickBtn.textContent = style.coverPage.logoDataUrl ? "Vaihda logo" : "Valitse logo";
    pickBtn.addEventListener("click", () => fileInput.click());
    logoWrap.appendChild(pickBtn);
    body.appendChild(logoWrap);
  }

  card.appendChild(body);
  return card;
}

/*
 * Käyttäjän lataamat .docx-liitteet (kansilehti tai vakiotekstisivu)
 * tallennetaan samaan Storage-buckettiin kuin lomaketäyttöjen valokuvat.
 * Jos organisaatiossa on tarkoituksenmukaisempaa käyttää erillistä buckettia,
 * vaihda vakio alle (bucket pitää luoda ja sille pitää olla RLS-käytännöt
 * valmiina Supabasen hallintapaneelissa).
 */
const DOC_ATTACHMENT_BUCKET = "submission-photos";
const MAX_DOCX_SIZE_BYTES = 8 * 1024 * 1024; // 8 MB

let cachedUserId = null;
async function getUserIdCached(){
  if (cachedUserId) return cachedUserId;
  const { data, error } = await supabaseClient.auth.getUser();
  if (error || !data || !data.user) throw new Error("Käyttäjää ei tunnistettu.");
  cachedUserId = data.user.id;
  return cachedUserId;
}

function docxSlotPath(userId, slotName){
  return userId + "/doc-style/" + encodeURIComponent(FORM_KEY) + "/" + slotName + ".docx";
}

async function uploadDocxAttachment(file, slotName){
  if (!file.name.toLowerCase().endsWith(".docx")){
    throw new Error("Vain .docx-tiedostot ovat tuettuja.");
  }
  if (file.size > MAX_DOCX_SIZE_BYTES){
    throw new Error("Tiedosto on liian suuri (max " + (MAX_DOCX_SIZE_BYTES/1024/1024) + " MB).");
  }
  const userId = await getUserIdCached();
  const path = docxSlotPath(userId, slotName);
  const { error } = await supabaseClient.storage.from(DOC_ATTACHMENT_BUCKET)
    .upload(path, file, { upsert:true, contentType: file.type || "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  if (error) throw error;
  return path;
}

async function removeDocxAttachment(path){
  if (!path) return;
  try{
    await supabaseClient.storage.from(DOC_ATTACHMENT_BUCKET).remove([path]);
  }catch(err){
    console.warn("Liitetiedoston poisto tallennustilasta epäonnistui", err);
  }
}

/*
 * Rakentaa yhden "sisällön lähde: Sovelluksen luoma / Oma Word-tiedosto"
 * -osion. target on kohdeobjekti (style.coverPage tai yksittäinen sivu),
 * jolle asetetaan sourceMode/docxPath/docxFileName. slotName on vakaa
 * tunniste, jolla liite tallennetaan Storageen (esim. "cover" tai sivun id).
 */
function buildDocxSourceControl(target, slotName, onRerender){
  const wrap = document.createElement("div");
  wrap.style.cssText = "margin:8px 0;padding:10px;background:var(--paper);border-radius:8px;";

  const modeRow = document.createElement("div");
  modeRow.style.cssText = "display:flex;gap:14px;font-size:.82rem;margin-bottom:8px;";
  ["generated","docx"].forEach(mode => {
    const lbl = document.createElement("label");
    lbl.style.cssText = "display:flex;align-items:center;gap:5px;cursor:pointer;";
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "srcmode-" + slotName;
    radio.checked = (target.sourceMode || "generated") === mode;
    radio.addEventListener("change", () => {
      if (!radio.checked) return;
      target.sourceMode = mode;
      onRerender();
    });
    lbl.appendChild(radio);
    lbl.appendChild(document.createTextNode(mode === "docx" ? "Oma Word-tiedosto (.docx)" : "Sovelluksen luoma"));
    modeRow.appendChild(lbl);
  });
  wrap.appendChild(modeRow);

  if (target.sourceMode === "docx"){
    if (target.docxFileName){
      const info = document.createElement("div");
      info.style.cssText = "font-size:.82rem;margin-bottom:6px;display:flex;align-items:center;gap:8px;";
      info.appendChild(document.createTextNode("📎 " + target.docxFileName));
      const rmBtn = document.createElement("button");
      rmBtn.type = "button";
      rmBtn.className = "fr-btn fr-btn-danger";
      rmBtn.textContent = "Poista liite";
      rmBtn.addEventListener("click", async () => {
        await removeDocxAttachment(target.docxPath);
        target.docxPath = "";
        target.docxFileName = "";
        onRerender();
      });
      info.appendChild(rmBtn);
      wrap.appendChild(info);
    } else {
      const hint = document.createElement("div");
      hint.style.cssText = "font-size:.78rem;color:var(--ink-soft);margin-bottom:6px;";
      hint.textContent = "Ei vielä ladattua tiedostoa. Vientiin tulee huomautus, jos tiedosto puuttuu.";
      wrap.appendChild(hint);
    }

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".docx";
    fileInput.style.display = "none";
    fileInput.addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      pickBtn.disabled = true;
      pickBtn.textContent = "Ladataan…";
      try{
        const path = await uploadDocxAttachment(file, slotName);
        target.docxPath = path;
        target.docxFileName = file.name;
        onRerender();
      }catch(err){
        showToast("Tiedoston lataus epäonnistui: " + (err.message || err));
        pickBtn.disabled = false;
        pickBtn.textContent = target.docxFileName ? "Vaihda tiedosto" : "Valitse .docx-tiedosto";
      }
    });
    wrap.appendChild(fileInput);

    const pickBtn = document.createElement("button");
    pickBtn.type = "button";
    pickBtn.className = "add-row-btn";
    pickBtn.style.marginTop = "0";
    pickBtn.textContent = target.docxFileName ? "Vaihda tiedosto" : "Valitse .docx-tiedosto";
    pickBtn.addEventListener("click", () => fileInput.click());
    wrap.appendChild(pickBtn);

    const note = document.createElement("div");
    note.style.cssText = "font-size:.74rem;color:var(--ink-soft);margin-top:6px;";
    note.textContent = "Word yhdistää tiedostosi sisällön (tekstit, muotoilut, kuvat) automaattisesti raporttiin sitä avattaessa — oma muotoilusi säilyy sellaisenaan.";
    wrap.appendChild(note);
  }

  return wrap;
}

function resizeImageToDataUrl(file, maxDim){
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => { img.src = reader.result; };
    reader.onerror = reject;
    img.onload = () => {
      let w = img.naturalWidth, h = img.naturalHeight;
      if (w > maxDim || h > maxDim){
        const scale = maxDim / Math.max(w,h);
        w = Math.round(w*scale); h = Math.round(h*scale);
      }
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function buildHeaderCard(){ return buildHeaderFooterCard("header", "Ylätunniste", "Näytä ylätunniste jokaisella sivulla"); }
function buildFooterCard(){ return buildHeaderFooterCard("footer", "Alatunniste", "Näytä alatunniste jokaisella sivulla"); }

/* Ylä- ja alatunniste ovat samanlaiset: kolme kenttää (vasen, keski, oikea),
   joihin kuhunkin valitaan sisältötyyppi ja tarvittaessa sisältö. */
function buildHeaderFooterCard(key, titleText, toggleLabel){
  const hf = style[key];
  const card = document.createElement("section");
  card.className = "card";
  card.innerHTML = '<div class="card-header"><h2>' + titleText + '</h2></div>';
  const body = document.createElement("div");
  body.className = "card-body";

  body.appendChild(toggleRow(toggleLabel, hf.enabled, (v) => { hf.enabled = v; renderEditor(); }).wrap);

  if (hf.enabled){
    body.appendChild(fieldRow("Fonttikoko", sizeSelect(hf.fontSize || 9, [7,8,9,10,11,12,14], v => hf.fontSize = v)));
    body.appendChild(fieldRow("Väri", colorPicker(hf.color || "#7a7566", v => hf.color = v)));

    [["left","Vasen kenttä"],["center","Keskikenttä"],["right","Oikea kenttä"]].forEach(([k, label]) => {
      const slot = hf[k];
      const box = document.createElement("div");
      box.style.cssText = "margin:8px 0;padding:10px;background:var(--paper);border-radius:8px;";
      const sel = document.createElement("select");
      sel.className = "type-select";
      sel.style.width = "100%";
      window.DocxStyleEngine.HF_SLOT_TYPES.forEach(([v, l]) => {
        const o = document.createElement("option");
        o.value = v; o.textContent = l;
        if (slot.type === v) o.selected = true;
        sel.appendChild(o);
      });
      sel.addEventListener("change", () => { slot.type = sel.value; renderEditor(); });
      box.appendChild(fieldRow(label + " — sisältö", sel));

      if (slot.type === "text"){
        box.appendChild(fieldRow("Teksti (voi olla useampi rivi)", textareaInput(slot.text, v => slot.text = v, "esim. Yritys Oy")));
      } else if (slot.type === "date"){
        const h = document.createElement("div");
        h.style.cssText = "font-size:.76rem;color:var(--ink-soft);";
        h.textContent = "Näyttää Word-tiedoston luontipäivän.";
        box.appendChild(h);
      } else if (slot.type === "title"){
        const h = document.createElement("div");
        h.style.cssText = "font-size:.76rem;color:var(--ink-soft);";
        h.textContent = "Näyttää lomakkeen/raportin nimen.";
        box.appendChild(h);
      } else if (slot.type === "logo" && !style.coverPage.logoDataUrl){
        const h = document.createElement("div");
        h.style.cssText = "font-size:.76rem;color:var(--ink-soft);";
        h.textContent = "Lisää ensin logo Kansilehti-kortista (Sovelluksen luoma -tila), niin se näkyy tässä.";
        box.appendChild(h);
      }
      body.appendChild(box);
    });
  }

  card.appendChild(body);
  return card;
}

function buildNumberingCard(){
  const card = document.createElement("section");
  card.className = "card";
  card.innerHTML = '<div class="card-header"><h2>Otsikoiden numerointi</h2></div>';
  const body = document.createElement("div");
  body.className = "card-body";
  if (!style.headingNumbering) style.headingNumbering = { enabled:true };
  const sel = document.createElement("select");
  sel.className = "type-select";
  sel.style.width = "100%";
  [["1","Numeroitu (1, 1.1, 1.1.1)"],["0","Ei numerointia"]].forEach(([v,l]) => {
    const o = document.createElement("option");
    o.value = v; o.textContent = l;
    if ((v === "1") === (style.headingNumbering.enabled !== false)) o.selected = true;
    sel.appendChild(o);
  });
  sel.addEventListener("change", () => style.headingNumbering.enabled = sel.value === "1");
  body.appendChild(fieldRow("Otsikkotyyli Word-raportissa", sel));
  const hint = document.createElement("div");
  hint.style.cssText = "font-size:.76rem;color:var(--ink-soft);";
  hint.textContent = "Numerointi tulee Wordin otsikkotyylistä: pääotsikko 1, alaotsikko 1.1, sen alaotsikko 1.1.1. Osioiden nimiin ei lisätä numeroa erikseen, joten numerot eivät tuplaudu.";
  body.appendChild(hint);
  card.appendChild(body);
  return card;
}

function fontSelect(value, onChange){
  const sel = document.createElement("select");
  sel.className = "type-select";
  sel.style.width = "100%";
  window.DocxStyleEngine.FONT_CHOICES.forEach(f => {
    const o = document.createElement("option");
    o.value = f; o.textContent = f;
    if (f === value) o.selected = true;
    sel.appendChild(o);
  });
  sel.addEventListener("change", () => onChange(sel.value));
  return sel;
}

function buildFontsCard(){
  const card = document.createElement("section");
  card.className = "card";
  card.innerHTML = '<div class="card-header"><h2>Fontit ja värit</h2></div>';
  const body = document.createElement("div");
  body.className = "card-body";

  body.appendChild(fieldRow("Otsikoiden fontti", fontSelect(style.fonts.heading, v => style.fonts.heading = v)));
  body.appendChild(fieldRow("Pääotsikoiden koko", sizeSelect(style.fonts.headingSize, [11,12,13,14,16,18,20,24,28], v => style.fonts.headingSize = v)));
  body.appendChild(fieldRow("Alaotsikoiden koko", sizeSelect(style.fonts.subheadingSize||11, [9,10,11,12,13,14,16,18], v => style.fonts.subheadingSize = v)));
  body.appendChild(fieldRow("Otsikoiden väri (pää- ja alaotsikot)", colorPicker(style.colors.heading, v => style.colors.heading = v)));

  body.appendChild(fieldRow("Leipätekstin fontti", fontSelect(style.fonts.body, v => style.fonts.body = v)));
  body.appendChild(fieldRow("Leipätekstin koko", sizeSelect(style.fonts.bodySize, [9,9.5,10,10.5,11,12,13,14], v => style.fonts.bodySize = v)));
  body.appendChild(fieldRow("Leipätekstin väri", colorPicker(style.colors.body, v => style.colors.body = v)));

  card.appendChild(body);
  return card;
}

/* ---------- Tallennus ja lataus ---------- */
async function loadStyle(){
  const { data, error } = await supabaseClient
    .from("doc_styles")
    .select("style")
    .eq("form_key", FORM_KEY)
    .maybeSingle();
  if (error){
    fatalError("Tyylin lataus epäonnistui: " + error.message);
    style = window.DocxStyleEngine.defaultStyle();
    return;
  }
  style = window.DocxStyleEngine.mergeStyle(data && data.style);
}

document.getElementById("btnSaveStyle").addEventListener("click", async () => {
  const btn = document.getElementById("btnSaveStyle");
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = "Tallennetaan…";
  const { error } = await supabaseClient
    .from("doc_styles")
    .upsert({ form_key: FORM_KEY, style: style }, { onConflict: "user_id,form_key" });
  btn.disabled = false;
  btn.textContent = original;
  if (error){
    showToast("Tallennus epäonnistui: " + error.message);
    return;
  }
  showToast("Ulkoasu tallennettu.");
});

document.getElementById("btnResetStyle").addEventListener("click", () => {
  style = window.DocxStyleEngine.defaultStyle();
  renderEditor();
  showToast("Palautettu oletusasetuksiin (ei vielä tallennettu).");
});

document.getElementById("btnBack").addEventListener("click", () => {
  window.location.href = BACK_URL || "index.html";
});

/* ---------- Käynnistys ---------- */
function waitForSupabaseClient(cb, triesLeft){
  if (typeof triesLeft !== "number") triesLeft = 100;
  if (window.__supabaseClient) return cb(window.__supabaseClient);
  if (triesLeft <= 0){ fatalError("Supabase-yhteyttä ei saatu muodostettua."); return; }
  setTimeout(() => waitForSupabaseClient(cb, triesLeft - 1), 50);
}

(function init(){
  const params = new URLSearchParams(window.location.search);
  FORM_KEY = params.get("form");
  BACK_URL = params.get("back");
  const label = params.get("label") || "lomake";
  document.getElementById("editorTitle").textContent = 'Word-ulkoasu — ' + label;

  if (!FORM_KEY){
    fatalError("Osoitteesta puuttuu ?form=-parametri.");
    return;
  }

  if (!window.DocxStyleEngine){
    fatalError("docx-style-engine.js ei latautunut. Tarkista, että script-rivi on lisätty sivun <head>-osioon.");
    return;
  }

  waitForSupabaseClient(async (client) => {
    try{
      supabaseClient = client;
      await loadStyle();
      renderEditor();
    }catch(err){
      fatalError("Odottamaton virhe editoria ladatessa: " + (err && err.message ? err.message : err));
    }
  });
})();
