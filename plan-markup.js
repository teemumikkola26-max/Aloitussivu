"use strict";
/* =========================================================================
   PLAN-MARKUP.JS
   Pohjakuvan (PDF) merkintäkerros: piirto, muodot, tekstit, selitteet,
   symbolit ja selitelaatikko. Merkinnät ovat kohteen yhteinen kerros.

   Koordinaatit tallennetaan sivun NÄKYMÄkoordinaatteina mittakaavassa 1
   (pdf.js getViewport({scale:1}): x oikealle, y alaspäin, sivun kierto
   huomioituna). PDF-viennissä ne muunnetaan PDF:n omiin koordinaatteihin,
   joten merkinnät osuvat oikeaan kohtaan myös kierretyillä sivuilla.

   Rajapinta:
     PlanMarkup.open({ getPage(n)->pdf.js page, pageCount, startPage, shapes,
                       markers:[{page,x,y,label,color}], author, onSave(shapes,deletedIds) })
     PlanMarkup.svgForPage(shapes, pageNo, W, H)  -> SVG-merkkijono esikatseluun
     PlanMarkup.addToPdf(PDFLib, pdfDoc, shapes, font) -> lisää muokattavat PDF-merkinnät

   Muodon rakenne:
     { id, page, type, pts:[[x,y],...], stroke, width, dash:"solid"|"dash"|"dot",
       fill:null|"#hex", fillOpacity, opacity, text, fontSize, textColor,
       arrowStart, arrowEnd, kind, num, size, preset, author, updatedAt }
   ========================================================================= */
(typeof window !== "undefined" ? window : globalThis).PlanMarkup = (function(){

  const COLORS = ["#ED1C24","#F7931E","#FFD400","#2E9E44","#1E6FD9","#7B3FB5","#111111","#FFFFFF"];
  const WIDTHS = [0.75, 1.5, 3, 5, 8];
  const FONT_SIZES = [7, 9, 11, 14, 18, 24];

  const STAMPS = [
    { kind:"MP",  name:"Mittauspiste",       color:"#1E6FD9", form:"pill" },
    { kind:"RA",  name:"Rakenneavaus",       color:"#ED1C24", form:"rect" },
    { kind:"N",   name:"Näyte",              color:"#2E9E44", form:"rect" },
    { kind:"MAK", name:"Merkkiainekoe",      color:"#F7931E", form:"pill" },
    { kind:"VM",  name:"Viiltomittaus",      color:"#7B3FB5", form:"pill" },
    { kind:"LK",  name:"Lämpökuva",          color:"#B5179E", form:"pill" },
    { kind:"#",   name:"Numeroitu merkki",   color:"#111111", form:"pill" }
  ];
  const PRESETS = [
    { id:"kosteus",    name:"Kosteusvaurioalue",     type:"polygon", stroke:"#1E6FD9", fill:"#1E6FD9", fillOpacity:.25, dash:"dash", width:1.5 },
    { id:"mikrobi",    name:"Mikrobivaurioepäily",   type:"polygon", stroke:"#ED1C24", fill:"#ED1C24", fillOpacity:.2,  dash:"dash", width:1.5 },
    { id:"tutkimaton", name:"Tutkimaton alue",       type:"polygon", stroke:"#555555", fill:"#999999", fillOpacity:.2,  dash:"dot",  width:1.5 },
    { id:"ilmavuoto",  name:"Ilmavuoto",             type:"arrow",   stroke:"#F7931E", fill:null, fillOpacity:0, dash:"solid", width:3 },
    { id:"halkeama",   name:"Halkeama",              type:"polyline",stroke:"#111111", fill:null, fillOpacity:0, dash:"solid", width:1.5 }
  ];
  const TOOLS = [
    { id:"select",   icon:"↖",  label:"Valitse" },
    { id:"hand",     icon:"✋", label:"Siirrä näkymää" },
    { id:"pen",      icon:"✎",  label:"Kynä" },
    { id:"highlight",icon:"▬",  label:"Korostus" },
    { id:"line",     icon:"╱",  label:"Viiva" },
    { id:"arrow",    icon:"↗",  label:"Nuoli" },
    { id:"polyline", icon:"⌇",  label:"Murtoviiva" },
    { id:"rect",     icon:"▭",  label:"Suorakulmio" },
    { id:"ellipse",  icon:"◯",  label:"Ellipsi" },
    { id:"polygon",  icon:"⬠",  label:"Monikulmio" },
    { id:"cloud",    icon:"☁",  label:"Pilvi" },
    { id:"text",     icon:"T",  label:"Teksti" },
    { id:"callout",  icon:"💬", label:"Selite nuolella" },
    { id:"stamp",    icon:"⊕",  label:"Symbolit" },
    { id:"preset",   icon:"▦",  label:"Valmiit alueet" },
    { id:"legend",   icon:"☰",  label:"Selitelaatikko" }
  ];

  const FONT = 'Helvetica, Arial, sans-serif';
  const LINE_H = 1.25;

  /* ---------------- apurit ---------------- */
  const uid = () => "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const clone = o => JSON.parse(JSON.stringify(o));
  const r2 = n => Math.round(n * 100) / 100;
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  function bboxOf(pts){
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    pts.forEach(p => { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); });
    return [x0, y0, x1, y1];
  }
  function stampDef(kind){ return STAMPS.find(s => s.kind === kind) || STAMPS[STAMPS.length - 1]; }
  function presetDef(id){ return PRESETS.find(p => p.id === id) || null; }

  /* Ramer–Douglas–Peucker: kynäpiirron pisteiden karsinta */
  function simplify(pts, eps){
    if (pts.length < 3) return pts;
    const sq = (p, a, b) => {
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const l = dx * dx + dy * dy;
      let t = l ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l : 0;
      t = Math.max(0, Math.min(1, t));
      return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
    };
    let idx = 0, max = 0;
    for (let i = 1; i < pts.length - 1; i++){ const d = sq(pts[i], pts[0], pts[pts.length - 1]); if (d > max){ max = d; idx = i; } }
    if (max > eps){
      const a = simplify(pts.slice(0, idx + 1), eps), b = simplify(pts.slice(idx), eps);
      return a.slice(0, -1).concat(b);
    }
    return [pts[0], pts[pts.length - 1]];
  }

  let _mctx = null;
  function measure(text, fs){
    if (typeof document === "undefined") return String(text).length * fs * 0.52;
    if (!_mctx){ const c = document.createElement("canvas"); _mctx = c.getContext("2d"); }
    _mctx.font = fs + "px " + FONT;
    return _mctx.measureText(text).width;
  }
  /* Rivitys laatikon leveyteen; measureFn(text, fs) */
  function wrap(text, maxW, fs, measureFn){
    const out = [];
    String(text || "").split(/\r?\n/).forEach(par => {
      const words = par.split(/\s+/).filter(Boolean);
      if (!words.length){ out.push(""); return; }
      let line = "";
      words.forEach(w => {
        const t = line ? line + " " + w : w;
        if (!line || measureFn(t, fs) <= maxW) line = t;
        else { out.push(line); line = w; }
      });
      out.push(line);
    });
    return out;
  }

  /* Pilvireuna: kaaret monikulmion sivuille. Palauttaa segmentit [p, c1, c2, q]. */
  function cloudSegments(pts, w){
    const n = pts.length; if (n < 3) return [];
    let area = 0;
    for (let i = 0; i < n; i++){ const a = pts[i], b = pts[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
    const sgn = area > 0 ? 1 : -1; // y alaspäin: positiivinen = myötäpäivään ruudulla
    const r = Math.max(5, w * 4);
    const segs = [];
    for (let i = 0; i < n; i++){
      const a = pts[i], b = pts[(i + 1) % n];
      const len = dist(a, b); if (len < 0.5) continue;
      const k = Math.max(1, Math.round(len / (r * 2)));
      const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len;
      const nx = -uy * -sgn, ny = ux * -sgn; // ulospäin
      for (let j = 0; j < k; j++){
        const p = [a[0] + (b[0] - a[0]) * j / k, a[1] + (b[1] - a[1]) * j / k];
        const q = [a[0] + (b[0] - a[0]) * (j + 1) / k, a[1] + (b[1] - a[1]) * (j + 1) / k];
        const h = dist(p, q) / 2 * 4 / 3;
        segs.push([p, [p[0] + nx * h, p[1] + ny * h], [q[0] + nx * h, q[1] + ny * h], q]);
      }
    }
    return segs;
  }

  function arrowHead(tip, from, w){
    const L = Math.max(7, w * 4), H = L * 0.45;
    const d = dist(tip, from) || 1;
    const ux = (tip[0] - from[0]) / d, uy = (tip[1] - from[1]) / d;
    const bx = tip[0] - ux * L, by = tip[1] - uy * L;
    return [tip, [bx - uy * H, by + ux * H], [bx + uy * H, by - ux * H]];
  }

  function rectPts(s){ const b = bboxOf(s.pts.slice(0, 2)); return b; }

  function stampGeom(s, measureFn){
    const def = stampDef(s.kind);
    const label = (s.kind === "#" ? "" : s.kind) + (s.num != null ? s.num : "");
    const R = s.size || 9;
    const fs = R * 1.05;
    const tw = measureFn(label, fs);
    const w = Math.max(R * 2, tw + R * 1.1), h = R * 2;
    const c = s.pts[0];
    return { def, label, R, fs, x:c[0] - w / 2, y:c[1] - h / 2, w, h, tw };
  }

  function legendRows(shapes, page){
    const rows = [], seen = {};
    shapes.filter(s => s.page === page).forEach(s => {
      if (s.type === "stamp"){
        const d = stampDef(s.kind); const k = "st:" + d.kind;
        if (!seen[k]){ seen[k] = 1; rows.push({ kind:"stamp", def:d }); }
      } else if (s.preset && presetDef(s.preset)){
        const p = presetDef(s.preset); const k = "pr:" + p.id;
        if (!seen[k]){ seen[k] = 1; rows.push({ kind:"preset", def:p }); }
      }
    });
    return rows;
  }
  function legendGeom(s, shapes, measureFn){
    const fs = s.fontSize || 9, pad = fs * 0.7, rowH = fs * 1.9;
    const rows = legendRows(shapes, s.page);
    const title = "Selitteet";
    let w = measureFn(title, fs * 1.1) + pad * 2;
    rows.forEach(r => { w = Math.max(w, pad * 3 + fs * 3 + measureFn(r.def.name, fs)); });
    const h = pad * 2 + fs * 1.4 + Math.max(1, rows.length) * rowH;
    return { x:s.pts[0][0], y:s.pts[0][1], w, h, fs, pad, rowH, rows, title };
  }

  function textGeom(s){
    const b = s.type === "callout" ? bboxOf([s.pts[1], s.pts[2]]) : bboxOf([s.pts[0], s.pts[1]]);
    return { x:b[0], y:b[1], w:b[2] - b[0], h:b[3] - b[1] };
  }
  function calloutAnchor(s){
    const g = textGeom(s), tip = s.pts[0];
    const cx = g.x + g.w / 2, cy = g.y + g.h / 2;
    const dx = tip[0] - cx, dy = tip[1] - cy;
    if (!dx && !dy) return [cx, cy];
    const t = Math.min(dx ? (g.w / 2) / Math.abs(dx) : Infinity, dy ? (g.h / 2) / Math.abs(dy) : Infinity);
    return t < 1 ? [cx + dx * t, cy + dy * t] : [cx, cy];
  }

  function dashArray(s){
    const w = s.width || 1;
    if (s.dash === "dash") return [w * 4, w * 3];
    if (s.dash === "dot") return [0.01, w * 2.4];
    return null;
  }

  /* ---------------- SVG-piirto ---------------- */
  function shapeSvg(s, all, opts){
    opts = opts || {};
    const st = s.stroke || "#ED1C24", w = s.width || 1.5;
    const da = dashArray(s);
    const common = `stroke="${st}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"` +
      (da ? ` stroke-dasharray="${da.join(" ")}"` : "") + (s.opacity != null && s.opacity < 1 ? ` opacity="${s.opacity}"` : "");
    const fillAttr = s.fill ? `fill="${s.fill}" fill-opacity="${s.fillOpacity != null ? s.fillOpacity : 1}"` : `fill="none"`;
    const P = p => r2(p[0]) + "," + r2(p[1]);
    let body = "", hitD = "";
    switch (s.type){
      case "pen": case "highlight": case "polyline": {
        const d = "M" + s.pts.map(P).join(" L");
        const extra = s.type === "highlight" ? ` style="mix-blend-mode:multiply"` : "";
        body = `<path d="${d}" fill="none" ${common}${extra}/>`;
        if (s.type === "polyline"){
          if (s.arrowEnd && s.pts.length > 1) body += `<polygon points="${arrowHead(s.pts[s.pts.length - 1], s.pts[s.pts.length - 2], w).map(P).join(" ")}" fill="${st}"/>`;
          if (s.arrowStart && s.pts.length > 1) body += `<polygon points="${arrowHead(s.pts[0], s.pts[1], w).map(P).join(" ")}" fill="${st}"/>`;
        }
        hitD = d; break;
      }
      case "line": case "arrow": {
        const [a, b] = s.pts;
        body = `<line x1="${r2(a[0])}" y1="${r2(a[1])}" x2="${r2(b[0])}" y2="${r2(b[1])}" ${common}/>`;
        if (s.type === "arrow" || s.arrowEnd) body += `<polygon points="${arrowHead(b, a, w).map(P).join(" ")}" fill="${st}"/>`;
        if (s.arrowStart) body += `<polygon points="${arrowHead(a, b, w).map(P).join(" ")}" fill="${st}"/>`;
        hitD = `M${P(a)} L${P(b)}`; break;
      }
      case "rect": {
        const b = rectPts(s);
        body = `<rect x="${r2(b[0])}" y="${r2(b[1])}" width="${r2(b[2] - b[0])}" height="${r2(b[3] - b[1])}" ${fillAttr} ${common}/>`;
        hitD = `M${b[0]},${b[1]} H${b[2]} V${b[3]} H${b[0]} Z`; break;
      }
      case "ellipse": {
        const b = rectPts(s);
        body = `<ellipse cx="${r2((b[0] + b[2]) / 2)}" cy="${r2((b[1] + b[3]) / 2)}" rx="${r2((b[2] - b[0]) / 2)}" ry="${r2((b[3] - b[1]) / 2)}" ${fillAttr} ${common}/>`;
        hitD = `M${b[0]},${(b[1] + b[3]) / 2} A${(b[2] - b[0]) / 2},${(b[3] - b[1]) / 2} 0 1 0 ${b[2]},${(b[1] + b[3]) / 2} A${(b[2] - b[0]) / 2},${(b[3] - b[1]) / 2} 0 1 0 ${b[0]},${(b[1] + b[3]) / 2}`; break;
      }
      case "polygon": {
        const d = "M" + s.pts.map(P).join(" L") + " Z";
        body = `<path d="${d}" ${fillAttr} ${common}/>`; hitD = d; break;
      }
      case "cloud": {
        const segs = cloudSegments(s.pts, w);
        const d = segs.length ? "M" + P(segs[0][0]) + segs.map(g => ` C${P(g[1])} ${P(g[2])} ${P(g[3])}`).join("") + " Z" : "";
        body = `<path d="${d}" ${fillAttr} ${common}/>`; hitD = d; break;
      }
      case "text": case "callout": {
        const g = textGeom(s), fs = s.fontSize || 9, pad = fs * 0.4;
        if (s.type === "callout"){
          const an = calloutAnchor(s), tip = s.pts[0];
          body += `<line x1="${r2(an[0])}" y1="${r2(an[1])}" x2="${r2(tip[0])}" y2="${r2(tip[1])}" stroke="${st}" stroke-width="${w}"/>`;
          body += `<polygon points="${arrowHead(tip, an, w).map(P).join(" ")}" fill="${st}"/>`;
        }
        body += `<rect x="${r2(g.x)}" y="${r2(g.y)}" width="${r2(g.w)}" height="${r2(g.h)}" fill="${s.fill || "none"}" fill-opacity="${s.fill ? (s.fillOpacity != null ? s.fillOpacity : 1) : 0}" ${s.border === false ? 'stroke="none"' : common}/>`;
        const lines = wrap(s.text, Math.max(4, g.w - pad * 2), fs, measure);
        lines.forEach((ln, i) => {
          body += `<text x="${r2(g.x + pad)}" y="${r2(g.y + pad + fs * 0.85 + i * fs * LINE_H)}" font-family="${FONT}" font-size="${fs}" fill="${s.textColor || "#111111"}">${esc(ln)}</text>`;
        });
        hitD = `M${g.x},${g.y} H${g.x + g.w} V${g.y + g.h} H${g.x} Z` + (s.type === "callout" ? ` M${P(calloutAnchor(s))} L${P(s.pts[0])}` : "");
        break;
      }
      case "stamp": {
        const g = stampGeom(s, measure);
        const rx = g.def.form === "rect" ? g.R * 0.25 : g.h / 2;
        body = `<rect x="${r2(g.x)}" y="${r2(g.y)}" width="${r2(g.w)}" height="${r2(g.h)}" rx="${r2(rx)}" fill="${s.stroke || g.def.color}" stroke="#fff" stroke-width="${r2(g.R * 0.15)}"/>` +
          `<text x="${r2(s.pts[0][0])}" y="${r2(s.pts[0][1] + g.fs * 0.36)}" text-anchor="middle" font-family="${FONT}" font-weight="bold" font-size="${r2(g.fs)}" fill="#fff">${esc(g.label)}</text>`;
        hitD = `M${g.x},${g.y} H${g.x + g.w} V${g.y + g.h} H${g.x} Z`; break;
      }
      case "legend": {
        const g = legendGeom(s, all, measure);
        body = `<rect x="${r2(g.x)}" y="${r2(g.y)}" width="${r2(g.w)}" height="${r2(g.h)}" fill="#fff" stroke="#111" stroke-width="0.75"/>` +
          `<text x="${r2(g.x + g.pad)}" y="${r2(g.y + g.pad + g.fs)}" font-family="${FONT}" font-weight="bold" font-size="${r2(g.fs * 1.1)}" fill="#111">${g.title}</text>`;
        if (!g.rows.length) body += `<text x="${r2(g.x + g.pad)}" y="${r2(g.y + g.pad + g.fs * 1.4 + g.rowH * 0.65)}" font-family="${FONT}" font-size="${g.fs}" fill="#777">Lisää symboleita tai valmiita alueita</text>`;
        g.rows.forEach((r, i) => {
          const ry = g.y + g.pad + g.fs * 1.4 + i * g.rowH;
          const sx = g.x + g.pad, sw = g.fs * 3, sh = g.fs * 1.3, sy = ry + (g.rowH - sh) / 2;
          if (r.kind === "stamp"){
            body += `<rect x="${r2(sx)}" y="${r2(sy)}" width="${r2(sw)}" height="${r2(sh)}" rx="${r.def.form === "rect" ? 1 : r2(sh / 2)}" fill="${r.def.color}"/>` +
              `<text x="${r2(sx + sw / 2)}" y="${r2(sy + sh * 0.75)}" text-anchor="middle" font-family="${FONT}" font-weight="bold" font-size="${r2(g.fs * 0.85)}" fill="#fff">${esc(r.def.kind)}</text>`;
          } else if (r.def.type === "arrow" || r.def.type === "polyline"){
            const da2 = r.def.dash === "dash" ? ` stroke-dasharray="4 3"` : "";
            body += `<line x1="${r2(sx)}" y1="${r2(sy + sh / 2)}" x2="${r2(sx + sw - (r.def.type === "arrow" ? 4 : 0))}" y2="${r2(sy + sh / 2)}" stroke="${r.def.stroke}" stroke-width="${Math.min(3, r.def.width)}"${da2}/>`;
            if (r.def.type === "arrow") body += `<polygon points="${arrowHead([sx + sw, sy + sh / 2], [sx, sy + sh / 2], 1.5).map(P).join(" ")}" fill="${r.def.stroke}"/>`;
          } else {
            const da2 = r.def.dash === "dash" ? ` stroke-dasharray="3 2"` : (r.def.dash === "dot" ? ` stroke-dasharray="0.01 2" stroke-linecap="round"` : "");
            body += `<rect x="${r2(sx)}" y="${r2(sy)}" width="${r2(sw)}" height="${r2(sh)}" fill="${r.def.fill}" fill-opacity="${r.def.fillOpacity}" stroke="${r.def.stroke}" stroke-width="1"${da2}/>`;
          }
          body += `<text x="${r2(sx + sw + g.pad)}" y="${r2(ry + g.rowH / 2 + g.fs * 0.35)}" font-family="${FONT}" font-size="${g.fs}" fill="#111">${esc(r.def.name)}</text>`;
        });
        hitD = `M${g.x},${g.y} H${g.x + g.w} V${g.y + g.h} H${g.x} Z`; break;
      }
    }
    let hit = "";
    if (opts.hit){
      const hw = Math.max(w + 4, opts.hitWidth || 12);
      const fillHit = ["rect","ellipse","polygon","cloud","text","callout","stamp","legend"].indexOf(s.type) >= 0;
      hit = `<path d="${hitD}" fill="${fillHit ? "rgba(0,0,0,0.001)" : "none"}" stroke="rgba(0,0,0,0.001)" stroke-width="${hw}" pointer-events="all"/>`;
    }
    return `<g data-id="${esc(s.id)}">${body}${hit}</g>`;
  }

  function svgForPage(shapes, page, W, H){
    const list = (shapes || []).filter(s => s.page === page);
    if (!list.length) return "";
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${list.map(s => shapeSvg(s, shapes)).join("")}</svg>`;
  }

  /* ---------------- valintakehys ja kahvat ---------------- */
  function handlesFor(s){
    switch (s.type){
      case "line": case "arrow": case "polyline": case "polygon": case "cloud":
        return s.pts.map((p, i) => ({ i, p }));
      case "rect": case "ellipse": case "text": {
        const b = bboxOf([s.pts[0], s.pts[1]]);
        return [{ c:"nw", p:[b[0], b[1]] }, { c:"ne", p:[b[2], b[1]] }, { c:"se", p:[b[2], b[3]] }, { c:"sw", p:[b[0], b[3]] }];
      }
      case "callout": {
        const b = bboxOf([s.pts[1], s.pts[2]]);
        return [{ i:0, p:s.pts[0] }, { c:"nw", p:[b[0], b[1]] }, { c:"se", p:[b[2], b[3]] }];
      }
      default: return [];
    }
  }
  function shapeBBox(s, all){
    if (s.type === "stamp"){ const g = stampGeom(s, measure); return [g.x, g.y, g.x + g.w, g.y + g.h]; }
    if (s.type === "legend"){ const g = legendGeom(s, all, measure); return [g.x, g.y, g.x + g.w, g.y + g.h]; }
    if (s.type === "text" || s.type === "callout"){ const g = textGeom(s); const b = [g.x, g.y, g.x + g.w, g.y + g.h]; if (s.type === "callout") return bboxOf([[b[0], b[1]], [b[2], b[3]], s.pts[0]]); return b; }
    return bboxOf(s.pts);
  }

  /* =====================================================================
     EDITORI
     ===================================================================== */
  const CSS = `
.pm-ov{position:fixed;inset:0;z-index:400;background:#2b2b28;display:flex;flex-direction:column;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#1c2430;-webkit-user-select:none;user-select:none}
.pm-top{display:flex;align-items:center;gap:6px;background:#fff;border-bottom:4px solid #ED1C24;padding:4px 6px;min-height:52px}
.pm-top .pm-title{flex:1;min-width:0;font-weight:700;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pm-b{min-width:44px;min-height:44px;border:1.5px solid #dcd7cb;background:#fff;border-radius:10px;font:inherit;font-size:16px;cursor:pointer;padding:0 10px;color:#1c2430;display:inline-flex;align-items:center;justify-content:center;gap:4px}
.pm-b:disabled{opacity:.35}
.pm-b.pm-primary{background:#C8102E;border-color:#C8102E;color:#fff;font-weight:700}
.pm-b[aria-pressed=true]{background:#262626;border-color:#262626;color:#fff}
.pm-pagebar{display:flex;align-items:center;justify-content:center;gap:12px;background:#1f1f1c;color:#fff;padding:4px;font-size:13px}
.pm-pagebar .pm-b{background:#333;color:#fff;border-color:#555;min-height:36px}
.pm-stage{flex:1;min-height:0;overflow:hidden;position:relative;touch-action:none;background:#3a3a36}
.pm-inner{position:absolute;left:0;top:0;transform-origin:0 0;box-shadow:0 2px 10px rgba(0,0,0,.5);background:#fff}
.pm-inner canvas{position:absolute;left:0;top:0;width:100%;height:100%}
.pm-inner svg{position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible}
.pm-zoom{position:absolute;right:8px;top:8px;display:flex;flex-direction:column;gap:6px;z-index:2}
.pm-zoom .pm-b{background:rgba(255,255,255,.95)}
.pm-finish{position:absolute;left:50%;bottom:10px;transform:translateX(-50%);z-index:2;display:none;gap:8px}
.pm-finish.show{display:flex}
.pm-bottom{background:#fff;border-top:1px solid #dcd7cb;padding:6px 6px calc(6px + env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:6px}
.pm-row{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;align-items:center;-webkit-overflow-scrolling:touch}
.pm-row::-webkit-scrollbar{display:none}
.pm-tool{flex:0 0 auto;min-width:52px;min-height:48px;border:1.5px solid #dcd7cb;background:#fff;border-radius:10px;font:inherit;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:2px 6px;color:#1c2430}
.pm-tool .i{font-size:18px;line-height:1.1}
.pm-tool .l{font-size:10.5px;color:#4a5568;white-space:nowrap}
.pm-tool[aria-pressed=true]{border-color:#C8102E;background:#fdf1f1}
.pm-sw{flex:0 0 32px;width:32px;height:32px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 0 1px #b9b2a0;cursor:pointer;padding:0}
.pm-sw[aria-pressed=true]{box-shadow:0 0 0 2px #fff,0 0 0 4px #262626}
.pm-sw.none{background:linear-gradient(45deg,#fff 45%,#ED1C24 45%,#ED1C24 55%,#fff 55%)}
.pm-sep{flex:0 0 1px;align-self:stretch;background:#dcd7cb;margin:0 2px}
.pm-lbl{flex:0 0 auto;font-size:12px;color:#4a5568;font-weight:700}
.pm-sel{flex:0 0 auto;min-height:40px;border:1.5px solid #dcd7cb;border-radius:10px;background:#fff;font:inherit;font-size:14px;padding:0 6px}
.pm-hint{font-size:12.5px;color:#4a5568;padding:0 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pm-modal{position:fixed;inset:0;z-index:500;background:rgba(20,24,30,.45);display:flex;align-items:center;justify-content:center;padding:16px}
.pm-modal .box{background:#fff;border-radius:16px;padding:16px;width:min(100%,420px)}
.pm-modal h3{margin:0 0 8px;font-size:17px}
.pm-modal textarea{width:100%;min-height:110px;font:inherit;font-size:16px;border:1.5px solid #b9b2a0;border-radius:10px;padding:10px;box-sizing:border-box;-webkit-user-select:text;user-select:text}
.pm-modal .acts{display:flex;gap:8px;margin-top:10px}
.pm-modal .acts .pm-b{flex:1}
`;
  let cssDone = false;
  function injectCss(){ if (cssDone) return; cssDone = true; const s = document.createElement("style"); s.textContent = CSS; document.head.appendChild(s); }

  function textDialog(title, value){
    return new Promise(resolve => {
      const m = document.createElement("div");
      m.className = "pm-modal";
      m.innerHTML = `<div class="box" role="dialog" aria-modal="true"><h3>${esc(title)}</h3><textarea></textarea>` +
        `<div class="acts"><button type="button" class="pm-b" data-a="c">Peruuta</button><button type="button" class="pm-b pm-primary" data-a="ok">OK</button></div></div>`;
      document.body.appendChild(m);
      const ta = m.querySelector("textarea"); ta.value = value || "";
      setTimeout(() => ta.focus(), 50);
      m.querySelector('[data-a="c"]').onclick = () => { m.remove(); resolve(null); };
      m.querySelector('[data-a="ok"]').onclick = () => { m.remove(); resolve(ta.value); };
    });
  }

  async function open(o){
    injectCss();
    const author = o.author || "";
    let shapes = clone(o.shapes || []);
    const deleted = [];
    const markers = o.markers || [];
    let page = Math.max(1, Math.min(o.pageCount || 1, o.startPage || 1));
    let tool = "select";
    let selId = null;
    let dirty = false;
    const undo = [], redo = [];
    const props = { stroke:"#ED1C24", width:1.5, dash:"solid", fill:null, fillOpacity:0.25, opacity:1, fontSize:9, textColor:"#111111" };
    let stampKind = "MP", presetId = "kosteus";

    const ov = document.createElement("div");
    ov.className = "pm-ov";
    ov.innerHTML = `
      <div class="pm-top">
        <button type="button" class="pm-b" data-a="close" aria-label="Sulje">✕</button>
        <div class="pm-title">Pohjakuvan merkinnät</div>
        <button type="button" class="pm-b" data-a="undo" aria-label="Kumoa">↶</button>
        <button type="button" class="pm-b" data-a="redo" aria-label="Tee uudelleen">↷</button>
        <button type="button" class="pm-b pm-primary" data-a="save">Valmis</button>
      </div>
      <div class="pm-pagebar" style="display:none"><button type="button" class="pm-b" data-a="prev" aria-label="Edellinen sivu">‹</button><span data-r="pg"></span><button type="button" class="pm-b" data-a="next" aria-label="Seuraava sivu">›</button></div>
      <div class="pm-stage">
        <div class="pm-inner"><canvas></canvas><svg xmlns="http://www.w3.org/2000/svg"></svg></div>
        <div class="pm-zoom"><button type="button" class="pm-b" data-a="zin" aria-label="Suurenna">＋</button><button type="button" class="pm-b" data-a="zout" aria-label="Pienennä">－</button><button type="button" class="pm-b" data-a="fit" aria-label="Koko sivu">⤢</button></div>
        <div class="pm-finish"><button type="button" class="pm-b pm-primary" data-a="finish">✓ Valmis muoto</button><button type="button" class="pm-b" data-a="cancelshape">Peru</button></div>
      </div>
      <div class="pm-bottom">
        <div class="pm-row" data-r="ctx"></div>
        <div class="pm-row" data-r="props"></div>
        <div class="pm-row" data-r="tools"></div>
      </div>`;
    document.body.appendChild(ov);
    const $ = s => ov.querySelector(s);
    const stage = $(".pm-stage"), inner = $(".pm-inner"), canvas = $("canvas"), svg = $("svg");
    const pdfPageCount = o.pageCount || 1;
    if (pdfPageCount > 1) $(".pm-pagebar").style.display = "flex";

    let W = 595, H = 842, fit = 1, zoom = 1, renderTask = null, renderSeq = 0;

    /* ---------- sivun piirto ---------- */
    async function loadPage(){
      const pg = await o.getPage(page);
      const vp = pg.getViewport({ scale:1 });
      W = vp.width; H = vp.height;
      svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
      $('[data-r="pg"]').textContent = "Sivu " + page + " / " + pdfPageCount;
      $('[data-a="prev"]').disabled = page <= 1;
      $('[data-a="next"]').disabled = page >= pdfPageCount;
      fitView();
      await renderCanvas(pg);
      draw();
    }
    function fitView(){
      const sw = stage.clientWidth, sh = stage.clientHeight;
      fit = Math.min((sw - 16) / W, (sh - 16) / H);
      zoom = 1;
      layout(true);
    }
    let offX = 0, offY = 0;
    function layout(center){
      const cw = W * fit * zoom, ch = H * fit * zoom;
      inner.style.width = cw + "px"; inner.style.height = ch + "px";
      const sw = stage.clientWidth, sh = stage.clientHeight;
      if (center){ offX = (sw - cw) / 2; offY = (sh - ch) / 2; }
      clampOff();
      inner.style.transform = `translate(${offX}px,${offY}px)`;
    }
    function clampOff(){
      const cw = W * fit * zoom, ch = H * fit * zoom, sw = stage.clientWidth, sh = stage.clientHeight, m = 60;
      if (cw <= sw) offX = (sw - cw) / 2;
      else offX = Math.min(m, Math.max(sw - cw - m, offX));
      if (ch <= sh) offY = (sh - ch) / 2;
      else offY = Math.min(m, Math.max(sh - ch - m, offY));
    }
    let pageObj = null;
    async function renderCanvas(pg){
      if (pg) pageObj = pg;
      if (!pageObj) return;
      const seq = ++renderSeq;
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      let scale = fit * zoom * dpr;
      const maxPx = 16e6;
      if (W * H * scale * scale > maxPx) scale = Math.sqrt(maxPx / (W * H));
      const vp = pageObj.getViewport({ scale });
      const c = document.createElement("canvas");
      c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
      try{
        if (renderTask && renderTask.cancel) renderTask.cancel();
        renderTask = pageObj.render({ canvasContext:c.getContext("2d"), viewport:vp });
        await renderTask.promise;
      }catch(e){ if (seq === renderSeq) console.warn("Pohjakuvan piirto", e); return; }
      if (seq !== renderSeq) return;
      canvas.width = c.width; canvas.height = c.height;
      canvas.getContext("2d").drawImage(c, 0, 0);
    }
    let rerenderTimer = null;
    function scheduleRender(){ clearTimeout(rerenderTimer); rerenderTimer = setTimeout(() => renderCanvas(), 180); }

    function setZoom(nz, cx, cy){
      nz = Math.max(1, Math.min(12, nz));
      if (cx == null){ cx = stage.clientWidth / 2; cy = stage.clientHeight / 2; }
      const px = (cx - offX) / (fit * zoom), py = (cy - offY) / (fit * zoom);
      zoom = nz;
      offX = cx - px * fit * zoom; offY = cy - py * fit * zoom;
      layout(false);
      draw();
      scheduleRender();
    }

    /* ---------- piirto ---------- */
    function pageShapes(){ return shapes.filter(s => s.page === page); }
    function sel(){ return shapes.find(s => s.id === selId) || null; }
    function draw(preview){
      const hw = 14 / (fit * zoom);
      let out = "";
      markers.filter(m => (m.page || 1) === page).forEach(m => {
        const x = m.x * W, y = m.y * H, r = 6 / Math.max(1, zoom * fit) * 1.5 + 4;
        out += `<g opacity="0.55" pointer-events="none"><circle cx="${x}" cy="${y}" r="${r}" fill="#fff" stroke="${m.color || "#e85908"}" stroke-width="2"/>` +
          `<text x="${x}" y="${y + r * 0.4}" text-anchor="middle" font-size="${r * 1.1}" font-family="${FONT}" font-weight="bold" fill="#333">${esc(m.label || "")}</text></g>`;
      });
      out += pageShapes().map(s => shapeSvg(s, shapes, { hit:true, hitWidth:hw })).join("");
      if (preview) out += `<g pointer-events="none" opacity="0.85">${shapeSvg(preview, shapes)}</g>`;
      const s = sel();
      if (s && s.page === page){
        const b = shapeBBox(s, shapes), m = 4 / (fit * zoom);
        out += `<rect x="${b[0] - m}" y="${b[1] - m}" width="${b[2] - b[0] + 2 * m}" height="${b[3] - b[1] + 2 * m}" fill="none" stroke="#1d4ed8" stroke-width="${1.5 / (fit * zoom)}" stroke-dasharray="${4 / (fit * zoom)} ${3 / (fit * zoom)}" pointer-events="none"/>`;
        const hr = 9 / (fit * zoom);
        handlesFor(s).forEach((h, k) => {
          out += `<circle data-h="${k}" cx="${h.p[0]}" cy="${h.p[1]}" r="${hr}" fill="#fff" stroke="#1d4ed8" stroke-width="${2 / (fit * zoom)}"/>`;
        });
      }
      if (polyDraft){
        const pts = polyDraft.pts.concat(polyDraft.cursor ? [polyDraft.cursor] : []);
        out += `<g pointer-events="none">${shapeSvg(Object.assign({}, polyDraft.shape, { pts, type: pts.length > 2 && polyDraft.shape.type !== "polyline" ? polyDraft.shape.type : "polyline" }), shapes)}</g>`;
        const r0 = 7 / (fit * zoom);
        out += `<circle cx="${polyDraft.pts[0][0]}" cy="${polyDraft.pts[0][1]}" r="${r0}" fill="#fff" stroke="#C8102E" stroke-width="${2 / (fit * zoom)}" pointer-events="none"/>`;
      }
      svg.innerHTML = out;
      updateButtons();
    }

    /* ---------- historia ---------- */
    function snapshot(){ undo.push(JSON.stringify(shapes)); if (undo.length > 80) undo.shift(); redo.length = 0; dirty = true; }
    function doUndo(){ if (!undo.length) return; redo.push(JSON.stringify(shapes)); shapes = JSON.parse(undo.pop()); selId = null; dirty = true; draw(); renderCtx(); }
    function doRedo(){ if (!redo.length) return; undo.push(JSON.stringify(shapes)); shapes = JSON.parse(redo.pop()); selId = null; dirty = true; draw(); renderCtx(); }
    function touch(s){ s.updatedAt = new Date().toISOString(); s.author = author || s.author || ""; }

    function newShape(type, pts, extra){
      const s = Object.assign({
        id:uid(), page, type, pts,
        stroke:props.stroke, width:props.width, dash:props.dash,
        fill:props.fill, fillOpacity:props.fillOpacity, opacity:props.opacity
      }, extra || {});
      if (type === "highlight"){ s.opacity = 0.35; s.width = Math.max(8, props.width * 4); s.stroke = props.stroke === "#ED1C24" ? "#FFD400" : props.stroke; s.dash = "solid"; s.fill = null; }
      if (type === "pen" || type === "line" || type === "arrow" || type === "polyline"){ s.fill = null; }
      if (type === "text" || type === "callout"){ s.fontSize = props.fontSize; s.textColor = props.textColor; if (!s.fill) s.fill = "#FFFFFF"; s.fillOpacity = 1; }
      touch(s);
      return s;
    }

    /* ---------- työkalurivit ---------- */
    function renderTools(){
      const row = $('[data-r="tools"]');
      row.innerHTML = TOOLS.map(t => `<button type="button" class="pm-tool" data-t="${t.id}" aria-pressed="${t.id === tool}" title="${esc(t.label)}"><span class="i">${t.icon}</span><span class="l">${esc(t.label)}</span></button>`).join("");
      row.querySelectorAll("[data-t]").forEach(b => b.onclick = () => chooseTool(b.dataset.t));
    }
    function chooseTool(t){
      if (polyDraft) finishPoly(false);
      if (t === "stamp"){ pickStamp(); return; }
      if (t === "preset"){ pickPreset(); return; }
      tool = t;
      if (t !== "select") selId = null;
      renderTools(); renderCtx(); draw();
    }
    function pickStamp(){
      window.AppUI.sheet("Symboli pohjakuvaan", STAMPS.map(s => ({
        label:s.name + (s.kind !== "#" ? " (" + s.kind + ")" : ""), icon:"●",
        onSelect:() => { stampKind = s.kind; tool = "stamp"; selId = null; renderTools(); renderCtx(); draw(); }
      })));
    }
    function pickPreset(){
      window.AppUI.sheet("Valmis alue tai merkintä", PRESETS.map(p => ({
        label:p.name, icon:p.type === "arrow" ? "↗" : (p.type === "polyline" ? "⌇" : "▦"),
        onSelect:() => { presetId = p.id; tool = "preset"; selId = null; renderTools(); renderCtx(); draw(); }
      })));
    }
    function hintText(){
      const s = sel();
      switch (tool){
        case "select": return s ? "Vedä siirtääksesi, kahvoista muotoile." : "Napauta merkintää valitaksesi. Vedä tyhjästä siirtääksesi näkymää.";
        case "hand": return "Vedä siirtääksesi näkymää, nipistä zoomataksesi.";
        case "pen": case "highlight": return "Piirrä sormella tai kynällä.";
        case "line": case "arrow": case "rect": case "ellipse": case "cloud": return "Vedä alkupisteestä loppupisteeseen.";
        case "polyline": case "polygon": return "Napauta pisteet. Lopeta \"Valmis muoto\" -painikkeella" + (tool === "polygon" ? " tai napauttamalla ensimmäistä pistettä." : ".");
        case "text": return "Vedä tekstilaatikko tai napauta paikka.";
        case "callout": return "Napauta ensin kohta, johon nuoli osoittaa, sitten tekstilaatikon paikka.";
        case "stamp": return "Napauta paikka: " + stampDef(stampKind).name + ". Numero kasvaa automaattisesti.";
        case "preset": { const p = presetDef(presetId); return p ? p.name + ": " + (p.type === "polygon" ? "napauta alueen kulmapisteet." : (p.type === "arrow" ? "vedä nuoli." : "napauta pisteet.")) : ""; }
        case "legend": return "Napauta selitelaatikon paikka. Se listaa käytetyt symbolit ja alueet.";
      }
      return "";
    }
    function renderCtx(){
      const row = $('[data-r="ctx"]');
      const s = sel();
      let h = "";
      if (s){
        if (s.type === "text" || s.type === "callout") h += `<button type="button" class="pm-b" data-c="edit">✏ Teksti</button>`;
        if (s.type === "stamp") h += `<button type="button" class="pm-b" data-c="num">№ Numero</button>`;
        if (s.type === "line" || s.type === "arrow" || s.type === "polyline") h += `<button type="button" class="pm-b" data-c="aend" aria-pressed="${!!(s.arrowEnd || s.type === "arrow")}">→ Nuoli</button><button type="button" class="pm-b" data-c="astart" aria-pressed="${!!s.arrowStart}">← Nuoli</button>`;
        h += `<button type="button" class="pm-b" data-c="dup">⧉ Monista</button><button type="button" class="pm-b" data-c="front">⇡ Päälle</button><button type="button" class="pm-b" data-c="del" style="color:#C8102E">🗑 Poista</button>`;
      } else {
        h = `<span class="pm-hint">${esc(hintText())}</span>`;
      }
      row.innerHTML = h;
      row.querySelectorAll("[data-c]").forEach(b => b.onclick = () => ctxAction(b.dataset.c));
      renderProps();
    }
    async function ctxAction(c){
      const s = sel(); if (!s) return;
      if (c === "del"){ snapshot(); shapes = shapes.filter(x => x !== s); deleted.push(s.id); selId = null; }
      else if (c === "dup"){ snapshot(); const d = clone(s); d.id = uid(); d.pts = d.pts.map(p => [p[0] + 12, p[1] + 12]); if (d.type === "stamp") d.num = nextNum(d.kind); touch(d); shapes.push(d); selId = d.id; }
      else if (c === "front"){ snapshot(); shapes = shapes.filter(x => x !== s).concat([s]); touch(s); }
      else if (c === "edit"){ const t = await textDialog("Teksti", s.text); if (t !== null){ snapshot(); s.text = t; fitTextBox(s); touch(s); } }
      else if (c === "num"){ const t = await textDialog("Symbolin numero", s.num != null ? String(s.num) : ""); if (t !== null){ snapshot(); s.num = t.trim(); touch(s); } }
      else if (c === "aend"){ snapshot(); if (s.type === "arrow"){ s.type = "line"; s.arrowEnd = false; } else s.arrowEnd = !s.arrowEnd; touch(s); }
      else if (c === "astart"){ snapshot(); s.arrowStart = !s.arrowStart; touch(s); }
      draw(); renderCtx();
    }
    function renderProps(){
      const row = $('[data-r="props"]');
      const s = sel();
      const cur = s ? {
        stroke:s.stroke, width:s.width, dash:s.dash, fill:s.fill, fillOpacity:s.fillOpacity, opacity:s.opacity != null ? s.opacity : 1, fontSize:s.fontSize, textColor:s.textColor
      } : props;
      const kind = s ? s.type : tool;
      const hasFill = ["rect","ellipse","polygon","cloud","text","callout","select"].indexOf(kind) >= 0;
      const hasText = kind === "text" || kind === "callout";
      const noStyle = kind === "legend" || kind === "hand" || (kind === "select" && !s);
      if (noStyle){ row.innerHTML = ""; row.style.display = "none"; return; }
      row.style.display = "";
      let h = `<span class="pm-lbl">${kind === "stamp" ? "Väri" : "Viiva"}</span>` + COLORS.map(c => `<button type="button" class="pm-sw" data-p="stroke" data-v="${c}" aria-label="Väri ${c}" style="background:${c}" aria-pressed="${(cur.stroke || "").toUpperCase() === c}"></button>`).join("");
      h += `<input type="color" class="pm-sel" data-p="strokeCustom" value="${/^#[0-9a-f]{6}$/i.test(cur.stroke || "") ? cur.stroke : "#ed1c24"}" aria-label="Oma väri" style="width:44px;padding:2px">`;
      if (kind !== "stamp"){
        h += `<span class="pm-sep"></span><select class="pm-sel" data-p="width" aria-label="Viivan paksuus">${WIDTHS.map(w => `<option value="${w}" ${Number(cur.width) === w ? "selected" : ""}>${String(w).replace(".", ",")} pt</option>`).join("")}</select>`;
        h += `<select class="pm-sel" data-p="dash" aria-label="Viivatyyli"><option value="solid" ${cur.dash === "solid" ? "selected" : ""}>━ Yhtenäinen</option><option value="dash" ${cur.dash === "dash" ? "selected" : ""}>╍ Katko</option><option value="dot" ${cur.dash === "dot" ? "selected" : ""}>┈ Piste</option></select>`;
        h += `<select class="pm-sel" data-p="opacity" aria-label="Läpinäkyvyys">${[1, .75, .5, .3].map(v => `<option value="${v}" ${Math.abs((cur.opacity || 1) - v) < .01 ? "selected" : ""}>${Math.round(v * 100)} %</option>`).join("")}</select>`;
      }
      if (hasFill && kind !== "select"){
        h += `<span class="pm-sep"></span><span class="pm-lbl">Täyttö</span><button type="button" class="pm-sw none" data-p="fill" data-v="" aria-label="Ei täyttöä" aria-pressed="${!cur.fill}"></button>` +
          COLORS.map(c => `<button type="button" class="pm-sw" data-p="fill" data-v="${c}" aria-label="Täyttö ${c}" style="background:${c}" aria-pressed="${(cur.fill || "").toUpperCase() === c}"></button>`).join("");
        if (!hasText) h += `<select class="pm-sel" data-p="fillOpacity" aria-label="Täytön peittävyys">${[1, .5, .25, .1].map(v => `<option value="${v}" ${Math.abs((cur.fillOpacity != null ? cur.fillOpacity : .25) - v) < .01 ? "selected" : ""}>${Math.round(v * 100)} %</option>`).join("")}</select>`;
      }
      if (hasText){
        h += `<span class="pm-sep"></span><select class="pm-sel" data-p="fontSize" aria-label="Tekstin koko">${FONT_SIZES.map(v => `<option value="${v}" ${Number(cur.fontSize || 9) === v ? "selected" : ""}>${v} pt</option>`).join("")}</select>`;
        h += `<span class="pm-lbl">Teksti</span>` + ["#111111", "#ED1C24", "#1E6FD9", "#2E9E44"].map(c => `<button type="button" class="pm-sw" data-p="textColor" data-v="${c}" style="background:${c}" aria-label="Tekstin väri ${c}" aria-pressed="${(cur.textColor || "#111111").toUpperCase() === c}"></button>`).join("");
      }
      row.innerHTML = h;
      const apply = (p, v) => {
        if (p === "strokeCustom") p = "stroke";
        if (["width", "opacity", "fillOpacity", "fontSize"].indexOf(p) >= 0) v = Number(v);
        if (p === "fill" && !v) v = null;
        if (s){ snapshot(); s[p] = v; if (s.type === "text" || s.type === "callout") fitTextBox(s); touch(s); }
        else props[p] = v;
        draw(); renderProps();
      };
      row.querySelectorAll("button[data-p]").forEach(b => b.onclick = () => apply(b.dataset.p, b.dataset.v));
      row.querySelectorAll("select[data-p],input[data-p]").forEach(i => i.onchange = () => apply(i.dataset.p, i.value));
    }
    function updateButtons(){
      $('[data-a="undo"]').disabled = !undo.length;
      $('[data-a="redo"]').disabled = !redo.length;
      $(".pm-finish").classList.toggle("show", !!polyDraft);
    }

    /* Tekstilaatikko kasvaa alaspäin, jos teksti ei mahdu. */
    function fitTextBox(s){
      const g = textGeom(s), fs = s.fontSize || 9, pad = fs * 0.4;
      const lines = wrap(s.text, Math.max(4, g.w - pad * 2), fs, measure);
      const need = lines.length * fs * LINE_H + pad * 2;
      const i0 = s.type === "callout" ? 1 : 0;
      s.pts[i0] = [g.x, g.y];
      s.pts[i0 + 1] = [g.x + g.w, g.y + Math.max(g.h, need)];
    }
    function nextNum(kind){
      let n = 0;
      shapes.forEach(s => { if (s.type === "stamp" && s.kind === kind){ const v = parseInt(s.num, 10); if (isFinite(v)) n = Math.max(n, v); } });
      return n + 1;
    }

    /* ---------- osoittimet ---------- */
    function toPage(ev){
      const r = inner.getBoundingClientRect();
      return [(ev.clientX - r.left) / (fit * zoom), (ev.clientY - r.top) / (fit * zoom)];
    }
    const pointers = new Map();
    let gesture = null;   // {type:"pan"|"pinch"|"draw"|"move"|"handle"}
    let polyDraft = null; // {shape, pts, cursor}
    let calloutTip = null;
    let tapInfo = null;

    stage.addEventListener("pointerdown", ev => {
      if (ev.target.closest(".pm-zoom,.pm-finish")) return;
      stage.setPointerCapture(ev.pointerId);
      pointers.set(ev.pointerId, [ev.clientX, ev.clientY]);
      if (pointers.size === 2){
        // nipistys: keskeytetään mahdollinen piirto
        if (gesture && gesture.type === "draw" && gesture.shape){ gesture = null; draw(); }
        const [a, b] = [...pointers.values()];
        gesture = { type:"pinch", d0:Math.hypot(a[0] - b[0], a[1] - b[1]), z0:zoom, mid:[(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], off0:[offX, offY] };
        return;
      }
      if (pointers.size > 2) return;
      const p = toPage(ev);
      const sr = stage.getBoundingClientRect();
      tapInfo = { x:ev.clientX, y:ev.clientY, t:Date.now() };
      const isPen = ev.pointerType === "pen";

      if (tool === "hand"){ gesture = { type:"pan", sx:ev.clientX, sy:ev.clientY, ox:offX, oy:offY }; return; }

      if (tool === "select"){
        const hEl = ev.target.closest("[data-h]");
        const s = sel();
        if (hEl && s){ snapshot(); gesture = { type:"handle", k:+hEl.dataset.h, s, start:p, orig:clone(s.pts) }; return; }
        const g = ev.target.closest("[data-id]");
        if (g){
          const id = g.getAttribute("data-id");
          if (id !== selId){ selId = id; renderCtx(); draw(); }
          const s2 = sel(); snapshot();
          gesture = { type:"move", s:s2, start:p, orig:clone(s2.pts), moved:false };
          return;
        }
        if (selId){ selId = null; renderCtx(); draw(); }
        gesture = { type:"pan", sx:ev.clientX, sy:ev.clientY, ox:offX, oy:offY };
        return;
      }
      if (tool === "pen" || tool === "highlight"){
        gesture = { type:"draw", shape:newShape(tool, [p]) };
        draw(gesture.shape); return;
      }
      if (["line","arrow","rect","ellipse","cloud","text"].indexOf(tool) >= 0 || (tool === "preset" && presetDef(presetId) && presetDef(presetId).type === "arrow")){
        const t = tool === "preset" ? "arrow" : tool;
        const extra = tool === "preset" ? presetExtra() : {};
        gesture = { type:"draw", shape:newShape(t, [p, p.slice()], extra), drag:true };
        return;
      }
      if (tool === "polyline" || tool === "polygon" || (tool === "preset")){
        gesture = { type:"tap" }; return;
      }
      if (tool === "callout" || tool === "stamp" || tool === "legend"){ gesture = { type:"tap" }; return; }
    });

    function presetExtra(){
      const pr = presetDef(presetId);
      return { stroke:pr.stroke, width:pr.width, dash:pr.dash, fill:pr.fill, fillOpacity:pr.fillOpacity, opacity:1, preset:pr.id };
    }

    stage.addEventListener("pointermove", ev => {
      if (!pointers.has(ev.pointerId)){
        if (polyDraft){ polyDraft.cursor = toPage(ev); draw(); }
        return;
      }
      pointers.set(ev.pointerId, [ev.clientX, ev.clientY]);
      if (!gesture) return;
      if (gesture.type === "pinch" && pointers.size >= 2){
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const sr = stage.getBoundingClientRect();
        const nz = Math.max(1, Math.min(12, gesture.z0 * d / gesture.d0));
        const cx = gesture.mid[0] - sr.left, cy = gesture.mid[1] - sr.top;
        const px = (cx - gesture.off0[0]) / (fit * gesture.z0), py = (cy - gesture.off0[1]) / (fit * gesture.z0);
        zoom = nz;
        offX = cx - px * fit * zoom + (mid[0] - gesture.mid[0]);
        offY = cy - py * fit * zoom + (mid[1] - gesture.mid[1]);
        layout(false); draw(); scheduleRender();
        return;
      }
      if (gesture.type === "pan"){
        offX = gesture.ox + (ev.clientX - gesture.sx); offY = gesture.oy + (ev.clientY - gesture.sy);
        layout(false); return;
      }
      const p = toPage(ev);
      if (gesture.type === "draw"){
        const s = gesture.shape;
        if (gesture.drag){
          s.pts[1] = p;
          if (s.type === "cloud"){ /* pilvi piirretään suorakulmiona */ }
        } else {
          const last = s.pts[s.pts.length - 1];
          if (dist(last, p) > 1.2 / (fit * zoom)) s.pts.push(p);
        }
        draw(s.type === "cloud" ? Object.assign({}, s, { pts:cloudRect(s.pts) }) : s);
        return;
      }
      if (gesture.type === "move"){
        const dx = p[0] - gesture.start[0], dy = p[1] - gesture.start[1];
        if (Math.abs(dx) + Math.abs(dy) > 0.5) gesture.moved = true;
        gesture.s.pts = gesture.orig.map(q => [q[0] + dx, q[1] + dy]);
        draw(); return;
      }
      if (gesture.type === "handle"){
        const s = gesture.s, h = handlesFor(Object.assign({}, s, { pts:gesture.orig }))[gesture.k];
        const pts = clone(gesture.orig);
        if (h.i != null){ pts[h.i] = p; }
        else {
          const i0 = s.type === "callout" ? 1 : 0;
          const b = bboxOf([pts[i0], pts[i0 + 1]]);
          let [x0, y0, x1, y1] = b;
          if (h.c.indexOf("n") >= 0) y0 = p[1]; if (h.c.indexOf("s") >= 0) y1 = p[1];
          if (h.c.indexOf("w") >= 0) x0 = p[0]; if (h.c.indexOf("e") >= 0) x1 = p[0];
          pts[i0] = [Math.min(x0, x1), Math.min(y0, y1)]; pts[i0 + 1] = [Math.max(x0, x1), Math.max(y0, y1)];
        }
        s.pts = pts; draw(); return;
      }
    });

    function cloudRect(pts){
      const b = bboxOf(pts);
      return [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]];
    }

    async function endPointer(ev){
      if (!pointers.has(ev.pointerId)) return;
      pointers.delete(ev.pointerId);
      if (gesture && gesture.type === "pinch"){
        if (pointers.size === 0) gesture = null;
        else { // yksi sormi jäi: jatketaan panoroimalla
          const [a] = [...pointers.values()];
          gesture = { type:"pan", sx:a[0], sy:a[1], ox:offX, oy:offY };
        }
        return;
      }
      const g = gesture; gesture = null;
      if (!g) return;
      const p = toPage(ev);
      const isTap = tapInfo && Math.hypot(ev.clientX - tapInfo.x, ev.clientY - tapInfo.y) < 8 && Date.now() - tapInfo.t < 600;

      if (g.type === "move"){
        if (!g.moved){ undo.pop(); } else touch(g.s);
        renderCtx(); draw(); return;
      }
      if (g.type === "handle"){ touch(g.s); if (g.s.type === "text" || g.s.type === "callout") fitTextBox(g.s); draw(); return; }
      if (g.type === "draw"){
        const s = g.shape;
        if (s.type === "pen" || s.type === "highlight"){
          if (s.pts.length < 2) s.pts.push([s.pts[0][0] + 0.5, s.pts[0][1] + 0.5]);
          s.pts = simplify(s.pts, 0.6 / Math.max(1, zoom * fit / 2)).map(q => [r2(q[0]), r2(q[1])]);
          snapshot(); shapes.push(s); draw(); return;
        }
        if (s.type === "text"){
          if (dist(s.pts[0], s.pts[1]) < 6){ s.pts[1] = [s.pts[0][0] + 140, s.pts[0][1] + 24]; }
          const b = bboxOf(s.pts); s.pts = [[b[0], b[1]], [b[2], b[3]]];
          const t = await textDialog("Teksti", "");
          if (t === null || !t.trim()){ draw(); return; }
          s.text = t; fitTextBox(s); snapshot(); shapes.push(s); selId = s.id; tool = "select"; renderTools(); renderCtx(); draw(); return;
        }
        if (dist(s.pts[0], s.pts[1]) < 3){ draw(); return; }
        if (s.type === "cloud") s.pts = cloudRect(s.pts);
        if (s.type === "rect" || s.type === "ellipse"){ const b = bboxOf(s.pts); s.pts = [[b[0], b[1]], [b[2], b[3]]]; }
        s.pts = s.pts.map(q => [r2(q[0]), r2(q[1])]);
        snapshot(); shapes.push(s); draw(); return;
      }
      if (g.type === "tap" && isTap){
        if (tool === "stamp"){
          const s = newShape("stamp", [p], { kind:stampKind, num:stampKind === "#" ? nextNum("#") : nextNum(stampKind), stroke:stampDef(stampKind).color, size:9 });
          snapshot(); shapes.push(s); draw(); return;
        }
        if (tool === "legend"){
          const s = newShape("legend", [p], { fontSize:9 });
          snapshot(); shapes.push(s); selId = s.id; tool = "select"; renderTools(); renderCtx(); draw(); return;
        }
        if (tool === "callout"){
          if (!calloutTip){ calloutTip = p; draw(newShape("stamp", [p], { kind:"#", num:"", size:4, stroke:props.stroke })); return; }
          const tip = calloutTip; calloutTip = null;
          const s = newShape("callout", [tip, [p[0], p[1]], [p[0] + 140, p[1] + 24]]);
          const t = await textDialog("Selitteen teksti", "");
          if (t === null || !t.trim()){ draw(); return; }
          s.text = t; fitTextBox(s); snapshot(); shapes.push(s); selId = s.id; tool = "select"; renderTools(); renderCtx(); draw(); return;
        }
        if (tool === "polyline" || tool === "polygon" || tool === "preset"){
          const pr = tool === "preset" ? presetDef(presetId) : null;
          const t = pr ? pr.type : tool;
          if (!polyDraft){
            polyDraft = { shape:newShape(t, [], pr ? presetExtra() : {}), pts:[p], cursor:null };
          } else {
            const closeR = 12 / (fit * zoom);
            if (t === "polygon" && polyDraft.pts.length >= 3 && dist(p, polyDraft.pts[0]) < closeR){ finishPoly(true); return; }
            polyDraft.pts.push(p);
          }
          draw(); return;
        }
      }
    }
    stage.addEventListener("pointerup", endPointer);
    stage.addEventListener("pointercancel", endPointer);

    function finishPoly(commit){
      const d = polyDraft; polyDraft = null;
      if (commit && d){
        const minPts = d.shape.type === "polyline" ? 2 : 3;
        if (d.pts.length >= minPts){
          d.shape.pts = d.pts.map(q => [r2(q[0]), r2(q[1])]);
          touch(d.shape); snapshot(); shapes.push(d.shape);
        }
      }
      draw();
    }

    /* Tietokoneella: Ctrl + rulla (tai kosketuslevyn nipistys) zoomaa, rulla siirtää näkymää. */
    stage.addEventListener("wheel", ev => {
      ev.preventDefault();
      const sr = stage.getBoundingClientRect();
      if (ev.ctrlKey || ev.metaKey){
        setZoom(zoom * (ev.deltaY < 0 ? 1.15 : 1 / 1.15), ev.clientX - sr.left, ev.clientY - sr.top);
      } else {
        offX -= ev.shiftKey ? ev.deltaY : ev.deltaX; offY -= ev.shiftKey ? 0 : ev.deltaY; layout(false);
      }
    }, { passive:false });

    /* ---------- painikkeet ---------- */
    let resolveDone;
    const done = new Promise(r => resolveDone = r);
    async function close(save){
      if (polyDraft) finishPoly(true);
      if (save){
        o.onSave && o.onSave(shapes, deleted);
      } else if (dirty){
        const ok = await window.AppUI.confirm({ title:"Hylätäänkö muutokset?", text:"Pohjakuvan merkintöjen muutoksia ei ole tallennettu.", ok:"Hylkää muutokset", cancel:"Jatka muokkausta", danger:true });
        if (!ok) return;
      }
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", onResize);
      ov.remove();
      resolveDone(save);
    }
    ov.querySelector('[data-a="close"]').onclick = () => close(false);
    ov.querySelector('[data-a="save"]').onclick = () => close(true);
    ov.querySelector('[data-a="undo"]').onclick = doUndo;
    ov.querySelector('[data-a="redo"]').onclick = doRedo;
    ov.querySelector('[data-a="zin"]').onclick = () => setZoom(zoom * 1.5);
    ov.querySelector('[data-a="zout"]').onclick = () => setZoom(zoom / 1.5);
    ov.querySelector('[data-a="fit"]').onclick = () => { fitView(); draw(); scheduleRender(); };
    ov.querySelector('[data-a="finish"]').onclick = () => finishPoly(true);
    ov.querySelector('[data-a="cancelshape"]').onclick = () => { polyDraft = null; calloutTip = null; draw(); };
    ov.querySelector('[data-a="prev"]').onclick = () => { if (page > 1){ if (polyDraft) finishPoly(true); page--; selId = null; loadPage(); renderCtx(); } };
    ov.querySelector('[data-a="next"]').onclick = () => { if (page < pdfPageCount){ if (polyDraft) finishPoly(true); page++; selId = null; loadPage(); renderCtx(); } };
    function onKey(e){
      if (document.querySelector(".pm-modal,.aui-scrim")) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selId){ e.preventDefault(); ctxAction("del"); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z"){ e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); }
      else if (e.key === "Escape"){ if (polyDraft){ polyDraft = null; draw(); } else if (selId){ selId = null; renderCtx(); draw(); } }
      else if (e.key === "Enter" && polyDraft){ finishPoly(true); }
    }
    function onResize(){ layout(false); draw(); }
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", onResize);

    renderTools(); renderCtx();
    await new Promise(r => requestAnimationFrame(r));
    try{ await loadPage(); }
    catch(e){ console.error(e); stage.innerHTML = '<div style="color:#fff;padding:24px;text-align:center">Pohjakuvaa ei saatu avattua.</div>'; }
    return done;
  }

  /* =====================================================================
     PDF-VIENTI: muokattavat merkinnät (Ink, Line, PolyLine, Square, Circle,
     Polygon, FreeText, Stamp) ulkoasuineen (AP), jotka PDF-XChange ym.
     tunnistavat ja joita voi jatkaa muokkaamaan.
     ===================================================================== */
  function viewTransform(page){
    // sama kuin pdf.js PageViewport, scale 1
    const PDFLib = window.PDFLib;
    let box;
    try{ const cb = page.getCropBox(); box = [cb.x, cb.y, cb.x + cb.width, cb.y + cb.height]; }
    catch(e){ const mb = page.getMediaBox(); box = [mb.x, mb.y, mb.x + mb.width, mb.y + mb.height]; }
    const rot = ((page.getRotation().angle % 360) + 360) % 360;
    const cx = (box[0] + box[2]) / 2, cy = (box[1] + box[3]) / 2;
    let A, B, C, D;
    if (rot === 90){ A = 0; B = 1; C = 1; D = 0; }
    else if (rot === 180){ A = -1; B = 0; C = 0; D = 1; }
    else if (rot === 270){ A = 0; B = -1; C = -1; D = 0; }
    else { A = 1; B = 0; C = 0; D = -1; }
    let ocx, ocy;
    if (A === 0){ ocx = Math.abs(cy - box[1]); ocy = Math.abs(cx - box[0]); }
    else { ocx = Math.abs(cx - box[0]); ocy = Math.abs(cy - box[1]); }
    const T = [A, B, C, D, ocx - A * cx - C * cy, ocy - B * cx - D * cy]; // käyttäjä -> näkymä
    const det = T[0] * T[3] - T[1] * T[2];
    const I = [T[3] / det, -T[1] / det, -T[2] / det, T[0] / det, (T[2] * T[5] - T[3] * T[4]) / det, (T[1] * T[4] - T[0] * T[5]) / det]; // näkymä -> käyttäjä
    return { I, rot };
  }
  const apply = (M, p) => [M[0] * p[0] + M[2] * p[1] + M[4], M[1] * p[0] + M[3] * p[1] + M[5]];
  function rgb01(hex){
    hex = String(hex || "#000000").replace("#", "");
    if (hex.length === 3) hex = hex.split("").map(c => c + c).join("");
    const n = parseInt(hex, 16) || 0;
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  const f = n => (Math.round(n * 1000) / 1000).toString();
  const rgbStr = c => c.map(f).join(" ");

  function addToPdf(PDFLib, pdfDoc, shapes, font, opts){
    opts = opts || {};
    if (!shapes || !shapes.length) return 0;
    const { PDFName, PDFString, PDFHexString, PDFArray } = PDFLib;
    const ctx = pdfDoc.context;
    const pages = pdfDoc.getPages();
    const now = (() => { const d = new Date(), p = n => String(n).padStart(2, "0"); return "D:" + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()); })();
    const fontMeasure = (t, fs) => font.widthOfTextAtSize(clean(t), fs);
    function clean(t){ return String(t || "").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/[^\x20-\x7E -ÿ]/g, "?"); }
    let count = 0;

    function addAnnot(page, dict){
      let annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
      if (!annots){ annots = ctx.obj([]); page.node.set(PDFName.of("Annots"), annots); }
      annots.push(ctx.register(ctx.obj(dict)));
      count++;
    }

    pages.forEach((page, idx) => {
      const list = shapes.filter(s => s.page === idx + 1);
      if (!list.length) return;
      const { I } = viewTransform(page);
      const U = p => apply(I, p);
      const cm = `${f(I[0])} ${f(I[1])} ${f(I[2])} ${f(I[3])} ${f(I[4])} ${f(I[5])} cm`;

      list.forEach(s => {
        const w = s.width || 1.5;
        const col = rgb01(s.stroke);
        const da = dashArray(s);
        const ops = ["q", cm];
        const gs = {};
        let needGs = false;
        const strokeA = s.opacity != null ? s.opacity : 1;
        const fillA = s.fill ? (s.fillOpacity != null ? s.fillOpacity : 1) : 1;
        if (strokeA < 1 || (s.fill && fillA < 1) || s.type === "highlight"){
          needGs = true;
          gs.GS1 = { Type:"ExtGState", CA:strokeA, ca:s.type === "highlight" ? strokeA : (s.fill ? fillA * strokeA : strokeA) };
          if (s.type === "highlight") gs.GS1.BM = "Multiply";
          ops.push("/GS1 gs");
        }
        const strokeSetup = () => { ops.push(`${rgbStr(col)} RG`, `${f(w)} w`, "1 J", "1 j"); if (da) ops.push(`[${da.map(f).join(" ")}] 0 d`); };
        const pathPts = (pts, close) => { ops.push(`${f(pts[0][0])} ${f(pts[0][1])} m`); pts.slice(1).forEach(p => ops.push(`${f(p[0])} ${f(p[1])} l`)); if (close) ops.push("h"); };
        const head = (tip, from) => { const h = arrowHead(tip, from, w); ops.push("[] 0 d", `${rgbStr(col)} rg`); pathPts(h, true); ops.push("f"); if (da) ops.push(`[${da.map(f).join(" ")}] 0 d`); };
        let extraPts = [];
        let fontRes = false;
        const textLines = (g, text, fs, color) => {
          const pad = fs * 0.4;
          const lines = wrap(text, Math.max(4, g.w - pad * 2), fs, fontMeasure);
          ops.push("BT", `/F1 ${f(fs)} Tf`, `${rgbStr(rgb01(color))} rg`);
          lines.forEach((ln, i) => {
            ops.push(`1 0 0 -1 ${f(g.x + pad)} ${f(g.y + pad + fs * 0.85 + i * fs * LINE_H)} Tm`, `${font.encodeText(clean(ln)).toString()} Tj`);
          });
          ops.push("ET");
          fontRes = true;
        };

        const base = {
          Type:"Annot", F:4, C:col, T:PDFHexString.fromText(s.author || "Kenttälomake"), M:PDFString.of(now),
          NM:PDFString.of(s.id), CA:s.type === "highlight" ? strokeA : 1,
          BS:{ W:w, S:da ? "D" : "S", D:da || [3] }
        };
        let dict;
        const subjOf = () => (s.preset && presetDef(s.preset) ? presetDef(s.preset).name : TOOLS.find(t => t.id === s.type) ? TOOLS.find(t => t.id === s.type).label : s.type);

        switch (s.type){
          case "pen": case "highlight": {
            strokeSetup(); pathPts(s.pts, false); ops.push("S");
            dict = Object.assign(base, { Subtype:"Ink", InkList:[s.pts.map(U).flat()] });
            break;
          }
          case "line": case "arrow": {
            strokeSetup(); pathPts(s.pts, false); ops.push("S");
            const ae = s.type === "arrow" || s.arrowEnd, as = !!s.arrowStart;
            if (ae) head(s.pts[1], s.pts[0]);
            if (as) head(s.pts[0], s.pts[1]);
            dict = Object.assign(base, { Subtype:"Line", L:U(s.pts[0]).concat(U(s.pts[1])), LE:[as ? "ClosedArrow" : "None", ae ? "ClosedArrow" : "None"], IC:col });
            extraPts = [arrowHead(s.pts[1], s.pts[0], w), arrowHead(s.pts[0], s.pts[1], w)].flat();
            break;
          }
          case "polyline": {
            strokeSetup(); pathPts(s.pts, false); ops.push("S");
            if (s.arrowEnd) head(s.pts[s.pts.length - 1], s.pts[s.pts.length - 2]);
            if (s.arrowStart) head(s.pts[0], s.pts[1]);
            dict = Object.assign(base, { Subtype:"PolyLine", Vertices:s.pts.map(U).flat(), LE:[s.arrowStart ? "ClosedArrow" : "None", s.arrowEnd ? "ClosedArrow" : "None"], IC:col });
            break;
          }
          case "rect": case "ellipse": {
            const b = bboxOf(s.pts);
            if (s.fill) ops.push(`${rgbStr(rgb01(s.fill))} rg`);
            strokeSetup();
            if (s.type === "rect") ops.push(`${f(b[0])} ${f(b[1])} ${f(b[2] - b[0])} ${f(b[3] - b[1])} re`);
            else {
              const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2, rx = (b[2] - b[0]) / 2, ry = (b[3] - b[1]) / 2, k = 0.5523;
              ops.push(`${f(cx + rx)} ${f(cy)} m`,
                `${f(cx + rx)} ${f(cy + ry * k)} ${f(cx + rx * k)} ${f(cy + ry)} ${f(cx)} ${f(cy + ry)} c`,
                `${f(cx - rx * k)} ${f(cy + ry)} ${f(cx - rx)} ${f(cy + ry * k)} ${f(cx - rx)} ${f(cy)} c`,
                `${f(cx - rx)} ${f(cy - ry * k)} ${f(cx - rx * k)} ${f(cy - ry)} ${f(cx)} ${f(cy - ry)} c`,
                `${f(cx + rx * k)} ${f(cy - ry)} ${f(cx + rx)} ${f(cy - ry * k)} ${f(cx + rx)} ${f(cy)} c`, "h");
            }
            ops.push(s.fill ? "B" : "S");
            dict = Object.assign(base, { Subtype:s.type === "rect" ? "Square" : "Circle" });
            if (s.fill) dict.IC = rgb01(s.fill);
            break;
          }
          case "polygon": case "cloud": {
            if (s.fill) ops.push(`${rgbStr(rgb01(s.fill))} rg`);
            strokeSetup();
            if (s.type === "cloud"){
              const segs = cloudSegments(s.pts, w);
              ops.push(`${f(segs[0][0][0])} ${f(segs[0][0][1])} m`);
              segs.forEach(g => ops.push(`${f(g[1][0])} ${f(g[1][1])} ${f(g[2][0])} ${f(g[2][1])} ${f(g[3][0])} ${f(g[3][1])} c`));
              ops.push("h");
              extraPts = segs.flatMap(g => [g[1], g[2]]);
            } else pathPts(s.pts, true);
            ops.push(s.fill ? "B" : "S");
            dict = Object.assign(base, { Subtype:"Polygon", Vertices:s.pts.map(U).flat() });
            if (s.type === "cloud") dict.BE = { S:"C", I:1 };
            if (s.fill) dict.IC = rgb01(s.fill);
            break;
          }
          case "text": case "callout": {
            const g = textGeom(s), fs = s.fontSize || 9;
            if (s.type === "callout"){
              const an = calloutAnchor(s);
              ops.push(`${rgbStr(col)} RG`, `${f(w)} w`, "1 J");
              ops.push(`${f(an[0])} ${f(an[1])} m`, `${f(s.pts[0][0])} ${f(s.pts[0][1])} l`, "S");
              head(s.pts[0], an);
              extraPts = arrowHead(s.pts[0], an, w);
            }
            if (s.fill){ ops.push(`${rgbStr(rgb01(s.fill))} rg`, `${f(g.x)} ${f(g.y)} ${f(g.w)} ${f(g.h)} re`, "f"); }
            if (s.border !== false && w > 0){ strokeSetup(); ops.push(`${f(g.x)} ${f(g.y)} ${f(g.w)} ${f(g.h)} re`, "S"); }
            textLines(g, s.text, fs, s.textColor || "#111111");
            const tc = rgb01(s.textColor || "#111111");
            dict = Object.assign(base, {
              Subtype:"FreeText", Contents:PDFHexString.fromText(s.text || ""),
              DA:PDFString.of(`${rgbStr(tc)} rg /Helv ${f(fs)} Tf`)
            });
            if (s.fill) dict.IC = rgb01(s.fill);
            if (s.type === "callout"){
              const an = calloutAnchor(s);
              dict.IT = "FreeTextCallout";
              dict.CL = U(s.pts[0]).concat(U(an));
              dict.LE = "ClosedArrow";
            }
            break;
          }
          case "stamp": {
            const g = stampGeom(s, fontMeasure);
            const r = g.def.form === "rect" ? g.R * 0.25 : g.h / 2, k = 0.5523;
            const x0 = g.x, y0 = g.y, x1 = g.x + g.w, y1 = g.y + g.h;
            ops.push(`${rgbStr(rgb01(s.stroke || g.def.color))} rg`, "1 1 1 RG", `${f(g.R * 0.15)} w`);
            ops.push(`${f(x0 + r)} ${f(y0)} m`, `${f(x1 - r)} ${f(y0)} l`,
              `${f(x1 - r + r * k)} ${f(y0)} ${f(x1)} ${f(y0 + r - r * k)} ${f(x1)} ${f(y0 + r)} c`,
              `${f(x1)} ${f(y1 - r)} l`,
              `${f(x1)} ${f(y1 - r + r * k)} ${f(x1 - r + r * k)} ${f(y1)} ${f(x1 - r)} ${f(y1)} c`,
              `${f(x0 + r)} ${f(y1)} l`,
              `${f(x0 + r - r * k)} ${f(y1)} ${f(x0)} ${f(y1 - r + r * k)} ${f(x0)} ${f(y1 - r)} c`,
              `${f(x0)} ${f(y0 + r)} l`,
              `${f(x0)} ${f(y0 + r - r * k)} ${f(x0 + r - r * k)} ${f(y0)} ${f(x0 + r)} ${f(y0)} c`, "h", "B");
            const tw = fontMeasure(g.label, g.fs);
            ops.push("BT", `/F1 ${f(g.fs)} Tf`, "1 1 1 rg", `1 0 0 -1 ${f(s.pts[0][0] - tw / 2)} ${f(s.pts[0][1] + g.fs * 0.36)} Tm`, `${font.encodeText(clean(g.label)).toString()} Tj`, "ET");
            fontRes = true;
            extraPts = [[x0, y0], [x1, y1]];
            dict = Object.assign(base, { Subtype:"Stamp", Name:PDFName.of("Kentta" + String(s.kind).replace(/[^A-Za-z]/g, "N")), Contents:PDFHexString.fromText(g.def.name + " " + g.label) });
            break;
          }
          case "legend": {
            const g = legendGeom(s, shapes, fontMeasure);
            ops.push("1 1 1 rg", "0.07 0.07 0.07 RG", "0.75 w", `${f(g.x)} ${f(g.y)} ${f(g.w)} ${f(g.h)} re`, "B");
            ops.push("BT", `/F1 ${f(g.fs * 1.1)} Tf`, "0.07 0.07 0.07 rg", `1 0 0 -1 ${f(g.x + g.pad)} ${f(g.y + g.pad + g.fs)} Tm`, `${font.encodeText(g.title).toString()} Tj`, "ET");
            g.rows.forEach((r, i) => {
              const ry = g.y + g.pad + g.fs * 1.4 + i * g.rowH;
              const sx = g.x + g.pad, sw = g.fs * 3, sh = g.fs * 1.3, sy = ry + (g.rowH - sh) / 2;
              if (r.kind === "stamp"){
                ops.push(`${rgbStr(rgb01(r.def.color))} rg`, `${f(sx)} ${f(sy)} ${f(sw)} ${f(sh)} re`, "f");
                const tw = fontMeasure(r.def.kind, g.fs * 0.85);
                ops.push("BT", `/F1 ${f(g.fs * 0.85)} Tf`, "1 1 1 rg", `1 0 0 -1 ${f(sx + sw / 2 - tw / 2)} ${f(sy + sh * 0.75)} Tm`, `${font.encodeText(clean(r.def.kind)).toString()} Tj`, "ET");
              } else if (r.def.type === "arrow" || r.def.type === "polyline"){
                ops.push(`${rgbStr(rgb01(r.def.stroke))} RG`, `${f(Math.min(3, r.def.width))} w`, `${f(sx)} ${f(sy + sh / 2)} m`, `${f(sx + sw)} ${f(sy + sh / 2)} l`, "S");
              } else {
                ops.push("q");
                if (r.def.fillOpacity < 1){ gs.GSL = { Type:"ExtGState", ca:r.def.fillOpacity }; ops.push("/GSL gs"); needGs = true; }
                ops.push(`${rgbStr(rgb01(r.def.fill))} rg`, `${f(sx)} ${f(sy)} ${f(sw)} ${f(sh)} re`, "f", "Q");
                ops.push(`${rgbStr(rgb01(r.def.stroke))} RG`, "1 w", r.def.dash === "dash" ? "[3 2] 0 d" : (r.def.dash === "dot" ? "1 J [0 2] 0 d" : "[] 0 d"), `${f(sx)} ${f(sy)} ${f(sw)} ${f(sh)} re`, "S", "[] 0 d");
              }
              ops.push("BT", `/F1 ${f(g.fs)} Tf`, "0.07 0.07 0.07 rg", `1 0 0 -1 ${f(sx + sw + g.pad)} ${f(ry + g.rowH / 2 + g.fs * 0.35)} Tm`, `${font.encodeText(clean(r.def.name)).toString()} Tj`, "ET");
            });
            fontRes = true;
            extraPts = [[g.x, g.y], [g.x + g.w, g.y + g.h]];
            dict = Object.assign(base, { Subtype:"FreeText", Contents:PDFHexString.fromText("Selitteet: " + g.rows.map(r => r.def.name).join(", ")), DA:PDFString.of("0 g /Helv 9 Tf") });
            break;
          }
          default: return;
        }
        ops.push("Q");

        // Rect = merkinnän ja sen apupisteiden rajat käyttäjäkoordinaateissa
        const vb = shapeBBox(s, shapes);
        const corners = [[vb[0], vb[1]], [vb[2], vb[1]], [vb[2], vb[3]], [vb[0], vb[3]]].concat(extraPts);
        const ub = bboxOf(corners.map(U));
        const m = w * 2 + 2;
        const rect = [ub[0] - m, ub[1] - m, ub[2] + m, ub[3] + m];
        dict.Rect = rect;
        dict.Subj = PDFHexString.fromText(subjOf());
        if (!dict.Contents) dict.Contents = PDFHexString.fromText(subjOf());
        const res = {};
        if (fontRes) res.Font = { F1:font.ref };
        if (needGs) res.ExtGState = gs;
        const ap = ctx.register(ctx.stream(ops.join("\n"), { Type:"XObject", Subtype:"Form", FormType:1, BBox:rect, Matrix:[1, 0, 0, 1, 0, 0], Resources:res }));
        dict.AP = { N:ap };
        addAnnot(page, dict);
      });
    });
    return count;
  }

  /* Yhdistää kaksi merkintälistaa (pilvi + laite): uusin muokkaus voittaa, poistot huomioidaan. */
  function merge(local, remote, deletedLocal, deletedRemote){
    const del = {};
    (deletedLocal || []).concat(deletedRemote || []).forEach(id => { del[id] = 1; });
    const byId = {};
    const order = [];
    (local || []).concat(remote || []).forEach(s => {
      if (!s || !s.id || del[s.id]) return;
      const cur = byId[s.id];
      if (!cur){ byId[s.id] = s; order.push(s.id); }
      else if (String(s.updatedAt || "") > String(cur.updatedAt || "")) byId[s.id] = s;
    });
    return order.map(id => byId[id]);
  }

  return { open, svgForPage, addToPdf, merge, STAMPS, PRESETS };
})();
