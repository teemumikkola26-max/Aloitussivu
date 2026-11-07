/* =========================================================================
   FORMULA.JS — laskettujen taulukkosarakkeiden kaavat
   -------------------------------------------------------------------------
   Käytössä kenttälomakkeessa (kenttalomake.html) ja lomake-editorin
   lomakkeissa (form-runtime.js / editor-runtime.js).

   Sarake: { id, label, type:"calc", formula, decimals }
     formula  = kaava sarakeviittauksin muodossa {@sarakeId}; editorissa
                käyttäjä näkee ja kirjoittaa viittaukset sarakkeiden nimillä
                muodossa {Sarakkeen nimi}. Tunnisteiden ansiosta kaava säilyy,
                vaikka sarake nimettäisiin uudelleen.
     decimals = näytettävien desimaalien määrä (oletus 1)

   Kaavan osat:
     luvut (8.27 tai 8,27), + - * / ^, sulut
     funktioiden argumentit erotetaan puolipisteellä ;
     min(a; b; …)  max(a; b; …)  keskiarvo(a; b; …)  itseisarvo(x)
     abskost(T; RH)    absoluuttinen kosteus g/m³
     kastepiste(T; RH) kastepistelämpötila °C
     suhtkost(T; a)    suhteellinen kosteus % (T ja absoluuttinen kosteus)
   Päivämääräsarake on viittauksena päivien määrä, joten
   {Lukupäivä} - {Asennuspäivä} antaa välin vuorokausina.
   Jos jokin viitattu solu on tyhjä tai ei ole luku, tulos on tyhjä.

   Kosteusfunktiot käyttävät samaa Magnus-kaavaa kuin raporttipohjamoottori
   (report-template-engine.js), jotta lomake ja raportti antavat saman arvon.
   Kaava ei ole sama kuin mittalaitteen sisäinen laskenta, joten tulos voi
   poiketa mittalaitteen näyttämästä noin 1 %.
   ========================================================================= */
(function(){
"use strict";

/* ---------- Kosteusfunktiot ---------- */
function ps(t){ return 6.112 * Math.exp(17.67 * t / (t + 243.5)); }
function absHum(t, rh){ return ps(t) * rh * 2.1674 / (273.15 + t); }
function dewPoint(t, rh){
  if (rh <= 0) return NaN;
  const g = Math.log(rh / 100) + 17.67 * t / (243.5 + t);
  return 243.5 * g / (17.67 - g);
}
function relHum(t, a){ return a * (273.15 + t) / (2.1674 * ps(t)); }

const FUNCS = {
  min:       { min:1, max:99, fn: a => Math.min.apply(null, a) },
  max:       { min:1, max:99, fn: a => Math.max.apply(null, a) },
  keskiarvo: { min:1, max:99, fn: a => a.reduce((s, x) => s + x, 0) / a.length },
  itseisarvo:{ min:1, max:1,  fn: a => Math.abs(a[0]) },
  abskost:   { min:2, max:2,  fn: a => absHum(a[0], a[1]) },
  kastepiste:{ min:2, max:2,  fn: a => dewPoint(a[0], a[1]) },
  suhtkost:  { min:2, max:2,  fn: a => relHum(a[0], a[1]) }
};

const HELP = [
  ["+ − * / ^ ( )", "laskutoimitukset"],
  ["min(a; b)  max(a; b)  keskiarvo(a; b)  itseisarvo(x)", "yleiset"],
  ["abskost(T; RH)", "absoluuttinen kosteus g/m³"],
  ["kastepiste(T; RH)", "kastepiste °C"],
  ["suhtkost(T; a)", "suhteellinen kosteus %"],
  ["{Päivä 2} - {Päivä 1}", "päivämäärien väli vuorokausina"]
];

/* ---------- Jäsennin (ei eval-kutsua) ---------- */
function tokenize(src){
  const out = [];
  let i = 0;
  while (i < src.length){
    const ch = src[i];
    if (/\s/.test(ch)){ i++; continue; }
    if (ch === "{"){
      const j = src.indexOf("}", i + 1);
      if (j < 0) throw new Error("Sarakeviittaukselta puuttuu loppusulku }");
      out.push({ t:"ref", v:src.slice(i + 1, j).trim() });
      i = j + 1; continue;
    }
    const num = /^\d+(?:[.,]\d+)?/.exec(src.slice(i));
    if (num){ out.push({ t:"num", v:parseFloat(num[0].replace(",", ".")) }); i += num[0].length; continue; }
    const id = /^[a-zA-ZåäöÅÄÖ_]+/.exec(src.slice(i));
    if (id){ out.push({ t:"id", v:id[0].toLowerCase() }); i += id[0].length; continue; }
    if ("+-*/^();".indexOf(ch) >= 0 || ch === "−"){ out.push({ t:"op", v: ch === "−" ? "-" : ch }); i++; continue; }
    throw new Error('Kaavassa on tuntematon merkki "' + ch + '"');
  }
  return out;
}

function parse(tokens){
  let p = 0;
  const peek = () => tokens[p];
  const take = v => { const t = tokens[p]; if (!t || (v && t.v !== v)) throw new Error(v ? 'Kaavasta puuttuu "' + v + '"' : "Kaava päättyy kesken"); p++; return t; };
  function expr(){ let n = term(); while (peek() && (peek().v === "+" || peek().v === "-") && peek().t === "op"){ const o = take().v; n = { k:"bin", o, a:n, b:term() }; } return n; }
  function term(){ let n = power(); while (peek() && peek().t === "op" && (peek().v === "*" || peek().v === "/")){ const o = take().v; n = { k:"bin", o, a:n, b:power() }; } return n; }
  function power(){ const n = unary(); if (peek() && peek().t === "op" && peek().v === "^"){ take(); return { k:"bin", o:"^", a:n, b:power() }; } return n; }
  function unary(){ if (peek() && peek().t === "op" && (peek().v === "-" || peek().v === "+")){ const o = take().v; const a = unary(); return o === "-" ? { k:"neg", a } : a; } return atom(); }
  function atom(){
    const t = peek();
    if (!t) throw new Error("Kaava päättyy kesken");
    if (t.t === "num"){ p++; return { k:"num", v:t.v }; }
    if (t.t === "ref"){ p++; return { k:"ref", v:t.v }; }
    if (t.t === "op" && t.v === "("){ p++; const n = expr(); take(")"); return n; }
    if (t.t === "id"){
      p++;
      const f = FUNCS[t.v];
      if (!f) throw new Error('Tuntematon funktio "' + t.v + '"');
      take("(");
      const args = [];
      if (!(peek() && peek().v === ")")){
        args.push(expr());
        while (peek() && peek().v === ";"){ take(";"); args.push(expr()); }
      }
      take(")");
      if (args.length < f.min || args.length > f.max){
        throw new Error("Funktiolle " + t.v + " annetaan " + (f.min === f.max ? f.min : f.min + "–" + f.max) + " arvoa (erotin ;)");
      }
      return { k:"fn", f:t.v, args };
    }
    throw new Error('Odottamaton "' + t.v + '" kaavassa');
  }
  const tree = expr();
  if (p < tokens.length) throw new Error('Ylimääräinen "' + tokens[p].v + '" kaavassa');
  return tree;
}

function refs(tree, acc){
  acc = acc || [];
  if (!tree) return acc;
  if (tree.k === "ref") acc.push(tree.v);
  if (tree.a) refs(tree.a, acc);
  if (tree.b) refs(tree.b, acc);
  if (tree.args) tree.args.forEach(x => refs(x, acc));
  return acc;
}

function evalTree(tree, get){
  switch (tree.k){
    case "num": return tree.v;
    case "ref": return get(tree.v);
    case "neg": return -evalTree(tree.a, get);
    case "bin": {
      const a = evalTree(tree.a, get), b = evalTree(tree.b, get);
      if (tree.o === "+") return a + b;
      if (tree.o === "-") return a - b;
      if (tree.o === "*") return a * b;
      if (tree.o === "/") return b === 0 ? NaN : a / b;
      return Math.pow(a, b);
    }
    case "fn": return FUNCS[tree.f].fn(tree.args.map(x => evalTree(x, get)));
  }
  return NaN;
}

/* ---------- Kaavan muunnos nimien ja tunnisteiden välillä ---------- */
function labelOf(col){ return String(col.label || "").trim(); }

/* Käyttäjän kirjoittama kaava ({Nimi}) -> tallennettava muoto ({@id}). */
function compile(text, columns, selfId){
  const src = String(text || "").trim();
  if (!src) return { ok:false, error:"Kirjoita kaava" };
  try{
    const tree = parse(tokenize(src));
    const byLabel = {};
    (columns || []).forEach(c => { const l = labelOf(c).toLowerCase(); if (l) byLabel[l] = c; });
    const deps = [];
    for (const r of refs(tree)){
      const c = r.charAt(0) === "@" ? (columns || []).find(x => x.id === r.slice(1)) : byLabel[r.toLowerCase()];
      if (!c) return { ok:false, error:'Kaavassa viitataan sarakkeeseen "' + r.replace(/^@/, "") + '", jota ei ole' };
      if (c.id === selfId) return { ok:false, error:"Sarake ei voi viitata itseensä" };
      if (c.type === "select") return { ok:false, error:'Valintalistasaraketta "' + labelOf(c) + '" ei voi käyttää kaavassa' };
      deps.push(c.id);
    }
    const formula = src.replace(/\{([^}]*)\}/g, (m, name) => {
      const n = name.trim();
      const c = n.charAt(0) === "@" ? (columns || []).find(x => x.id === n.slice(1)) : byLabel[n.toLowerCase()];
      return "{@" + c.id + "}";
    });
    return { ok:true, formula, deps };
  }catch(e){
    return { ok:false, error:e.message };
  }
}

/* Tallennettu kaava ({@id}) -> käyttäjälle näytettävä ({Nimi}). */
function toDisplay(formula, columns){
  return String(formula || "").replace(/\{@([^}]*)\}/g, (m, id) => {
    const c = (columns || []).find(x => x.id === id);
    return "{" + (c ? labelOf(c) : "?") + "}";
  });
}

function depsOf(col){
  const out = [];
  String(col.formula || "").replace(/\{@([^}]*)\}/g, (m, id) => { out.push(id); return m; });
  return out;
}

/* Kehäviittaukset (A viittaa B:hen ja B A:han). Palauttaa ongelmasarakkeen nimen tai null. */
function findCycle(columns){
  const calc = (columns || []).filter(c => c.type === "calc");
  const byId = {}; (columns || []).forEach(c => { byId[c.id] = c; });
  const state = {};
  function visit(c){
    if (state[c.id] === 1) return c;
    if (state[c.id] === 2) return null;
    state[c.id] = 1;
    for (const d of depsOf(c)){
      const dc = byId[d];
      if (dc && dc.type === "calc"){ const bad = visit(dc); if (bad) return bad; }
    }
    state[c.id] = 2;
    return null;
  }
  for (const c of calc){ const bad = visit(c); if (bad) return labelOf(bad) || "(nimetön)"; }
  return null;
}

/* ---------- Laskenta ---------- */
function cellNumber(col, raw){
  const s = String(raw === undefined || raw === null ? "" : raw).trim();
  if (!s) return NaN;
  if (col && col.type === "date"){
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000 : NaN;
  }
  const n = Number(s.replace(",", ".").replace(/\s/g, ""));
  return Number.isFinite(n) ? n : NaN;
}

const treeCache = {};
function treeFor(formula){
  if (!(formula in treeCache)){
    try{ treeCache[formula] = parse(tokenize(formula)); }catch(e){ treeCache[formula] = null; }
  }
  return treeCache[formula];
}

/* Laskee rivin kaikki lasketut sarakkeet.
   get(colId) palauttaa solun raakatekstin. Palauttaa { colId: "arvo" | "" }
   (desimaalierottimena piste, kuten numerosarakkeissa). */
function computeRow(columns, get){
  const cols = columns || [];
  const byId = {}; cols.forEach(c => { byId[c.id] = c; });
  const done = {}, out = {};
  function valueOf(id, stack){
    const c = byId[id];
    if (!c) return NaN;
    if (c.type !== "calc") return cellNumber(c, get(id));
    if (id in done) return done[id];
    if (stack.indexOf(id) >= 0) return NaN;
    const tree = treeFor(c.formula || "");
    let v = NaN;
    if (tree){
      try{ v = evalTree(tree, ref => valueOf(ref.replace(/^@/, ""), stack.concat(id))); }catch(e){ v = NaN; }
    }
    done[id] = Number.isFinite(v) ? v : NaN;
    return done[id];
  }
  cols.filter(c => c.type === "calc").forEach(c => {
    const v = valueOf(c.id, []);
    const d = Number.isInteger(c.decimals) ? c.decimals : 1;
    out[c.id] = Number.isFinite(v) ? v.toFixed(d) : "";
  });
  return out;
}

function fiNumber(v){ return String(v === undefined || v === null ? "" : v).replace(".", ","); }

window.AppFormula = { compile, toDisplay, findCycle, computeRow, fiNumber, HELP, FUNCS:Object.keys(FUNCS),
  _test:{ absHum, dewPoint, relHum } };
})();
