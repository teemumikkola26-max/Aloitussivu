"use strict";
/* =========================================================================
   UI-KIT.JS
   Yhteiset käyttöliittymäosat puhelinkäyttöön:
     AppUI.sheet(title, items)            alhaalta nouseva toimintovalikko
     AppUI.confirm({title, text, ok, cancel, danger})  -> Promise<boolean>
     AppUI.choose({title, text, actions}) -> Promise<action.value | null>
   Selaimen omat confirm()/prompt()-ikkunat korvataan näillä, koska niiden
   painikkeiden tekstit vaihtelevat puhelimittain ("OK", "Kumoa"...).
   Tyylit lisätään sivulle automaattisesti.
   ========================================================================= */
window.AppUI = (function(){
  const CSS = `
.aui-scrim{position:fixed;inset:0;background:rgba(20,24,30,.45);z-index:1000;display:flex;align-items:flex-end;justify-content:center;animation:auiFade .12s ease-out}
.aui-scrim.aui-center{align-items:center;padding:16px}
@keyframes auiFade{from{opacity:0}to{opacity:1}}
.aui-sheet{background:#fff;color:#1c2430;width:min(100%,520px);max-height:85vh;overflow:auto;border-radius:16px 16px 0 0;padding:8px 12px calc(12px + env(safe-area-inset-bottom));font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.aui-grab{width:40px;height:4px;border-radius:2px;background:#ccc;margin:4px auto 10px}
.aui-sheet h3{margin:0 6px 8px;font-size:15px;color:#4a5568;font-weight:600;overflow-wrap:anywhere}
.aui-sheet button.aui-item{display:flex;align-items:center;gap:10px;width:100%;text-align:left;min-height:52px;padding:0 12px;border:none;background:none;font:inherit;font-size:17px;color:inherit;border-radius:10px;cursor:pointer}
.aui-sheet button.aui-item:active{background:#f2f0ea}
.aui-sheet button.aui-item:disabled{opacity:.4;cursor:default}
.aui-sheet button.aui-danger{color:#a3271b}
.aui-sheet button.aui-cancel{justify-content:center;font-weight:700;margin-top:6px;background:#f2f0ea}
.aui-dialog{background:#fff;color:#1c2430;border-radius:16px;width:min(100%,400px);padding:18px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;max-height:90vh;overflow:auto}
.aui-dialog h3{margin:0 0 8px;font-size:18px;line-height:1.3}
.aui-dialog p{margin:0 0 16px;color:#4a5568;font-size:15px;line-height:1.45;white-space:pre-line}
.aui-acts{display:flex;flex-direction:column;gap:8px}
.aui-btn{min-height:48px;border-radius:10px;font:inherit;font-size:16px;font-weight:700;cursor:pointer;border:1.5px solid #b9b2a0;background:#fff;color:#1c2430;padding:10px 14px}
.aui-btn.aui-safe{background:#262626;border-color:#262626;color:#fff}
.aui-btn.aui-primary{background:#C8102E;border-color:#C8102E;color:#fff}
.aui-btn.aui-danger{background:#fff;border-color:#C8102E;color:#C8102E}
.aui-btn.aui-danger::before{content:"🗑 "}
.aui-btn:focus-visible,.aui-sheet button:focus-visible{outline:3px solid #1d4ed8;outline-offset:2px}
`;
  let injected = false;
  function inject(){
    if (injected) return; injected = true;
    const s = document.createElement("style"); s.textContent = CSS; document.head.appendChild(s);
  }
  function esc(s){ return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

  let openCount = 0;
  function mount(scrim, onClose){
    openCount++;
    document.body.appendChild(scrim);
    const prevFocus = document.activeElement;
    function close(){
      if (!scrim.parentNode) return;
      scrim.remove(); openCount--;
      document.removeEventListener("keydown", onKey, true);
      try{ prevFocus && prevFocus.focus && prevFocus.focus({ preventScroll:true }); }catch(e){}
    }
    function onKey(e){ if (e.key === "Escape"){ e.preventDefault(); close(); onClose && onClose(); } }
    document.addEventListener("keydown", onKey, true);
    return close;
  }

  /* items: [{label, icon?, danger?, disabled?, onSelect}] */
  function sheet(title, items){
    inject();
    const scrim = document.createElement("div");
    scrim.className = "aui-scrim";
    scrim.innerHTML = '<div class="aui-sheet" role="dialog" aria-modal="true" aria-label="' + esc(title || "Toiminnot") + '"><div class="aui-grab"></div>' +
      (title ? "<h3>" + esc(title) + "</h3>" : "") + "</div>";
    const box = scrim.firstChild;
    const close = mount(scrim);
    (items || []).filter(Boolean).forEach(it => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "aui-item" + (it.danger ? " aui-danger" : "");
      b.innerHTML = (it.icon ? '<span aria-hidden="true">' + esc(it.icon) + "</span>" : "") + "<span>" + esc(it.label) + "</span>";
      if (it.disabled) b.disabled = true;
      b.onclick = () => { close(); if (it.onSelect) it.onSelect(); };
      box.appendChild(b);
    });
    const c = document.createElement("button");
    c.type = "button"; c.className = "aui-item aui-cancel"; c.textContent = "Peruuta";
    c.onclick = close; box.appendChild(c);
    scrim.addEventListener("click", e => { if (e.target === scrim) close(); });
    const first = box.querySelector("button:not(:disabled)"); if (first) first.focus({ preventScroll:true });
    return close;
  }

  /* actions: [{label, value, kind:"safe"|"primary"|"danger"|"plain"}] -> Promise<value|null> */
  function choose(o){
    inject();
    return new Promise(resolve => {
      const scrim = document.createElement("div");
      scrim.className = "aui-scrim aui-center";
      scrim.innerHTML = '<div class="aui-dialog" role="alertdialog" aria-modal="true" aria-labelledby="auiT"><h3 id="auiT">' + esc(o.title || "") + "</h3>" +
        (o.text ? "<p>" + esc(o.text) + "</p>" : "") + '<div class="aui-acts"></div></div>';
      let done = false;
      const finish = v => { if (done) return; done = true; close(); resolve(v); };
      const close = mount(scrim, () => { if (!done){ done = true; resolve(null); } });
      const acts = scrim.querySelector(".aui-acts");
      (o.actions || []).forEach(a => {
        const b = document.createElement("button");
        b.type = "button"; b.className = "aui-btn aui-" + (a.kind || "plain"); b.textContent = a.label;
        b.onclick = () => finish(a.value);
        acts.appendChild(b);
      });
      const first = acts.querySelector("button"); if (first) first.focus({ preventScroll:true });
    });
  }

  /* Kyllä/ei-vahvistus. Turvallinen vaihtoehto (cancel) on aina ensimmäisenä ja korostettuna,
     kun toiminto on peruuttamaton (danger). */
  async function confirm(o){
    const ok = { label:o.ok || "OK", value:true, kind:o.danger ? "danger" : "primary" };
    const cancel = { label:o.cancel || "Peruuta", value:false, kind:o.danger ? "safe" : "plain" };
    const v = await choose({ title:o.title, text:o.text, actions:o.danger ? [cancel, ok] : [ok, cancel] });
    return v === true;
  }

  return { sheet, choose, confirm, isOpen: () => openCount > 0 };
})();
