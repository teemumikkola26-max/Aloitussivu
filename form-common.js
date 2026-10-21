"use strict";
/* =========================================================================
   FORM-COMMON.JS — lomakkeiden jaetut apuvälineet
   (käytössä sekä form.html:ssä että kenttalomake.html:ssä)

   1) AppPerm       Käyttöoikeushuomautukset (mikrofoni, kamera): jos käyttäjä
                    on estänyt oikeuden, näytetään selkeä ohjeikkuna eikä vain
                    nopeasti katoavaa ilmoitusta.
   2) AppDictation  Sanelu (puheentunnistus) yhdelle kentälle. Käyttää
                    AppPermia virhetilanteissa.
   3) AppCombo      Ehdottava valikko: kirjoita tekstiä, niin sopivat
                    vaihtoehdot ehdotetaan. Muokkausvaiheessa voi valita,
                    hyväksytäänkö myös valikon ulkopuolisia arvoja.
   ========================================================================= */
(function(){

const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;

/* ------------------------------------------------------------------ tyylit */
const css = `
.perm-backdrop{position:fixed;inset:0;z-index:100010;background:rgba(20,26,34,.55);display:flex;align-items:center;justify-content:center;padding:16px}
.perm-dlg{background:#fff;color:#1c2430;border-radius:14px;max-width:440px;width:100%;max-height:88vh;overflow:auto;padding:18px 18px 14px;box-shadow:0 12px 40px rgba(0,0,0,.35);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.perm-dlg h2{margin:0 0 8px;font-size:1.1rem;line-height:1.3}
.perm-dlg p{margin:0 0 10px;font-size:.92rem;line-height:1.45}
.perm-dlg ol{margin:0 0 10px;padding-left:20px;font-size:.92rem;line-height:1.5}
.perm-dlg li{margin-bottom:6px}
.perm-dlg .perm-note{font-size:.82rem;color:#5b6472}
.perm-dlg .perm-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;margin-top:12px}
.perm-dlg button{min-height:44px;padding:0 16px;border-radius:9px;font:inherit;font-size:.92rem;font-weight:600;cursor:pointer;border:1.5px solid #b9b2a0;background:#fff;color:#1c2430}
.perm-dlg button.primary{background:#233043;border-color:#233043;color:#fff}
.dictate-btn.blocked{border-color:#a13030 !important;color:#a13030;position:relative}
.dictate-btn.blocked::after{content:"!";position:absolute;top:-4px;right:-4px;width:16px;height:16px;border-radius:50%;background:#a13030;color:#fff;font-size:11px;font-weight:700;line-height:16px;text-align:center}

.combo{position:relative;width:100%}
.combo-input{width:100%;font-size:16px;padding-right:38px !important;box-sizing:border-box;font-family:inherit}
.combo-input.invalid{border-color:#a13030 !important}
.combo-btn{position:absolute;top:0;right:0;bottom:0;width:38px;border:none;background:transparent;color:#666;font-size:15px;cursor:pointer;padding:0;line-height:1}
.combo-btn:disabled{opacity:.4;cursor:default}
.combo-msg{font-size:.78rem;color:#a13030;margin-top:4px;line-height:1.35}
.combo-list{position:fixed;z-index:100005;background:#fff;border:1px solid #b9b2a0;border-radius:9px;box-shadow:0 6px 22px rgba(0,0,0,.2);overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;padding:4px 0;box-sizing:border-box}
.combo-opt{padding:10px 12px;font-size:16px;line-height:1.25;cursor:pointer;color:#1c2430;min-height:44px;display:flex;align-items:center;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.combo-opt[aria-selected="true"]{background:#e6edf6}
.combo-opt.current{font-weight:700}
.combo-opt mark{background:none;color:inherit;font-weight:700;text-decoration:underline}
.combo-empty{padding:10px 12px;font-size:14px;color:#6b6656;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
`;
const styleEl = document.createElement("style");
styleEl.textContent = css;
document.head.appendChild(styleEl);

/* ======================================================================
   1) AppPerm — käyttöoikeudet
   ====================================================================== */
const permState = { microphone:"unknown", camera:"unknown" };

function platform(){
  const ua = navigator.userAgent || "";
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const android = /Android/i.test(ua);
  const standalone = (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
  return { ios, android, standalone };
}

function refreshBlockedUi(){
  document.querySelectorAll(".dictate-btn").forEach(b => decorateDictateButton(b));
  /* Jos oikeus on annettu kesken ohjeikkunan, suljetaan se. */
  const dlg = document.getElementById("appPermDlg");
  if (dlg && permState[dlg.dataset.kind] === "granted") closeBlocked();
}

function watchPermission(name){
  if (!navigator.permissions || !navigator.permissions.query) return;
  try{
    navigator.permissions.query({ name }).then(status => {
      permState[name] = status.state;
      status.addEventListener("change", () => { permState[name] = status.state; refreshBlockedUi(); });
      refreshBlockedUi();
    }).catch(() => {});
  }catch(e){}
}

function decorateDictateButton(btn){
  const blocked = permState.microphone === "denied";
  btn.classList.toggle("blocked", blocked);
  if (blocked){
    btn.title = "Mikrofonin käyttö on estetty – napauta nähdäksesi ohjeet";
  } else if (btn.title && btn.title.indexOf("estetty") !== -1){
    btn.title = "Sanele";
  }
}

function closeBlocked(){
  const b = document.getElementById("appPermBackdrop");
  if (b) b.remove();
  document.removeEventListener("keydown", onPermKey, true);
}
function onPermKey(e){
  if (e.key === "Escape"){ e.stopPropagation(); closeBlocked(); }
}

function permSteps(kind){
  const p = platform();
  const name = kind === "camera" ? "Kamera" : "Mikrofoni";
  if (p.ios){
    return [
      "Avaa tämä sivu Safarissa ja napauta osoiterivin aA-kuvaketta → Verkkosivuston asetukset → " + name + " → Salli.",
      "Tai avaa laitteen Asetukset → Safari → " + name + " ja valitse Kysy tai Salli."
    ];
  }
  if (p.android){
    const steps = ["Napauta osoiterivin vasemmalla puolella olevaa kuvaketta (lukko tai säätökuvake) → Käyttöoikeudet → " + name + " → Salli."];
    if (p.standalone) steps.push("Jos käytät sovellusta aloitusnäytöltä: paina sovelluksen kuvaketta pitkään → Sovelluksen tiedot → Käyttöoikeudet → " + name + " → Salli.");
    return steps;
  }
  return ["Napsauta osoiterivin vasemmalla puolella olevaa lukkokuvaketta → Sivuston asetukset → " + name + " → Salli."];
}

/* kind: "microphone" | "camera";  reason: "service" = laitteen puheentunnistus ei käytössä */
function showBlocked(kind, reason){
  if (document.getElementById("appPermDlg")) return;
  const isCam = kind === "camera";
  const p = platform();

  let title, intro, steps;
  if (!isCam && reason === "service"){
    title = "🎤 Puheentunnistus ei ole käytettävissä";
    intro = "Laitteen puheentunnistuspalvelu ei ole käytössä tai sovellukselle ei ole annettu lupaa käyttää sitä.";
    steps = p.ios
      ? ["Tarkista Asetukset → Yleiset → Näppäimistö → Sanelu on päällä.", "Salli lisäksi mikrofoni: " + permSteps("microphone")[0]]
      : ["Varmista, että Googlen puheentunnistus (tai laitteesi oma sanelu) on päällä laitteen asetuksissa.", "Salli lisäksi mikrofoni: " + permSteps("microphone")[0]];
  } else if (isCam){
    title = "📷 Kameran käyttö on estetty";
    intro = "Sovellukselle on estetty kameran käyttö tällä laitteella, joten kuvaa ei voi ottaa suoraan kameralla.";
    steps = permSteps("camera");
  } else {
    title = "🎤 Mikrofonin käyttö on estetty";
    intro = "Sanelu tarvitsee mikrofonin käyttöoikeuden. Sovellukselle on estetty mikrofonin käyttö tällä laitteella (esimerkiksi aiemman kysymyksen yhteydessä), joten sanelu ei toimi.";
    steps = permSteps("microphone");
  }

  const backdrop = document.createElement("div");
  backdrop.className = "perm-backdrop";
  backdrop.id = "appPermBackdrop";
  backdrop.innerHTML =
    '<div class="perm-dlg" id="appPermDlg" role="alertdialog" aria-modal="true" aria-labelledby="appPermTitle" aria-describedby="appPermBody">' +
      '<h2 id="appPermTitle"></h2>' +
      '<div id="appPermBody"><p class="perm-intro"></p><p style="margin-bottom:4px;"><strong>Näin sallit käytön:</strong></p><ol></ol>' +
      '<p class="perm-note">Jos asetuksen muuttamisen jälkeen ominaisuus ei vielä toimi, lataa sivu uudelleen. Lomakkeen tiedot tallentuvat automaattisesti.</p></div>' +
      '<div class="perm-actions"><button type="button" data-a="reload">Lataa sivu uudelleen</button><button type="button" class="primary" data-a="ok">Selvä</button></div>' +
    '</div>';
  const dlg = backdrop.querySelector("#appPermDlg");
  dlg.dataset.kind = kind;
  backdrop.querySelector("#appPermTitle").textContent = title;
  backdrop.querySelector(".perm-intro").textContent = intro;
  const ol = backdrop.querySelector("ol");
  steps.forEach(s => { const li = document.createElement("li"); li.textContent = s; ol.appendChild(li); });
  backdrop.querySelector('[data-a="ok"]').addEventListener("click", closeBlocked);
  backdrop.querySelector('[data-a="reload"]').addEventListener("click", () => window.location.reload());
  backdrop.addEventListener("click", e => { if (e.target === backdrop) closeBlocked(); });
  document.addEventListener("keydown", onPermKey, true);
  document.body.appendChild(backdrop);
  const ok = backdrop.querySelector('[data-a="ok"]');
  try{ ok.focus(); }catch(e){}
}

/* Estää tiedostovalitsimen (kamera) avaamisen, jos kameran käyttö on kielletty. */
function guardFileInput(input, kind){
  if (!input) return;
  input.addEventListener("click", e => {
    if (permState[kind] === "denied"){
      e.preventDefault();
      showBlocked(kind);
    }
  });
}

watchPermission("camera");
if (SpeechRec) watchPermission("microphone");

window.AppPerm = {
  state: name => permState[name] || "unknown",
  isBlocked: name => permState[name] === "denied",
  showBlocked, guardFileInput, decorateDictateButton
};

/* ======================================================================
   2) AppDictation — sanelu
   ====================================================================== */
let activeDictation = null;

function stopDictation(){
  if (activeDictation){
    activeDictation.stopped = true;
    try{ activeDictation.rec.stop(); }catch(e){}
  }
}
document.addEventListener("visibilitychange", () => { if (document.hidden) stopDictation(); });

/* Liittää sanelulogiikan painikkeeseen. opts.toast(msg) näyttää lyhyen ilmoituksen. */
function bindDictation(btn, input, opts){
  opts = opts || {};
  const toast = typeof opts.toast === "function" ? opts.toast : (() => {});
  decorateDictateButton(btn);

  const setRec = on => {
    btn.classList.toggle("rec", on);
    btn.textContent = on ? "⏹" : "🎤";
    btn.setAttribute("aria-label", on ? "Lopeta sanelu" : "Sanele");
  };

  btn.addEventListener("click", () => {
    if (activeDictation && activeDictation.btn === btn){ stopDictation(); return; }
    stopDictation();

    /* Tiedetään jo etukäteen, ettei käyttöoikeutta ole: kerrotaan se heti. */
    if (permState.microphone === "denied"){ showBlocked("microphone"); return; }

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
      /* Virhetilanteessa painike palautetaan heti, vaikka selain ei kutsuisi onend-tapahtumaa. */
      setRec(false);
      if (activeDictation === st) activeDictation = null;
      if (err === "not-allowed"){
        permState.microphone = "denied";
        refreshBlockedUi();
        showBlocked("microphone");
      } else if (err === "service-not-allowed"){
        showBlocked("microphone", "service");
      } else if (err === "network"){
        toast("Sanelu vaatii verkkoyhteyden.");
      } else if (err === "audio-capture"){
        toast("Mikrofonia ei löytynyt tai toinen sovellus käyttää sitä.");
      } else if (err === "language-not-supported"){
        toast("Suomen kielen tunnistus ei ole käytettävissä tällä laitteella.");
      } else {
        toast("Sanelu epäonnistui.");
      }
    };
    rec.onend = () => {
      if (!st.stopped && activeDictation === st){
        /* Selain päättää tunnistuksen hiljaisuuden jälkeen -- jatketaan. */
        base = input.value;
        try{ rec.start(); return; }catch(e){}
      }
      setRec(false);
      if (activeDictation === st) activeDictation = null;
    };
    activeDictation = st;
    try{ rec.start(); setRec(true); }
    catch(err){ activeDictation = null; toast("Sanelua ei voitu käynnistää."); }
  });
}

window.AppDictation = {
  supported: !!SpeechRec,
  bind: bindDictation,
  stop: stopDictation
};

/* ======================================================================
   3) AppCombo — ehdottava valikko
   ====================================================================== */
let comboSeq = 0;
const norm = s => String(s == null ? "" : s).toLocaleLowerCase("fi").normalize("NFC");

/* Järjestys: alkaa kirjoitetulla > sana alkaa kirjoitetulla > sisältää. */
function rankOptions(options, query){
  const q = norm(query).trim();
  if (!q) return options.map(o => ({ o, at:-1 }));
  const starts = [], words = [], inside = [];
  options.forEach(o => {
    const n = norm(o);
    const i = n.indexOf(q);
    if (i === -1) return;
    const entry = { o, at: n.length === o.length ? i : -1, len: q.length };
    if (i === 0) starts.push(entry);
    else if (/[\s\-\/(,.]/.test(n.charAt(i-1))) words.push(entry);
    else inside.push(entry);
  });
  return starts.concat(words, inside);
}

/*
 * hidden: kentän <input>, jonka id/arvo/kuuntelijat säilyvät. Se muutetaan
 *         piilokentäksi ja sen viereen rakennetaan näkyvä valikko.
 *         Muutokset välitetään hiddenin "input"- ja "change"-tapahtumilla,
 *         joten vanha koodi (oninput/onchange) toimii sellaisenaan.
 * opts:   { options:[...], allowCustom:bool, placeholder, inputStyle }
 */
function enhance(hidden, opts){
  opts = opts || {};
  const options = (Array.isArray(opts.options) ? opts.options : []).map(String);
  const allowCustom = !!opts.allowCustom;
  const uid = "combo" + (++comboSeq);

  hidden.type = "hidden";
  const initial = hidden.value || "";

  const wrap = document.createElement("div");
  wrap.className = "combo";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "combo-input";
  if (opts.inputStyle) input.style.cssText = opts.inputStyle;
  input.id = (hidden.id ? hidden.id : uid) + "_cb";
  input.autocomplete = "off";
  input.setAttribute("autocapitalize", "off");
  input.spellcheck = false;
  input.placeholder = opts.placeholder || (allowCustom ? "Kirjoita tai valitse…" : "Kirjoita tai valitse listasta…");
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("aria-controls", uid + "_list");
  input.value = initial;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "combo-btn";
  btn.tabIndex = -1;
  btn.setAttribute("aria-label", "Näytä vaihtoehdot");
  btn.textContent = "▾";

  const msg = document.createElement("div");
  msg.className = "combo-msg";
  msg.setAttribute("role", "alert");
  msg.style.display = "none";

  wrap.appendChild(input);
  wrap.appendChild(btn);
  wrap.appendChild(msg);
  hidden.insertAdjacentElement("afterend", wrap);

  /* Kentän otsikko osoittamaan näkyvään kenttään. */
  if (hidden.id && hidden.parentNode){
    try{
      const lab = hidden.parentNode.querySelector('label[for="' + CSS.escape(hidden.id) + '"]');
      if (lab) lab.setAttribute("for", input.id);
    }catch(e){}
  }

  let list = null, items = [], active = -1, isOpen = false, dirty = false, interacting = false, msgTimer = null;

  function commit(val){
    if (hidden.value === val) return;
    hidden.value = val;
    hidden.dispatchEvent(new Event("input", { bubbles:true }));
    hidden.dispatchEvent(new Event("change", { bubbles:true }));
  }
  function showMsg(text){
    msg.textContent = text;
    msg.style.display = "";
    input.classList.add("invalid");
    clearTimeout(msgTimer);
    msgTimer = setTimeout(clearMsg, 6000);
  }
  function clearMsg(){
    clearTimeout(msgTimer);
    msg.style.display = "none";
    msg.textContent = "";
    input.classList.remove("invalid");
  }

  function place(){
    if (!list) return;
    const r = input.getBoundingClientRect();
    const vv = window.visualViewport;
    const vTop = vv ? vv.offsetTop : 0;
    const vBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
    const below = vBottom - r.bottom - 8;
    const above = r.top - vTop - 8;
    const useBelow = below >= 170 || below >= above;
    list.style.left = Math.max(4, r.left) + "px";
    list.style.width = r.width + "px";
    list.style.maxHeight = Math.max(110, Math.min(300, useBelow ? below : above)) + "px";
    if (useBelow){
      list.style.top = (r.bottom + 2) + "px";
      list.style.bottom = "auto";
    } else {
      list.style.bottom = (document.documentElement.clientHeight - r.top + 2) + "px";
      list.style.top = "auto";
    }
  }

  function setActive(i, scroll){
    active = i;
    if (!list) return;
    [...list.querySelectorAll(".combo-opt")].forEach((n, idx) => {
      n.setAttribute("aria-selected", String(idx === i));
      if (idx === i){
        input.setAttribute("aria-activedescendant", n.id);
        if (scroll) n.scrollIntoView({ block:"nearest" });
      }
    });
  }

  function onDocDown(e){
    if (list && list.contains(e.target)) return;
    if (wrap.contains(e.target)) return;
    closeList();
  }
  function onViewportChange(){
    if (!document.body.contains(wrap)){ closeList(); return; }
    place();
  }

  function closeList(){
    if (!isOpen) return;
    isOpen = false;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    if (list){ list.remove(); list = null; }
    document.removeEventListener("pointerdown", onDocDown, true);
    window.removeEventListener("scroll", onViewportChange, true);
    window.removeEventListener("resize", onViewportChange);
    if (window.visualViewport){
      window.visualViewport.removeEventListener("resize", onViewportChange);
      window.visualViewport.removeEventListener("scroll", onViewportChange);
    }
  }

  function chooseOption(o){
    input.value = o;
    dirty = false;
    clearMsg();
    commit(o);
    closeList();
  }

  function openList(showAll){
    if (input.disabled) return;
    const q = showAll ? "" : input.value;
    items = rankOptions(options, q);

    if (!items.length && allowCustom){ closeList(); return; }

    if (!list){
      list = document.createElement("div");
      list.className = "combo-list";
      list.id = uid + "_list";
      list.setAttribute("role", "listbox");
      /* Estetään kentän blur kun listaa napautetaan. */
      list.addEventListener("mousedown", e => e.preventDefault());
      list.addEventListener("pointerdown", () => { interacting = true; });
      const endInteract = () => setTimeout(() => { interacting = false; }, 400);
      list.addEventListener("pointerup", endInteract);
      list.addEventListener("pointercancel", endInteract);
      document.body.appendChild(list);
      isOpen = true;
      input.setAttribute("aria-expanded", "true");
      document.addEventListener("pointerdown", onDocDown, true);
      window.addEventListener("scroll", onViewportChange, true);
      window.addEventListener("resize", onViewportChange);
      if (window.visualViewport){
        window.visualViewport.addEventListener("resize", onViewportChange);
        window.visualViewport.addEventListener("scroll", onViewportChange);
      }
    }

    list.innerHTML = "";
    if (!items.length){
      const empty = document.createElement("div");
      empty.className = "combo-empty";
      empty.textContent = "Ei vaihtoehtoa tekstille “" + input.value.trim() + "”. Valitse listasta.";
      list.appendChild(empty);
    }
    items.forEach((it, idx) => {
      const row = document.createElement("div");
      row.className = "combo-opt" + (it.o === hidden.value ? " current" : "");
      row.id = uid + "_o" + idx;
      row.setAttribute("role", "option");
      if (it.at >= 0 && it.len){
        row.appendChild(document.createTextNode(it.o.slice(0, it.at)));
        const mk = document.createElement("mark");
        mk.textContent = it.o.slice(it.at, it.at + it.len);
        row.appendChild(mk);
        row.appendChild(document.createTextNode(it.o.slice(it.at + it.len)));
      } else {
        row.textContent = it.o;
      }
      row.addEventListener("click", () => chooseOption(it.o));
      row.addEventListener("mousemove", () => { if (active !== idx) setActive(idx, false); });
      list.appendChild(row);
    });
    place();

    if (showAll){
      const cur = items.findIndex(it => it.o === hidden.value);
      setActive(cur, true);
    } else {
      /* Vain listasta hyväksyttävässä kentässä ensimmäinen ehdotus on valmiiksi valittuna (Enter/Tab hyväksyy). */
      setActive(!allowCustom && items.length ? 0 : -1, false);
    }
  }

  function finish(){
    closeList();
    const t = input.value.trim();
    if (t === hidden.value){ input.value = t; return; }
    if (t === ""){ input.value = ""; commit(""); clearMsg(); return; }
    const exact = options.find(o => norm(o) === norm(t));
    if (exact){ input.value = exact; clearMsg(); commit(exact); return; }
    if (allowCustom){ input.value = t; commit(t); return; }
    const cands = rankOptions(options, t);
    if (cands.length === 1){ input.value = cands[0].o; clearMsg(); commit(cands[0].o); return; }
    /* Ei hyväksyttävä arvo: palautetaan edellinen ja kerrotaan syy. */
    input.value = hidden.value;
    showMsg("“" + t + "” ei ole valikossa. Valitse vaihtoehto listasta" + (cands.length > 1 ? " (kirjoita tarkemmin tai valitse ehdotuksista)." : "."));
    if (typeof opts.onReject === "function") opts.onReject(t);
  }

  input.addEventListener("focus", () => {
    dirty = false;
    if (!allowCustom) setTimeout(() => { try{ input.select(); }catch(e){} }, 0);
  });
  input.addEventListener("input", () => {
    dirty = true;
    clearMsg();
    if (allowCustom) commit(input.value);
    else if (input.value.trim() === "") commit("");
    openList(false);
  });
  input.addEventListener("keydown", e => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp"){
      e.preventDefault();
      if (!isOpen){ openList(!dirty); return; }
      if (!items.length) return;
      const n = items.length;
      let next = active + (e.key === "ArrowDown" ? 1 : -1);
      if (next < 0) next = n - 1;
      if (next >= n) next = 0;
      setActive(next, true);
    } else if (e.key === "Enter"){
      if (isOpen && active >= 0 && items[active]){
        e.preventDefault();
        chooseOption(items[active].o);
      } else if (!allowCustom){
        e.preventDefault();
        finish();
      }
    } else if (e.key === "Escape"){
      if (isOpen){ e.preventDefault(); e.stopPropagation(); closeList(); }
    } else if (e.key === "Tab"){
      if (isOpen && !allowCustom && active >= 0 && items[active] && input.value.trim() !== ""){
        chooseOption(items[active].o);
      }
    }
  });
  input.addEventListener("blur", () => {
    setTimeout(() => {
      if (document.activeElement === input || interacting) return;
      finish();
    }, 160);
  });

  btn.addEventListener("mousedown", e => e.preventDefault());
  btn.addEventListener("click", () => {
    if (isOpen){ closeList(); return; }
    dirty = false;
    clearMsg();
    openList(true);
  });

  return {
    wrap, input, hidden,
    setValue(v){ hidden.value = v || ""; input.value = v || ""; clearMsg(); }
  };
}

window.AppCombo = { enhance, rank: rankOptions };

})();
