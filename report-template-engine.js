"use strict";
/* =========================================================================
   REPORT-TEMPLATE-ENGINE.JS
   Täyttää yrityksen oman Word-raporttipohjan (.docx) kenttälomakkeen
   tiedoilla. Pohjan muotoilu, tyylit, kansilehti, ylä- ja alatunnisteet
   säilyvät sellaisinaan; sovellus korvaa vain pohjaan kirjoitetut
   paikkamerkit {{...}}.

   MERKINNÄT
   Tekstit (missä tahansa kappaleessa):
     {{kohde}} {{osoite}} {{tilaaja}} {{yhteyshenkilo}} {{tutkija}}
     {{pvm}} {{vuosi}} {{raporttipvm}} {{projektinumero}} {{lkm:menetelmä}}
   Lohkot (kappaleen ainoa sisältö):
     {{kirjaukset}}               kaikki kirjaukset menetelmittäin
     {{kirjaukset osioittain}}    kirjaukset osioittain (osiolistan järjestys, osio = pääotsikko);
                                  osio, jolle pohjassa on samanniminen otsikko tai oma
                                  {{osio:nimi}}, tulee sen alle eikä toistu tässä
     {{osio:nimi}}                yhden osion kirjaukset pohjan oman otsikon alle
                                  (ei uutta pääotsikkoa; kirjaukset alaotsikoina)
     {{kirjaukset tiloittain}}    kirjaukset ryhmiteltynä (vanha Tunnus/Tila, muuten osio)
     {{menetelmä:id}}             yhden menetelmän kirjaukset (otsikko per kirjaus)
     {{taulukko:id}}              menetelmän kirjaukset taulukkona
     {{kuvat:id}}                 menetelmän kirjausten valokuvat
     {{menetelmäluettelo}}        käytetyt menetelmät luettelona
   Ehdot ja toistot (omat kappaleensa):
     {{jos:id[,id]}} ... {{/jos}}    osa jää pois, jos menetelmää ei käytetty
     {{jos osio:nimi}} ... {{/jos}}  osa jää pois, jos osiossa ei ole kirjauksia

   Toistossa ({{toista:id}}) kentät voi kirjoittaa myös nimellä, esim.
   {{Tasaantumisaika}}. Nimi verrataan kirjainkoosta ja sulkeissa olevasta
   yksiköstä riippumatta ({{RH}} = kenttä "RH (%)").
   Taulukkokentän rivit: Word-taulukon rivi, jossa on {{rivit:Mittausarvot}},
   toistetaan kirjauksen taulukkokentän jokaiselle riville; rivin soluihin
   sarakkeet nimellä, esim. {{Pvm}} {{Syvyys}} {{RH}} {{Lämpötila}} {{Abs}}.
   {{Abs}} lasketaan RH:sta ja lämpötilasta, jos sarake on tyhjä.
     {{toista:id}} ... {{/toista}}   osa toistetaan jokaiselle kirjaukselle
   Taulukot:
     {{rivi:id}} rivin solussa -> rivi toistetaan jokaiselle kirjaukselle
     Suodatin: {{rivi:rh[Mittausmenetelmä=Porareikä|Näytepala]}} (myös jos/toista/
     lkm/menetelmä/taulukko/kuvat) rajaa kirjaukset kentän arvon mukaan.
     Toistossa taulukko jää pois, jos sen taulukkokentissä ei ole rivejä.
     {{?kenttä}} toistossa: koko kappale jää pois, jos kenttä on tyhjä.
     {{rivi:id}}{{rivit:kenttä}} -> kaikkien kirjausten taulukkokentän rivit
                                    samaan taulukkoon ({{tunniste}} kertoo pisteen)
   Kirjauskohtaiset (toisto- ja rivipohjissa):
     {{osio}} {{tunniste}} {{<kentän id>}} {{abs}} {{kuvat}} {{sijainti}}
     ({{paikka}} = {{tunniste}}, säilytetty vanhoja pohjia varten)

   Kirjauksen tunniste on menetelmän ensimmäisen kentän arvo (vanhoissa
   kirjauksissa Tunnus/Tila-kenttä).

   Pohjan punainen teksti (FF0000 / EE0000) tarkoittaa täytettävää kohtaa:
   kun sovellus täyttää kohdan, teksti muuttuu tavalliseksi (mustaksi).
   Ylä- ja alatunnisteisiin ei kosketa, ellei niihin ole kirjoitettu merkintöjä.

   Moduulilla on oma pieni XML-käsittelijä, joten se toimii sekä selaimessa
   että Node.js-testeissä. Vaatii JSZipin.
   ========================================================================= */
(function(root){

  const JSZipLib = (typeof root !== "undefined" && root.JSZip) ||
    (typeof require === "function" ? require("jszip") : null);

  const PLACEHOLDER_REDS = { "FF0000":1, "EE0000":1 };
  const TAG_RE = /\{\{[^{}]*\}\}/g;
  const GLOBAL_KEYS = ["kohde","osoite","tilaaja","yhteyshenkilo","tutkija","pvm","vuosi","raporttipvm","projektinumero"];
  const BLOCK_NAMES = ["kirjaukset","kirjaukset osioittain","kirjaukset tiloittain","menetelmäluettelo"];
  const BLOCK_PREFIXES = ["menetelmä:","taulukko:","kuvat:","osio:"];
  /* Osion nimet verrataan kirjainkoosta ja välilyönneistä riippumatta. */
  const normOsio = s => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
  /* Kentän/sarakkeen nimi merkintänä: kirjainkoko, sulkeissa oleva yksikkö
     ja loppupiste eivät vaikuta ("Abs. (g/m³)" = "abs"). */
  const normLabel = s => String(s || "").replace(/\([^)]*\)|\[[^\]]*\]/g, " ").replace(/\*/g, " ").replace(/\s+/g, " ").trim().replace(/[.:]+$/, "").trim().toLowerCase();

  /* Taulukkokentän haku {{rivit:…}}-merkinnälle: tunniste tai nimi; jos ei
     löydy, se taulukkokenttä, jonka sarakkeisiin rivin merkinnät osuvat parhaiten. */
  function findRowField(m, ref, rowTags, e, ctx){
    const tables = (m && m.fields || []).filter(x => x.type === "table");
    /* Menetelmässä voi olla useita samannimisiä taulukoita, joista näkyy vain
       yksi (esim. eri mittausmenetelmille ehdoilla). Valitaan kirjauksessa
       näkyvä taulukko, jossa on rivejä. */
    const hasRows = t => Array.isArray((e && e.values || {})[t.id]) && e.values[t.id].some(r => r && Object.keys(r).some(k => k !== "_ocr" && r[k] != null && String(r[k]).trim() !== ""));
    const vis = t => !ctx || !e || ctx.visible(e, t);
    const pick = list => list.find(t => vis(t) && hasRows(t)) || list.find(vis) || list[0];
    const named = tables.filter(x => x.id === ref || normLabel(x.label) === normLabel(ref));
    if (named.length) return { field: pick(named), guessed: false, tables };
    let bestScore = 0;
    const scored = tables.map(t => {
      const labs = (t.columns || []).map(c => normLabel(c.label));
      const score = (rowTags || []).filter(tg => labs.indexOf(normLabel(tg)) >= 0).length;
      if (score > bestScore) bestScore = score;
      return { t, score };
    });
    if (bestScore < 2) return { field: null, guessed: false, tables };
    return { field: pick(scored.filter(x => x.score === bestScore).map(x => x.t)), guessed: true, tables };
  }
  const ENTRY_KEYS = ["paikka","tunniste","osio","abs","kuvat","sijainti","huomiot"];

  /* ------------------------------------------------------------------
     Pieni XML-puu: { t:"el", name, attrs:[[k,v]], children:[], parent }
                    { t:"text", v }     (purettu teksti)
                    { t:"raw",  v }     (kommentit, CDATA, käsittelyohjeet)
     ------------------------------------------------------------------ */
  function decodeEnt(s){
    if (s.indexOf("&") < 0) return s;
    return s.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, (m, e) => {
      if (e === "lt") return "<"; if (e === "gt") return ">"; if (e === "amp") return "&";
      if (e === "quot") return '"'; if (e === "apos") return "'";
      if (e[1] === "x" || e[1] === "X") return String.fromCodePoint(parseInt(e.slice(2), 16));
      return String.fromCodePoint(parseInt(e.slice(1), 10));
    });
  }
  function escText(s){ return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
  function escAttr(s){ return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/"/g,"&quot;").replace(/\n/g,"&#10;").replace(/\r/g,"&#13;").replace(/\t/g,"&#9;"); }

  function parseXml(src){
    const doc = { t:"doc", children:[], parent:null };
    let cur = doc, i = 0;
    const n = src.length;
    while (i < n){
      const lt = src.indexOf("<", i);
      if (lt < 0){ pushText(src.slice(i)); break; }
      if (lt > i) pushText(src.slice(i, lt));
      if (src.startsWith("<!--", lt)){
        const e = src.indexOf("-->", lt); pushRaw(src.slice(lt, e + 3)); i = e + 3; continue;
      }
      if (src.startsWith("<![CDATA[", lt)){
        const e = src.indexOf("]]>", lt); pushRaw(src.slice(lt, e + 3)); i = e + 3; continue;
      }
      if (src.startsWith("<?", lt)){
        const e = src.indexOf("?>", lt); pushRaw(src.slice(lt, e + 2)); i = e + 2; continue;
      }
      if (src.startsWith("<!", lt)){
        const e = src.indexOf(">", lt); pushRaw(src.slice(lt, e + 1)); i = e + 1; continue;
      }
      if (src[lt + 1] === "/"){
        const e = src.indexOf(">", lt);
        cur = cur.parent || doc;
        i = e + 1; continue;
      }
      // avaava tagi, lainausmerkit huomioiden
      let j = lt + 1, q = null;
      while (j < n){
        const c = src[j];
        if (q){ if (c === q) q = null; }
        else if (c === '"' || c === "'") q = c;
        else if (c === ">") break;
        j++;
      }
      let inner = src.slice(lt + 1, j);
      const selfClose = inner.endsWith("/");
      if (selfClose) inner = inner.slice(0, -1);
      const m = /^([^\s/>]+)/.exec(inner);
      const el = { t:"el", name:m[1], attrs:[], children:[], parent:cur };
      const ar = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
      let a;
      const rest = inner.slice(m[1].length);
      while ((a = ar.exec(rest))) el.attrs.push([a[1], decodeEnt(a[3] !== undefined ? a[3] : a[4])]);
      cur.children.push(el);
      if (!selfClose) cur = el;
      i = j + 1;
    }
    return doc;
    function pushText(s){ cur.children.push({ t:"text", v:decodeEnt(s), parent:cur }); }
    function pushRaw(s){ cur.children.push({ t:"raw", v:s, parent:cur }); }
  }

  function serialize(node){
    const out = [];
    (function w(nd){
      if (nd.t === "doc"){ nd.children.forEach(w); return; }
      if (nd.t === "text"){ out.push(escText(nd.v)); return; }
      if (nd.t === "raw"){ out.push(nd.v); return; }
      out.push("<", nd.name);
      for (const [k, v] of nd.attrs) out.push(" ", k, '="', escAttr(v), '"');
      if (!nd.children.length){ out.push("/>"); return; }
      out.push(">"); nd.children.forEach(w); out.push("</", nd.name, ">");
    })(node);
    return out.join("");
  }

  // --- puun käsittely ---
  function el(name, attrs, children){
    const e = { t:"el", name, attrs:[], children:[], parent:null };
    if (attrs) for (const k in attrs) e.attrs.push([k, String(attrs[k])]);
    (children || []).forEach(c => append(e, c));
    return e;
  }
  function txt(v){ return { t:"text", v:String(v), parent:null }; }
  function attr(e, k){ const a = e.attrs.find(x => x[0] === k); return a ? a[1] : null; }
  function setAttr(e, k, v){ const a = e.attrs.find(x => x[0] === k); if (a) a[1] = String(v); else e.attrs.push([k, String(v)]); }
  function delAttr(e, k){ e.attrs = e.attrs.filter(x => x[0] !== k); }
  function kids(e, name){ return e.children.filter(c => c.t === "el" && (!name || c.name === name)); }
  function kid(e, name){ return e.children.find(c => c.t === "el" && c.name === name) || null; }
  function path(e, names){ let c = e; for (const nm of names){ c = c && kid(c, nm); } return c; }
  function append(p, c){ c.parent = p; p.children.push(c); return c; }
  function remove(c){ if (!c.parent) return; const i = c.parent.children.indexOf(c); if (i >= 0) c.parent.children.splice(i, 1); c.parent = null; }
  function insertBefore(ref, c){ const p = ref.parent; c.parent = p; p.children.splice(p.children.indexOf(ref), 0, c); }
  function insertAfter(ref, c){ const p = ref.parent; c.parent = p; p.children.splice(p.children.indexOf(ref) + 1, 0, c); }
  function next(e){ const s = e.parent.children; for (let i = s.indexOf(e) + 1; i < s.length; i++) if (s[i].t === "el") return s[i]; return null; }
  function prev(e){ const s = e.parent.children; for (let i = s.indexOf(e) - 1; i >= 0; i--) if (s[i].t === "el") return s[i]; return null; }
  function clone(e, parent){
    if (e.t !== "el") return { t:e.t, v:e.v, parent:parent || null };
    const c = { t:"el", name:e.name, attrs:e.attrs.map(a => [a[0], a[1]]), children:[], parent:parent || null };
    c.children = e.children.map(ch => clone(ch, c));
    return c;
  }
  function desc(e, name, out){
    out = out || [];
    for (const c of e.children){ if (c.t !== "el") continue; if (c.name === name) out.push(c); desc(c, name, out); }
    return out;
  }
  function textOf(e){ let s = ""; (function w(n){ for (const c of n.children){ if (c.t === "text") s += c.v; else if (c.t === "el") w(c); } })(e); return s; }
  function ptext(p){ return desc(p, "w:t").map(t => textOf(t)).join(""); }
  function ancestor(e, name){ let c = e.parent; while (c){ if (c.name === name) return c; c = c.parent; } return null; }
  function fragment(xml){ const d = parseXml("<x>" + xml + "</x>"); const x = d.children.find(c => c.t === "el"); const out = kids(x); out.forEach(c => c.parent = null); return out; }

  function setT(t, s){
    t.children = [txt(s)]; t.children[0].parent = t;
    if (/^\s|\s$/.test(s)) setAttr(t, "xml:space", "preserve");
  }

  /* Korvaa osumat kappaleessa, vaikka Word olisi pilkkonut tekstin useaan runiin.
     Palauttaa muuttuneet w:t-elementit. */
  function regexReplace(p, re, repl){
    const ts = desc(p, "w:t");
    const parts = ts.map(t => textOf(t));
    const full = parts.join("");
    const ms = [];
    const rx = new RegExp(re.source, "g");
    let m;
    while ((m = rx.exec(full))) { ms.push({ s:m.index, e:m.index + m[0].length, m }); if (!m[0].length) rx.lastIndex++; }
    const touched = [];
    for (let k = ms.length - 1; k >= 0; k--){
      const { s, e } = ms[k];
      const nw = repl(ms[k].m);
      if (nw === ms[k].m[0]) continue;
      let pos = 0, first = null;
      for (let i = 0; i < ts.length; i++){
        const tx = parts[i];
        const a = pos, b = pos + tx.length; pos = b;
        if (b <= s || a >= e) continue;
        const ls = Math.max(s, a) - a, le = Math.min(e, b) - a;
        if (!first){ first = ts[i]; parts[i] = tx.slice(0, ls) + nw + tx.slice(le); touched.push(ts[i]); }
        else parts[i] = tx.slice(0, ls) + tx.slice(le);
      }
    }
    ts.forEach((t, i) => { if (textOf(t) !== parts[i]) setT(t, parts[i]); });
    return touched;
  }

  function runOf(t){ return t.name === "w:r" ? t : ancestor(t, "w:r"); }
  function stripRed(r){
    const rpr = r && kid(r, "w:rPr"); if (!rpr) return;
    kids(rpr, "w:color").forEach(c => { if (PLACEHOLDER_REDS[(attr(c, "w:val") || "").toUpperCase()]) remove(c); });
  }
  function isRed(r){
    const c = path(r, ["w:rPr", "w:color"]);
    return !!(c && PLACEHOLDER_REDS[(attr(c, "w:val") || "").toUpperCase()]);
  }
  function pstyle(p){ const s = path(p, ["w:pPr", "w:pStyle"]); return s ? attr(s, "w:val") : ""; }

  /* ------------------------------------------------------------------
     Arvot
     ------------------------------------------------------------------ */
  function fiDate(iso){
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
    return m ? (+m[3]) + "." + (+m[2]) + "." + m[1] : (iso || "");
  }
  /* Taulukon mittausarvo sellaisenaan (esim. 8.27 -> "8,27"): desimaaleja ei pyöristetä. */
  function fmtNumKeep(v){
    const t = String(v).trim();
    return /^-?\d+([.,]\d+)?$/.test(t) ? t.replace(".", ",") : t;
  }
  function fmtNum(v){
    const x = parseFloat(String(v).replace(",", "."));
    if (!isFinite(x)) return String(v);
    const s = Math.abs(x - Math.round(x)) > 1e-9 ? x.toFixed(1) : String(Math.round(x));
    return s.replace(".", ",");
  }
  function absHumidity(rh, t){
    rh = parseFloat(String(rh).replace(",", ".")); t = parseFloat(String(t).replace(",", "."));
    if (!isFinite(rh) || !isFinite(t)) return "";
    const ps = 6.112 * Math.exp(17.67 * t / (t + 243.5));
    return (ps * rh * 2.1674 / (273.15 + t)).toFixed(1).replace(".", ",");
  }

  /* ------------------------------------------------------------------
     Pohjan tyylit: otsikot, kuvateksti, taulukko ja luettelo tunnistetaan
     tyylin sisäisestä nimestä (heading 1, caption...), joten moottori toimii
     suomen- ja englanninkielisillä pohjilla.
     ------------------------------------------------------------------ */
  function readStyles(stylesDoc){
    const res = { heading:{}, caption:null, tableGrid:null, listPara:null, headingLevelOf:{} };
    if (!stylesDoc) return res;
    const rootEl = kids(stylesDoc)[0];
    kids(rootEl, "w:style").forEach(s => {
      const id = attr(s, "w:styleId");
      const nm = ((kid(s, "w:name") && attr(kid(s, "w:name"), "w:val")) || "").toLowerCase();
      const hm = /^heading (\d)$/.exec(nm);
      if (hm){ res.heading[+hm[1]] = id; res.headingLevelOf[id] = +hm[1]; }
      if (nm === "caption") res.caption = id;
      if (nm === "table grid") res.tableGrid = id;
      if (nm === "list paragraph") res.listPara = id;
    });
    return res;
  }

  /* ------------------------------------------------------------------
     Konteksti
     ------------------------------------------------------------------ */
  function makeCtx(input){
    const p = input.project || {};
    const methods = {};
    (input.methods || []).forEach(m => { methods[m.id] = m; });
    const reportIso = input.reportDate || new Date().toISOString().slice(0, 10);
    const entries = (input.entries || []).filter(e => methods[e.methodId]);
    const osiot = Array.isArray(input.osiot) ? input.osiot.slice() : [];
    const ctx = {
      methods, entries, reportIso, warnings:[], osiot,
      glob: {
        kohde: p.nimi || "", osoite: p.osoite || "", tilaaja: p.tilaaja || "",
        yhteyshenkilo: p.yhteyshenkilo || "", tutkija: p.tutkija || "",
        pvm: fiDate(p.pvm), vuosi: (p.pvm || "").slice(0, 4),
        raporttipvm: fiDate(reportIso), projektinumero: p.projektinumero || ""
      },
      of(ids){
        /* Menetelmän voi antaa tunnisteella tai nimellä ({{toista:Märkätilakartoitus}}).
           Suodatin hakasulkeissa rajaa kirjaukset kentän arvon mukaan, vaihtoehdot |-merkillä:
           {{rivi:rh[Mittausmenetelmä=Porareikä|Näytepala]}} */
        const fm = /^(.*?)\[([^\]=]+)=([^\]]*)\]\s*$/.exec(String(ids));
        const list = (fm ? fm[1] : String(ids)).split(",").map(s => s.trim()).filter(Boolean);
        const keys = list.map(normLabel);
        let out = entries.filter(e => {
          if (list.indexOf(e.methodId) >= 0) return true;
          const m = methods[e.methodId];
          return !!m && (keys.indexOf(normLabel(m.name)) >= 0 || (m.short && keys.indexOf(normLabel(m.short)) >= 0));
        });
        if (fm){
          const fl = fm[2].trim(), want = fm[3].split("|").map(v => normOsio(v)).filter(Boolean);
          out = out.filter(e => {
            const m = methods[e.methodId];
            const fs = (m && m.fields || []).filter(f => f.type !== "table" && (f.id === fl || normLabel(f.label) === normLabel(fl)));
            return fs.some(f => {
              if (!ctx.visible(e, f)) return false;
              const v = normOsio((e.values || {})[f.id]);
              return want.length ? want.indexOf(v) >= 0 : v !== "";
            });
          });
        }
        return out;
      },
      fieldValue(e, f){
        const v = (e.values || {})[f.id];
        if (v === undefined || v === null || String(v).trim() === "" || Array.isArray(v)) return "";
        return f.type === "number" ? fmtNum(v) : String(v);
      },
      visible(e, f){ return !e.hidden || e.hidden[f.id] !== true; },
      /* Tunniste: vanha Tunnus/Tila tai menetelmän ensimmäisen kentän arvo. */
      ident(e){
        const v = e.values || {};
        if (v.paikka != null && String(v.paikka).trim() !== "") return String(v.paikka).trim();
        const m = methods[e.methodId], f = m && m.fields && m.fields[0];
        if (!f || f.type === "table" || f.type === "textarea" || !ctx.visible(e, f)) return "";
        const val = ctx.fieldValue(e, f);
        return f.type === "date" ? fiDate(val) : val;
      },
      osio(e){ return String((e.values || {}).osio || "").trim(); },
      ofOsio(name){ const k = normOsio(name); return entries.filter(e => normOsio(ctx.osio(e)) === k); },
      ownOsiot: {},   /* pohjassa omalla {{osio:nimi}}-merkinnällä sijoitetut osiot */
      entryVals(e){
        const m = methods[e.methodId];
        const vals = { paikka: ctx.ident(e), tunniste: ctx.ident(e), osio: ctx.osio(e), huomiot: String((e.values || {}).huomiot || "").trim() };
        m.fields.forEach(f => {
          vals[f.id] = ctx.visible(e, f) ? ctx.fieldValue(e, f) : "";
          if (f.type !== "table" && f.label){
            const k = "§" + normLabel(f.label);
            if (ctx.visible(e, f) || !Object.prototype.hasOwnProperty.call(vals, k)) vals[k] = f.type === "date" ? fiDate(vals[f.id]) : vals[f.id];
          }
        });
        if (e.methodId === "rh") vals.abs = absHumidity((e.values || {}).rh, (e.values || {}).lampo);
        vals.sijainti = markerText(e);
        return vals;
      },
      resolve(tag, ev){
        const name = tag.slice(2, -2).trim().replace(/^\?\s*/, "");
        if (ev && Object.prototype.hasOwnProperty.call(ev, name)) return ev[name];
        if (Object.prototype.hasOwnProperty.call(ctx.glob, name)) return ctx.glob[name];
        if (ev && Object.prototype.hasOwnProperty.call(ev, "§" + normLabel(name))) return ev["§" + normLabel(name)];
        if (name.indexOf("lkm:") === 0) return String(ctx.of(name.slice(4)).length);
        return null;
      }
    };
    return ctx;
  }

  function markerText(e){
    if (!e.marker) return "";
    return "Sijainti on merkitty pohjakuvaliitteeseen (LIITE 1, merkintä " + (e.markerLabel || "") + ").";
  }

  /* ------------------------------------------------------------------
     Rakentajat
     ------------------------------------------------------------------ */
  function run(text, bold){
    const r = el("w:r");
    if (bold) append(r, el("w:rPr", null, [el("w:b")]));
    const t = append(r, el("w:t", { "xml:space":"preserve" }));
    append(t, txt(text));
    return r;
  }
  function para(text, o){
    o = o || {};
    const p = el("w:p");
    if (o.style || o.keepNext || o.align){
      const ppr = append(p, el("w:pPr"));
      if (o.style) append(ppr, el("w:pStyle", { "w:val":o.style }));
      if (o.keepNext) append(ppr, el("w:keepNext"));
      if (o.align) append(ppr, el("w:jc", { "w:val":o.align }));
    }
    if (o.boldLead) append(p, run(o.boldLead, true));
    if (text) append(p, run(text));
    return p;
  }
  function textParas(text){
    return String(text).split(/\r?\n/).filter(l => l.trim()).map(l => para(l));
  }

  function Builder(ctx, st, media, layout){
    const B = {};
    B.heading = (text, level) => {
      level = Math.max(1, Math.min(9, level));
      while (level > 1 && !st.heading[level]) level--;
      return para(text, { style: st.heading[level] || null, keepNext:true });
    };
    B.caption = (text) => {
      const p = para("", { style: st.caption || null });
      append(p, run("Kuva "));
      append(p, el("w:r", null, [el("w:fldChar", { "w:fldCharType":"begin" })]));
      const ir = append(p, el("w:r"));
      append(append(ir, el("w:instrText", { "xml:space":"preserve" })), txt(" SEQ Kuva \\* ARABIC "));
      append(p, el("w:r", null, [el("w:fldChar", { "w:fldCharType":"separate" })]));
      const nr = append(p, el("w:r")); append(append(nr, el("w:t")), txt("1"));
      append(p, el("w:r", null, [el("w:fldChar", { "w:fldCharType":"end" })]));
      append(p, run(text ? ". " + text : "."));
      return p;
    };
    B.table = (rows, widths, opts) => {
      opts = opts || {};
      const header = opts.header !== false, borders = opts.borders !== false;
      const tbl = el("w:tbl");
      const pr = append(tbl, el("w:tblPr"));
      if (borders && st.tableGrid) append(pr, el("w:tblStyle", { "w:val":st.tableGrid }));
      append(pr, el("w:tblW", { "w:w":widths.reduce((a, b) => a + b, 0), "w:type":"dxa" }));
      if (!borders || !st.tableGrid){
        const b = append(pr, el("w:tblBorders"));
        ["top","left","bottom","right","insideH","insideV"].forEach(s =>
          append(b, el("w:" + s, borders ? { "w:val":"single", "w:sz":"4", "w:space":"0", "w:color":"auto" } : { "w:val":"nil" })));
      }
      append(pr, el("w:tblLayout", { "w:type":"fixed" }));
      const cm = append(pr, el("w:tblCellMar"));
      append(cm, el("w:left", { "w:w":"85", "w:type":"dxa" }));
      append(cm, el("w:right", { "w:w":"85", "w:type":"dxa" }));
      append(pr, el("w:tblLook", { "w:val":"04A0", "w:firstRow":"1", "w:lastRow":"0", "w:firstColumn":"0", "w:lastColumn":"0", "w:noHBand":"0", "w:noVBand":"1" }));
      const grid = append(tbl, el("w:tblGrid"));
      widths.forEach(w => append(grid, el("w:gridCol", { "w:w":w })));
      rows.forEach((row, ri) => {
        const tr = append(tbl, el("w:tr"));
        const trpr = append(tr, el("w:trPr"));
        append(trpr, el("w:cantSplit"));
        if (header && ri === 0) append(trpr, el("w:tblHeader"));
        row.forEach((cell, ci) => {
          const tc = append(tr, el("w:tc"));
          const tcpr = append(tc, el("w:tcPr"));
          append(tcpr, el("w:tcW", { "w:w":widths[ci], "w:type":"dxa" }));
          if (header && ri === 0) append(tcpr, el("w:shd", { "w:val":"clear", "w:color":"auto", "w:fill":"F2F2F2" }));
          if (Array.isArray(cell)) cell.forEach(c => append(tc, c));
          else if (header && ri === 0) append(tc, para("", { boldLead:String(cell), align:"left" }));
          else append(tc, para(String(cell), { align:"left" }));
          if (!kids(tc, "w:p").length) append(tc, para(""));
        });
      });
      return tbl;
    };
    /* Kuvat allekkain (yksi kuva + kuvateksti per kappale), ei vierekkäin taulukossa. */
    B.photoGrid = (photos) => {
      if (!photos.length) return [];
      const out = [];
      photos.forEach(ph => {
        const ip = para("", { keepNext:true, align:"left" });
        append(ip, media.drawing(ph, layout.photoCx, layout.photoMaxCy));
        out.push(ip);
        out.push(B.caption(ph.caption || ""));
        out.push(para(""));
      });
      return out;
    };
    B.entryPhotos = (e) => (e.photos || []).filter(p => p && p.bytes && p.bytes.length && p.width > 1).map(p => ({
      bytes:p.bytes, width:p.width, height:p.height,
      caption: (p.caption && String(p.caption).trim()) || ctx.ident(e) || ""
    }));
    B.entryBody = (e) => {
      const m = ctx.methods[e.methodId];
      const out = [];
      const fields = m.fields.filter(f => f.type !== "table" && ctx.visible(e, f) && ctx.fieldValue(e, f));
      const longs = fields.filter(f => f.type === "textarea");
      fields.forEach(f => {
        const v = ctx.fieldValue(e, f);
        if (f.type === "textarea"){
          if (longs.length > 1) out.push(para("", { boldLead:f.label + ":", keepNext:true }));
          textParas(v).forEach(p => out.push(p));
        } else {
          out.push(para(v, { boldLead:f.label + ": " }));
        }
      });
      // taulukkokentät
      m.fields.filter(f => f.type === "table" && ctx.visible(e, f)).forEach(f => {
        const rows = Array.isArray((e.values || {})[f.id]) ? e.values[f.id] : [];
        const cols = (f.columns || []).filter(c => c.label && String(c.label).trim());
        const data = rows.filter(r => cols.some(c => r && r[c.id] != null && String(r[c.id]).trim() !== ""));
        if (!cols.length || !data.length) return;
        out.push(para("", { boldLead:f.label + ":", keepNext:true }));
        const w = Math.floor(layout.textW / cols.length);
        const widths = cols.map(() => w); widths[widths.length - 1] += layout.textW - w * cols.length;
        out.push(B.table([cols.map(c => c.label)].concat(data.map(r => cols.map(c =>
          r[c.id] == null ? "" : ((c.type === "number" || c.type === "calc") ? fmtNumKeep(r[c.id]) : (c.type === "date" ? fiDate(r[c.id]) : String(r[c.id])))))), widths));
        out.push(para(""));
      });
      if ((e.values || {}).huomiot) textParas(e.values.huomiot).forEach(p => out.push(p));
      if (markerText(e)) out.push(para(markerText(e)));
      return out;
    };
    return B;
  }

  /* ------------------------------------------------------------------
     Kuvat
     ------------------------------------------------------------------ */
  function Media(zip, relsDoc, ctDoc){
    let n = 0, docPr = 7000;
    const relsRoot = kids(relsDoc)[0];
    const ctRoot = kids(ctDoc)[0];
    const hasJpeg = kids(ctRoot, "Default").some(d => /^jpe?g$/i.test(attr(d, "Extension") || "") && (attr(d, "Extension") || "").toLowerCase() === "jpeg");
    if (!hasJpeg) append(ctRoot, el("Default", { Extension:"jpeg", ContentType:"image/jpeg" }));
    return {
      drawing(ph, maxCx, maxCy){
        n++; docPr++;
        const name = "media/kentta_" + n + ".jpeg";
        zip.file("word/" + name, ph.bytes);
        const rid = "rIdKentta" + n;
        append(relsRoot, el("Relationship", { Id:rid, Type:"http://schemas.openxmlformats.org/officeDocument/2006/relationships/image", Target:name }));
        const w = ph.width || 4, h = ph.height || 3;
        let cx = maxCx, cy = Math.round(cx * h / w);
        if (cy > maxCy){ cy = maxCy; cx = Math.round(cy * w / h); }
        const xml =
          '<w:r><w:rPr><w:noProof/></w:rPr><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">' +
          '<wp:extent cx="' + cx + '" cy="' + cy + '"/><wp:docPr id="' + docPr + '" name="Kenttäkuva ' + n + '"/>' +
          '<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
          '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
          '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="' + docPr + '" name="Kenttäkuva ' + n + '"/><pic:cNvPicPr><a:picLocks noChangeAspect="1"/></pic:cNvPicPr></pic:nvPicPr>' +
          '<pic:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="' + rid + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
          '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
        return fragment(xml)[0];
      }
    };
  }

  /* ------------------------------------------------------------------
     Lohkot
     ------------------------------------------------------------------ */
  function contextLevel(p, st){
    let c = prev(p);
    while (c){
      if (c.name === "w:p"){ const lv = st.headingLevelOf[pstyle(c)]; if (lv) return lv; }
      c = prev(c);
    }
    return 1;
  }

  function blockElements(ctx, B, st, layout, name, at){
    const lv = contextLevel(at, st);
    if (name.indexOf("menetelmä:") === 0){
      const out = [];
      ctx.of(name.slice(10)).forEach(e => {
        const m = ctx.methods[e.methodId];
        out.push(B.heading(ctx.ident(e) || m.name, lv + 1));
        B.entryBody(e).forEach(x => out.push(x));
        B.photoGrid(B.entryPhotos(e)).forEach(x => out.push(x));
      });
      return out;
    }
    if (name.indexOf("taulukko:") === 0){
      const es = ctx.of(name.slice(9));
      if (!es.length) return [];
      const m = ctx.methods[es[0].methodId];
      const fields = m.fields.filter(f => f.type !== "textarea" && f.type !== "table" && es.some(e => ctx.visible(e, f) && ctx.fieldValue(e, f)));
      /* Ensimmäinen sarake: vanhoissa kirjauksissa Tunnus/Tila, muuten osio.
         Jos kummallakaan ei ole arvoja, sarake jätetään pois. */
      /* Ensimmäinen sarake vain vanhoille kirjauksille (Tunnus/Tila); osio ei näy taulukossa. */
      const lead = e => String((e.values || {}).paikka || "").trim();
      const hasLead = es.some(e => lead(e));
      const rows = [(hasLead ? ["Tunnus / tila"] : []).concat(fields.map(f => f.label))]
        .concat(es.map(e => (hasLead ? [lead(e) || ""] : []).concat(fields.map(f => ctx.visible(e, f) ? ctx.fieldValue(e, f) : ""))));
      const first = hasLead ? Math.floor(layout.textW * (fields.length > 1 ? 0.30 : 0.5)) : 0;
      const rest = Math.floor((layout.textW - first) / Math.max(1, fields.length));
      const widths = (hasLead ? [first] : []).concat(fields.map(() => rest));
      widths[widths.length - 1] += layout.textW - widths.reduce((a, b) => a + b, 0);
      return [B.table(rows, widths), para("")];
    }
    if (name.indexOf("kuvat:") === 0){
      let photos = [];
      ctx.of(name.slice(6)).forEach(e => { photos = photos.concat(B.entryPhotos(e)); });
      return B.photoGrid(photos);
    }
    if (name === "kirjaukset tiloittain"){
      const out = [], order = [], key = e => (String(((e.values || {}).paikka) || "").trim() || ctx.osio(e) || "Muut havainnot");
      ctx.entries.forEach(e => { if (order.indexOf(key(e)) < 0) order.push(key(e)); });
      order.forEach(k => {
        const group = ctx.entries.filter(e => key(e) === k);
        out.push(B.heading(k, lv + 1));
        let photos = [];
        group.forEach(e => {
          out.push(para("", { boldLead:ctx.methods[e.methodId].name, keepNext:true }));
          B.entryBody(e).forEach(x => out.push(x));
          photos = photos.concat(B.entryPhotos(e));
        });
        B.photoGrid(photos).forEach(x => out.push(x));
      });
      return out;
    }
    if (name.indexOf("osio:") === 0){
      /* Pohjan oma otsikko on jo olemassa: kirjaukset sen alle alaotsikoina. */
      const out = [];
      ctx.ofOsio(name.slice(5)).forEach(e => {
        const mname = ctx.methods[e.methodId].name, id = ctx.ident(e);
        out.push(B.heading(id ? id + " – " + mname : mname, lv + 1));
        B.entryBody(e).forEach(x => out.push(x));
        B.photoGrid(B.entryPhotos(e)).forEach(x => out.push(x));
      });
      return out;
    }
    if (name === "kirjaukset osioittain"){
      /* Osiot pääotsikoina osiolistan järjestyksessä; itse kirjoitetut osiot
         listan jälkeen ja osiottomat kirjaukset otsikon "Muut havainnot" alle.
         Osiot, joilla on pohjassa oma {{osio:nimi}}, ohitetaan (ei kahteen kertaan). */
      const out = [], key = e => ctx.osio(e) || "Muut havainnot";
      const own = e => ctx.osio(e) && ctx.ownOsiot[normOsio(ctx.osio(e))];
      const rest = ctx.entries.filter(e => !own(e));
      const order = ctx.osiot.filter(o => rest.some(e => key(e) === o));
      rest.forEach(e => { const k = key(e); if (order.indexOf(k) < 0 && k !== "Muut havainnot") order.push(k); });
      if (rest.some(e => key(e) === "Muut havainnot")) order.push("Muut havainnot");
      order.forEach(k => {
        out.push(B.heading(k, lv + 1));
        rest.filter(e => key(e) === k).forEach(e => {
          const mname = ctx.methods[e.methodId].name, id = ctx.ident(e);
          out.push(B.heading(id ? id + " – " + mname : mname, lv + 2));
          B.entryBody(e).forEach(x => out.push(x));
          B.photoGrid(B.entryPhotos(e)).forEach(x => out.push(x));
        });
      });
      return out;
    }
    if (name === "kirjaukset"){
      const out = [];
      Object.keys(ctx.methods).forEach(mid => {
        const es = ctx.of(mid); if (!es.length) return;
        out.push(B.heading(ctx.methods[mid].name, lv + 1));
        es.forEach(e => {
          out.push(B.heading(ctx.ident(e) || ctx.methods[mid].name, lv + 2));
          B.entryBody(e).forEach(x => out.push(x));
          B.photoGrid(B.entryPhotos(e)).forEach(x => out.push(x));
        });
      });
      return out;
    }
    if (name === "menetelmäluettelo"){
      return Object.keys(ctx.methods).filter(mid => ctx.of(mid).length)
        .map(mid => para(ctx.methods[mid].name + " (" + ctx.of(mid).length + " kpl)", { style: st.listPara || null }));
    }
    return null;
  }

  /* ------------------------------------------------------------------
     Tekstikorvaukset
     ------------------------------------------------------------------ */
  function replaceInline(ctx, rootEl, ev, removeEmpty){
    const plist = rootEl.name === "w:p" ? [rootEl] : desc(rootEl, "w:p");
    plist.forEach(p => {
      const full = ptext(p);
      if (full.indexOf("{{") < 0) return;
      const whole = /^\s*\{\{[^{}]+\}\}\s*$/.test(full);
      const touched = regexReplace(p, TAG_RE, m => {
        const v = ctx.resolve(m[0], ev);
        return v === null ? m[0] : v;
      });
      const touchedRuns = touched.map(runOf).filter(Boolean);
      touchedRuns.forEach(r => {
        stripRed(r);
        if (whole){
          const rpr = kid(r, "w:rPr");
          if (rpr) kids(rpr).filter(c => c.name === "w:color" || c.name === "w:i" || c.name === "w:iCs").forEach(remove);
        }
      });
      if (touchedRuns.length){
        const runs = desc(p, "w:r").filter(r => desc(r, "w:t").map(textOf).join("").trim());
        const others = runs.filter(r => touchedRuns.indexOf(r) < 0);
        if (others.length && others.every(isRed)) others.forEach(stripRed);
      }
      if (removeEmpty !== false && !ptext(p).trim() && !desc(p, "w:drawing").length && !desc(p, "w:pict").length){
        const par = p.parent;
        if (par && (par.name !== "w:tc" || kids(par, "w:p").length > 1)) remove(p);
      }
    });
  }

  /* Word-taulukon rivi, jossa on {{rivit:kenttä}}, toistetaan kirjauksen
     taulukkokentän jokaiselle (ei-tyhjälle) riville. Solujen merkinnät ovat
     sarakkeiden nimiä tai tunnisteita. Jos rivejä ei ole, rivi poistetaan. */
  function expandFieldRows(ctx, rootEl, e, vals){
    const trs = (rootEl.name === "w:tr" ? [rootEl] : desc(rootEl, "w:tr"))
      .filter(tr => /\{\{\s*rivit:[^}]+\}\}/.test(textOf(tr)));
    /* Toistossa taulukko poistetaan kokonaan (otsikkoriveineen), jos sen
       taulukkokentissä ei ollut yhtään riviä. */
    const added = new Map();
    trs.forEach(tr => {
      const tbl = ancestor(tr, "w:tbl");
      if (tbl && !added.has(tbl)) added.set(tbl, 0);
      const before = tbl ? kids(tbl, "w:tr").length : 0;
      const rowText = textOf(tr);
      const ref = /\{\{\s*rivit:([^}]+)\}\}/.exec(rowText)[1].trim();
      const m = ctx.methods[e.methodId];
      const tags = (rowText.match(TAG_RE) || []).map(t => t.slice(2, -2).trim()).filter(t => !/^rivit:/.test(t));
      const hit = findRowField(m, ref, tags, e, ctx);
      const f = hit.field;
      const mname = m ? m.name : e.methodId;
      if (!f){
        warnOnce(ctx, "Taulukkokenttää ”" + ref + "” ei löytynyt menetelmästä ”" + mname + "”. Menetelmän taulukkokentät: " +
          (hit.tables.length ? hit.tables.map(t => "”" + t.label + "”").join(", ") : "ei yhtään") + ". Korjaa nimi pohjan merkintään {{rivit:…}}.");
        remove(tr);
        return;
      }
      if (hit.guessed) warnOnce(ctx, "Pohjan merkintä {{rivit:" + ref + "}}: menetelmässä ”" + mname + "” ei ole tämännimistä taulukkokenttää, joten käytettiin kenttää ”" + f.label + "”. Korjaa nimi pohjaan.");
      const quiet = rootEl.name !== "w:tr";   /* toistossa tyhjä tai piilotettu taulukko jätetään pois ilman varoitusta */
      if (!ctx.visible(e, f) && !quiet){
        const why = e.hiddenWhy && e.hiddenWhy[f.id] ? " (" + e.hiddenWhy[f.id] + ")" : "";
        warnOnce(ctx, "Kirjauksessa ”" + (ctx.ident(e) || mname) + "” kenttä ”" + f.label + "” on piilotettu" + why + ", joten sen rivejä ei tuotu raporttiin.");
      }
      desc(tr, "w:color").forEach(c => { if (PLACEHOLDER_REDS[(attr(c, "w:val") || "").toUpperCase()]) remove(c); });
      const cols = (f.columns || []).filter(c => c.label && String(c.label).trim());
      const data = ctx.visible(e, f) && Array.isArray((e.values || {})[f.id]) ? e.values[f.id] : [];
      const rows = data.filter(r => r && cols.some(c => r[c.id] != null && String(r[c.id]).trim() !== ""));
      if (!rows.length && ctx.visible(e, f) && !quiet){
        warnOnce(ctx, "Kirjauksessa ”" + (ctx.ident(e) || mname) + "” ei ole rivejä kentässä ”" + f.label + "”.");
      }
      /* Solun merkintä, joka ei vastaa yhtään saraketta, kerrotaan kerran. */
      tags.forEach(tg => {
        const n = normLabel(tg);
        const known = n === "abs" || cols.some(c => c.id === tg || normLabel(c.label) === n) ||
          Object.prototype.hasOwnProperty.call(vals, tg) || Object.prototype.hasOwnProperty.call(vals, "§" + n) ||
          Object.prototype.hasOwnProperty.call(ctx.glob, tg);
        if (!known) warnOnce(ctx, "Pohjan merkinnälle {{" + tg + "}} ei löytynyt saraketta kentästä ”" + f.label + "”. Sarakkeet: " + cols.map(c => "”" + c.label + "”").join(", ") + ".");
      });
      const find = re => cols.find(c => re.test(normLabel(c.label)));
      rows.forEach(r => {
        const rv = Object.assign({}, vals);
        rv["rivit:" + ref] = "";
        cols.forEach(c => {
          const raw = r[c.id];
          const v = raw == null || String(raw).trim() === "" ? "" :
            ((c.type === "number" || c.type === "calc") ? fmtNumKeep(raw) : (c.type === "date" ? fiDate(raw) : String(raw)));
          rv[c.id] = v;
          rv["§" + normLabel(c.label)] = v;
        });
        /* Absoluuttinen kosteus lasketaan, jos sarake puuttuu tai on tyhjä. */
        if (!rv["§abs"]){
          const cRh = find(/^rh\b|suhteellinen/), cT = find(/^t$|lämpötila|lampotila/);
          if (cRh && cT && r[cRh.id] != null && r[cT.id] != null && String(r[cRh.id]).trim() && String(r[cT.id]).trim()){
            rv["§abs"] = absHumidity(r[cRh.id], r[cT.id]);
          }
        }
        const c2 = clone(tr); stripIds(c2);
        desc(c2, "w:vMerge").forEach(remove);
        insertBefore(tr, c2);
        dropEmptyLines(ctx, c2, rv);
        dropOptional(ctx, c2, rv);
        replaceInline(ctx, c2, rv, false);
      });
      if (tbl) added.set(tbl, added.get(tbl) + (kids(tbl, "w:tr").length - before));
      remove(tr);
    });
    if (rootEl.name !== "w:tr") added.forEach((n, tbl) => { if (n === 0 && tbl.parent) remove(tbl); });
  }

  /* Solussa, jossa on useita kappaleita, kappale jätetään pois, jos kaikki
     sen merkinnät ovat tyhjiä (esim. "Allaskaappi: {{Allaskaappi}}" pesuhuoneessa). */
  function dropEmptyLines(ctx, rowEl, rv){
    desc(rowEl, "w:tc").forEach(tc => {
      const ps = kids(tc, "w:p");
      if (ps.length < 2) return;
      ps.forEach(p => {
        const tags = (ptext(p).match(TAG_RE) || []).filter(t => !/^\{\{\s*rivit?:/.test(t));
        if (!tags.length) return;
        const empty = tags.every(t => { const v = ctx.resolve(t, rv); return v === null || String(v).trim() === ""; });
        if (empty && kids(tc, "w:p").length > 1) remove(p);
      });
    });
  }

  /* {{?kenttä}}: kappale jätetään pois, jos jokin sen ?-merkinnöistä on tyhjä
     (esim. "Lattian ja AO-puun alapinnan korkeusero: {{?Lattian ja AO-puun alapinnan korkeusero}} cm").
     Palauttaa true, jos koko elementti poistettiin. */
  function dropOptional(ctx, rootEl, vals){
    const ps = rootEl.name === "w:p" ? [rootEl] : desc(rootEl, "w:p");
    let removedRoot = false;
    ps.forEach(p => {
      const tags = (ptext(p).match(TAG_RE) || []).filter(t => /^\{\{\s*\?/.test(t));
      if (!tags.length) return;
      const empty = tags.some(t => { const v = ctx.resolve(t, vals); return v === null || String(v).trim() === ""; });
      if (!empty) return;
      const tc = ancestor(p, "w:tc");
      if (tc && kids(tc, "w:p").length <= 1){ kids(p).filter(x => x.name === "w:r").forEach(remove); return; }
      if (p === rootEl) removedRoot = true;
      remove(p);
    });
    return removedRoot;
  }

  function warnOnce(ctx, msg){ if (ctx.warnings.indexOf(msg) < 0) ctx.warnings.push(msg); }

  function stripIds(e){
    desc(e, "w:bookmarkStart").concat(desc(e, "w:bookmarkEnd")).forEach(remove);
    (function w(n){ if (n.t !== "el") return; delAttr(n, "w14:paraId"); delAttr(n, "w14:textId"); n.children.forEach(w); })(e);
  }

  function markerPairs(body, openRe, closeText){
    const stack = [], pairs = [];
    kids(body, "w:p").forEach(p => {
      const t = ptext(p).trim();
      if (openRe.test(t)) stack.push(p);
      else if (t === closeText && stack.length) pairs.push([stack.pop(), p]);
    });
    return pairs;
  }
  function between(a, b){
    const s = a.parent.children, out = [];
    for (let i = s.indexOf(a) + 1; i < s.length && s[i] !== b; i++) if (s[i].t === "el") out.push(s[i]);
    return out;
  }

  /* ------------------------------------------------------------------
     Pääfunktio
     ------------------------------------------------------------------ */
  async function fill(templateBytes, input, opts){
    opts = opts || {};
    const zip = await JSZipLib.loadAsync(templateBytes);
    const ctx = makeCtx(input);
    const read = async name => { const f = zip.file(name); return f ? parseXml(await f.async("string")) : null; };
    const doc = await read("word/document.xml");
    const styles = await read("word/styles.xml");
    const rels = await read("word/_rels/document.xml.rels");
    const ct = await read("[Content_Types].xml");
    const st = readStyles(styles);
    const body = kid(kids(doc)[0], "w:body");

    // Tekstialueen leveys viimeisestä osasta (twip)
    const sect = kid(body, "w:sectPr") || desc(body, "w:sectPr").pop();
    let textW = 9638;
    if (sect){
      const sz = kid(sect, "w:pgSz"), mar = kid(sect, "w:pgMar");
      const W = sz ? +attr(sz, "w:w") : 11906;
      const l = mar ? +attr(mar, "w:left") || 0 : 1134, r = mar ? +attr(mar, "w:right") || 0 : 1134;
      if (W && W - l - r > 2000) textW = W - l - r;
    }
    const layout = { textW, photoCx: Math.round((textW / 2 - 300) * 635), photoMaxCy: 2340000 };
    const media = Media(zip, rels, ct);
    const B = Builder(ctx, st, media, layout);

    // 1) Ehdot (sisimmät ensin)
    markerPairs(body, /^\{\{jos(:| osio:)[^}]+\}\}$/, "{{/jos}}").forEach(([a, b]) => {
      if (!a.parent || !b.parent) return;
      const t = ptext(a).trim();
      const empty = /^\{\{jos osio:/.test(t)
        ? !ctx.ofOsio(t.slice(11, -2)).length
        : !ctx.of(t.slice(6, -2)).length;
      if (empty) between(a, b).forEach(remove);
      remove(a); remove(b);
    });

    // Pohjan omat osiokohdat talteen ennen lohkoja ({{kirjaukset osioittain}} ohittaa ne)
    kids(body, "w:p").forEach(p => {
      const m = /^\{\{\s*osio:([^{}]+)\}\}$/.exec(ptext(p).trim());
      if (m) ctx.ownOsiot[normOsio(m[1])] = true;
    });

    // 2) Toistot
    markerPairs(body, /^\{\{toista:[^}]+\}\}$/, "{{/toista}}").forEach(([a, b]) => {
      if (!a.parent || !b.parent) return;
      const tpl = between(a, b);
      ctx.of(ptext(a).trim().slice(9, -2)).forEach(e => {
        const vals = ctx.entryVals(e);
        tpl.forEach(src => {
          if (src.name === "w:p" && ptext(src).trim() === "{{kuvat}}"){
            B.photoGrid(B.entryPhotos(e)).forEach(x => insertBefore(b, x));
            return;
          }
          const c = clone(src); stripIds(c);
          insertBefore(b, c);
          expandFieldRows(ctx, c, e, vals);
          if (dropOptional(ctx, c, vals)) return;
          replaceInline(ctx, c, vals);
        });
      });
      tpl.forEach(remove); remove(a); remove(b);
    });

    // 2b) Osiot pohjan valmiiden otsikoiden alle (vain kun pohjassa on {{kirjaukset osioittain}}):
    //     jos pohjassa on otsikko, jonka teksti on sama kuin osion nimi (numerointia ja
    //     kirjainkokoa huomioimatta), osion kirjaukset lisätään otsikon osion loppuun
    //     eikä otsikkoa toisteta {{kirjaukset osioittain}}-kohdassa.
    if (kids(body, "w:p").some(p => /^\{\{\s*kirjaukset osioittain\s*\}\}$/.test(ptext(p).trim()))){
      const headNorm = t => normOsio(String(t).replace(/^\s*\d+(\.\d+)*\.?\s+/, "").replace(/[.:]+\s*$/, ""));
      const top = kids(body).filter(c => c.t === "el");
      const heads = top.map((c, i) => ({ c, i, lv: c.name === "w:p" ? st.headingLevelOf[pstyle(c)] : 0 }))
        .filter(h => h.lv && ptext(h.c).trim());
      const osioNames = {};
      ctx.entries.forEach(e => { const o = ctx.osio(e); if (o) osioNames[normOsio(o)] = o; });
      Object.keys(osioNames).forEach(k => {
        if (ctx.ownOsiot[k]) return;
        const h = heads.find(x => headNorm(ptext(x.c)) === k);
        if (!h) return;
        /* Lisäyskohta: ennen seuraavaa samantasoista tai ylempää otsikkoa tai osanvaihtoa. */
        let end = null;
        for (let j = h.i + 1; j < top.length; j++){
          const c = top[j];
          if (c.name === "w:sectPr"){ end = c; break; }
          const lv2 = c.name === "w:p" ? st.headingLevelOf[pstyle(c)] : 0;
          if (lv2 && lv2 <= h.lv && ptext(c).trim()){ end = c; break; }
        }
        const els = [];
        ctx.ofOsio(osioNames[k]).forEach(e => {
          const mname = ctx.methods[e.methodId].name, id = ctx.ident(e);
          els.push(B.heading(id ? id + " – " + mname : mname, Math.min(h.lv + 1, 9)));
          B.entryBody(e).forEach(x => els.push(x));
          B.photoGrid(B.entryPhotos(e)).forEach(x => els.push(x));
        });
        if (end) els.forEach(x => insertBefore(end, x));
        else els.forEach(x => append(body, x));
        ctx.ownOsiot[k] = true;
      });
    }

    // 3) Lohkot
    kids(body, "w:p").forEach(p => {
      const t = ptext(p).trim();
      const m = /^\{\{([^{}]+)\}\}$/.exec(t);
      if (!m) return;
      const els = blockElements(ctx, B, st, layout, m[1].trim(), p);
      if (els === null) return;
      els.forEach(x => insertBefore(p, x));
      remove(p);
    });

    // 4) Toistorivit taulukoissa
    desc(body, "w:tbl").forEach(tbl => {
      kids(tbl, "w:tr").forEach(tr => {
        const m = /\{\{rivi:([^}]+)\}\}/.exec(textOf(tr));
        if (!m) return;
        desc(tbl, "w:color").forEach(c => { if (PLACEHOLDER_REDS[(attr(c, "w:val") || "").toUpperCase()]) remove(c); });
        ctx.of(m[1]).forEach(e => {
          const c = clone(tr); stripIds(c);
          const vals = ctx.entryVals(e); vals["rivi:" + m[1]] = "";
          insertBefore(tr, c);
          /* {{rivi:id}} + {{rivit:kenttä}} samalla rivillä: kaikkien kirjausten
             taulukkokentän rivit yhteen taulukkoon (esim. olosuhteet). */
          if (/\{\{\s*rivit:/.test(textOf(c))) expandFieldRows(ctx, c, e, vals);
          else replaceInline(ctx, c, vals, false);
        });
        remove(tr);
      });
    });

    // 5) Tekstit: runko + ne ylä-/alatunnisteet, joissa on merkintöjä
    replaceInline(ctx, body);
    const hfNames = Object.keys(zip.files).filter(n => /^word\/(header|footer)\d+\.xml$/.test(n));
    const hfDocs = {};
    for (const n of hfNames){
      const s = await zip.file(n).async("string");
      if (s.indexOf("{{") < 0) continue;
      hfDocs[n] = parseXml(s);
      replaceInline(ctx, kids(hfDocs[n])[0]);
    }
    const coreF = zip.file("docProps/core.xml");
    if (coreF){
      const s = await coreF.async("string");
      if (s.indexOf("{{") >= 0) zip.file("docProps/core.xml", s.replace(/\{\{projektinumero\}\}/g, escText(ctx.glob.projektinumero)).replace(/\{\{kohde\}\}/g, escText(ctx.glob.kohde)));
    }

    // 6) Päivämääräohjausobjektit samaan päivään
    [doc].concat(Object.values(hfDocs)).forEach(d => {
      desc(kids(d)[0], "w:sdt").forEach(sdt => {
        const dt = path(sdt, ["w:sdtPr", "w:date"]);
        const content = kid(sdt, "w:sdtContent");
        if (dt && content && ptext(content).trim() === ctx.glob.raporttipvm) setAttr(dt, "w:fullDate", ctx.reportIso + "T00:00:00Z");
      });
    });

    // 7) Kuvanumerot valmiiksi oikein (Word päivittää ne myös itse)
    let num = 0;
    desc(body, "w:p").forEach(p => {
      const rs = desc(p, "w:r");
      rs.forEach((r, i) => {
        const it = kid(r, "w:instrText");
        if (it && /SEQ\s+Kuva/.test(textOf(it))){
          num++;
          for (let k = i + 1; k < rs.length; k++){
            const t = kid(rs[k], "w:t");
            if (t){ setT(t, String(num)); break; }
          }
        }
      });
    });

    // 8) Tunnistamattomat merkinnät varoituksiksi
    [doc].concat(Object.values(hfDocs)).forEach(d => desc(kids(d)[0], "w:p").forEach(p => {
      (ptext(p).match(TAG_RE) || []).forEach(t => ctx.warnings.push("Tuntematon merkintä " + t));
    }));

    // Sisällysluettelo päivittyy avattaessa
    const setF = zip.file("word/settings.xml");
    if (setF && opts.updateFields !== false){
      const sd = parseXml(await setF.async("string"));
      const sr = kids(sd)[0];
      if (!kid(sr, "w:updateFields") && desc(body, "w:instrText").some(i => /\bTOC\b/.test(textOf(i)))){
        const after = ["w:hdrShapeDefaults","w:footnotePr","w:endnotePr","w:compat","w:docVars","w:rsids"];
        const ref = kids(sr).find(c => after.indexOf(c.name) >= 0);
        const u = el("w:updateFields", { "w:val":"true" });
        if (ref) insertBefore(ref, u); else append(sr, u);
        zip.file("word/settings.xml", serialize(sd));
      }
    }

    zip.file("word/document.xml", serialize(doc));
    zip.file("word/_rels/document.xml.rels", serialize(rels));
    zip.file("[Content_Types].xml", serialize(ct));
    Object.keys(hfDocs).forEach(n => zip.file(n, serialize(hfDocs[n])));

    const out = await zip.generateAsync({
      type: opts.type || (typeof Blob !== "undefined" ? "blob" : "uint8array"),
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      compression: "DEFLATE"
    });
    return { output: out, warnings: ctx.warnings };
  }

  /* Pohjan tarkistus ladattaessa: mitkä merkinnät löytyivät ja mitkä ovat tuntemattomia. */
  async function scan(templateBytes, methods, osiot){
    const osioKeys = {}; (osiot || []).forEach(o => { osioKeys[normOsio(o)] = 1; });
    const notices = [];
    const zip = await JSZipLib.loadAsync(templateBytes);
    if (!zip.file("word/document.xml")) throw new Error("Tiedosto ei ole Word-asiakirja (.docx)");
    const ids = {}; (methods || []).forEach(m => { ids[m.id] = m; if (m.name) ids[normLabel(m.name)] = m; if (m.short) ids[normLabel(m.short)] = m; });
    const fieldIds = {}; (methods || []).forEach(m => (m.fields || []).forEach(f => { fieldIds[f.id] = 1; }));
    const labels = { abs:1 }; (methods || []).forEach(m => (m.fields || []).forEach(f => {
      if (f.label) labels[normLabel(f.label)] = 1;
      (f.columns || []).forEach(c => { if (c.label) labels[normLabel(c.label)] = 1; fieldIds[c.id] = 1; });
    }));
    const found = [], unknown = [];
    const names = Object.keys(zip.files).filter(n => /^word\/(document|header\d+|footer\d+)\.xml$/.test(n));
    let inEntryScope = false;
    for (const n of names){
      const d = parseXml(await zip.file(n).async("string"));
      desc(kids(d)[0], "w:p").forEach(p => {
        const t = ptext(p);
        (t.match(TAG_RE) || []).forEach(tag => {
          const nm = tag.slice(2, -2).trim().replace(/^\?\s*/, "");
          if (/^toista:/.test(nm)) inEntryScope = true;
          if (nm === "/toista") inEntryScope = false;
          let ok = GLOBAL_KEYS.indexOf(nm) >= 0 || BLOCK_NAMES.indexOf(nm) >= 0 || nm === "/jos" || nm === "/toista";
          let m;
          if (!ok && (m = /^(jos osio|osio):(.+)$/.exec(nm))){
            ok = true;
            if (osiot && osiot.length && !osioKeys[normOsio(m[2])]){
              notices.push(tag + ": osiota ”" + m[2].trim() + "” ei ole osiolistalla. Kohtaan tulevat vain kirjaukset, joiden osioksi on kirjoitettu sama nimi.");
            }
          }
          if (!ok && (m = /^(jos|toista|rivi|lkm|menetelmä|taulukko|kuvat):(.+)$/.exec(nm))){
            const spec = m[2].replace(/\[[^\]]*\]\s*$/, "");
            const bad = spec.split(",").map(s => s.trim()).filter(id => !ids[id] && !ids[normLabel(id)]);
            ok = !bad.length;
            if (!ok){ unknown.push(tag + " (tuntematon menetelmä: " + bad.join(", ") + ")"); found.push(tag); return; }
          }
          const tr = ancestor(p, "w:tr");
          const inRow = !!(tr && /\{\{rivi:/.test(textOf(tr)));
          if (!ok && /^rivit:/.test(nm) && (methods || []).length){
            const ref = nm.slice(6).trim();
            const tablesAll = [];
            (methods || []).forEach(mm => (mm.fields || []).forEach(f => { if (f.type === "table") tablesAll.push(f); }));
            if (!tablesAll.some(f => f.id === ref || normLabel(f.label) === normLabel(ref))){
              notices.push(tag + ": taulukkokenttää ”" + ref + "” ei löytynyt menetelmistä. Taulukkokentät: " +
                (tablesAll.length ? tablesAll.map(f => "”" + f.label + "”").filter((x, i, a) => a.indexOf(x) === i).join(", ") : "ei yhtään") + ".");
            }
          }
          if (!ok && (inEntryScope || inRow) && (ENTRY_KEYS.indexOf(nm) >= 0 || fieldIds[nm] || labels[normLabel(nm)] || /^rivit:/.test(nm))) ok = true;
          found.push(tag);
          if (!ok) unknown.push(tag);
        });
      });
    }
    const uniq = a => a.filter((x, i) => a.indexOf(x) === i);
    return { found: uniq(found), unknown: uniq(unknown), notices: uniq(notices) };
  }

  const api = { fill, scan, _parseXml:parseXml, _serialize:serialize };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof root !== "undefined") root.ReportTemplateEngine = api;

})(typeof window !== "undefined" ? window : globalThis);
