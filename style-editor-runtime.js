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

function renderEditor(){
  const root = document.getElementById("editorRoot");
  root.innerHTML = "";
  root.appendChild(buildCoverCard());
  root.appendChild(buildHeaderCard());
  root.appendChild(buildFooterCard());
  root.appendChild(buildFontsCard());
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
    body.appendChild(fieldRow("Teksti (esim. yrityksen nimi)", textInput(style.header.text, v => style.header.text = v, "esim. Yritys Oy")));
    const dt = toggleRow("Näytä myös päivämäärä", style.header.showDate, (v) => style.header.showDate = v);
    body.appendChild(dt.wrap);
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
    body.appendChild(fieldRow("Teksti", textInput(style.footer.text, v => style.footer.text = v, "esim. Luottamuksellinen")));
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

  const colorWrap = document.createElement("div");
  colorWrap.className = "field";
  const colorLabel = document.createElement("label");
  colorLabel.textContent = "Otsikoiden väri";
  colorWrap.appendChild(colorLabel);
  const colorInput = document.createElement("input");
  colorInput.type = "color";
  colorInput.value = style.colors.heading || "#233043";
  colorInput.style.cssText = "width:60px;height:38px;border:none;border-radius:7px;padding:0;";
  colorInput.addEventListener("input", () => style.colors.heading = colorInput.value);
  colorWrap.appendChild(colorInput);
  body.appendChild(colorWrap);

  body.appendChild(fieldRow("Leipätekstin fontti", fontSelect(style.fonts.body, v => style.fonts.body = v)));

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
