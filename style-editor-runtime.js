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

function renderBlockEditor(blocks, idx, rerenderBlocks){
  const b = blocks[idx];
  const wrap = document.createElement("div");
  wrap.className = "section-block";
  wrap.style.cssText = "background:var(--paper);margin-top:8px;padding:10px;";

  const head = document.createElement("div");
  head.style.cssText = "display:flex;gap:6px;align-items:center;margin-bottom:6px;";

  const typeSel = blockTypeSelect(b.type, (v) => {
    b.type = v;
    if ((v === "bullets" || v === "numbered") && !b.items) b.items = b.text ? [b.text] : [""];
    if ((v === "heading" || v === "subheading" || v === "paragraph") && !("text" in b)) b.text = (b.items || []).join("\n");
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
    const t = textareaInput(b.text, v => b.text = v, "Kappaleen teksti…");
    t.style.minHeight = "80px";
    wrap.appendChild(t);
    const colorRow = document.createElement("div");
    colorRow.style.cssText = "display:flex;align-items:center;gap:8px;margin-top:6px;font-size:.78rem;color:var(--ink-soft);";
    colorRow.appendChild(document.createTextNode("Tekstin väri"));
    colorRow.appendChild(colorPicker(b.color || style.colors.body, v => b.color = v));
    wrap.appendChild(colorRow);
  } else if (b.type === "bullets" || b.type === "numbered"){
    const t = textareaInput((b.items || []).join("\n"), v => b.items = v.split("\n"), "Yksi kohta per rivi…");
    t.style.minHeight = "80px";
    wrap.appendChild(t);
    const colorRow = document.createElement("div");
    colorRow.style.cssText = "display:flex;align-items:center;gap:8px;margin-top:6px;font-size:.78rem;color:var(--ink-soft);";
    colorRow.appendChild(document.createTextNode("Tekstin väri"));
    colorRow.appendChild(colorPicker(b.color || style.colors.body, v => b.color = v));
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

function buildHeaderCard(){
  const card = document.createElement("section");
  card.className = "card";
  card.innerHTML = '<div class="card-header"><h2>Ylätunniste</h2></div>';
  const body = document.createElement("div");
  body.className = "card-body";

  const t = toggleRow("Näytä ylätunniste jokaisella sivulla", style.header.enabled, (v) => {
    style.header.enabled = v;
    renderEditor();
  });
  body.appendChild(t.wrap);

  if (style.header.enabled){
    body.appendChild(fieldRow("Teksti (esim. yrityksen nimi) — voi olla useampi rivi", textareaInput(style.header.text, v => style.header.text = v, "esim. Yritys Oy\nOsoite tai lisärivi")));
    body.appendChild(fieldRow("Tasaus", alignSelect(style.header.align, v => style.header.align = v)));
    body.appendChild(fieldRow("Fonttikoko", sizeSelect(style.header.fontSize || 9, [7,8,9,10,11,12,14], v => style.header.fontSize = v)));
    body.appendChild(fieldRow("Väri", colorPicker(style.header.color || "#7a7566", v => style.header.color = v)));
    const dt = toggleRow("Näytä myös päivämäärä", style.header.showDate, (v) => style.header.showDate = v);
    body.appendChild(dt.wrap);
    if (style.coverPage.logoDataUrl){
      const lt = toggleRow("Näytä logo myös ylätunnisteessa (pieni)", style.header.showLogo, (v) => style.header.showLogo = v);
      body.appendChild(lt.wrap);
    } else {
      const hint = document.createElement("div");
      hint.style.cssText = "font-size:.76rem;color:var(--ink-soft);margin-top:-4px;";
      hint.textContent = "Lisää ensin logo Kansilehti-kortista, niin voit näyttää sen myös täällä.";
      body.appendChild(hint);
    }
  }

  card.appendChild(body);
  return card;
}

function buildFooterCard(){
  const card = document.createElement("section");
  card.className = "card";
  card.innerHTML = '<div class="card-header"><h2>Alatunniste</h2></div>';
  const body = document.createElement("div");
  body.className = "card-body";

  const t = toggleRow("Näytä alatunniste jokaisella sivulla", style.footer.enabled, (v) => {
    style.footer.enabled = v;
    renderEditor();
  });
  body.appendChild(t.wrap);

  if (style.footer.enabled){
    body.appendChild(fieldRow("Teksti — voi olla useampi rivi", textareaInput(style.footer.text, v => style.footer.text = v, "esim. Luottamuksellinen")));
    body.appendChild(fieldRow("Tasaus", alignSelect(style.footer.align, v => style.footer.align = v)));
    body.appendChild(fieldRow("Fonttikoko", sizeSelect(style.footer.fontSize || 9, [7,8,9,10,11,12,14], v => style.footer.fontSize = v)));
    body.appendChild(fieldRow("Väri", colorPicker(style.footer.color || "#7a7566", v => style.footer.color = v)));
    const pn = toggleRow("Näytä sivunumero (esim. Sivu 1 / 3)", style.footer.showPageNumber, (v) => style.footer.showPageNumber = v);
    body.appendChild(pn.wrap);
  }

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
  body.appendChild(fieldRow("Otsikoiden koko", sizeSelect(style.fonts.headingSize, [12,13,14,16,18,20,24,28], v => style.fonts.headingSize = v)));
  body.appendChild(fieldRow("Otsikoiden väri", colorPicker(style.colors.heading, v => style.colors.heading = v)));

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
  style = (data && data.style) ? data.style : window.DocxStyleEngine.defaultStyle();
  // Varmista, että vanhemmatkin tallenteet saavat kaikki kentät (jos moottoria on laajennettu)
  const d = window.DocxStyleEngine.defaultStyle();
  style.coverPage = Object.assign(d.coverPage, style.coverPage || {});
  style.header = Object.assign(d.header, style.header || {});
  style.footer = Object.assign(d.footer, style.footer || {});
  style.fonts = Object.assign(d.fonts, style.fonts || {});
  style.colors = Object.assign(d.colors, style.colors || {});
  style.toc = Object.assign(d.toc, style.toc || {});
  style.pagesBefore = style.pagesBefore || [];
  style.pagesAfter = style.pagesAfter || [];
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
