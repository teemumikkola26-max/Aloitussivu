"use strict";
/* =========================================================================
   DOCX-STYLE-ENGINE.JS
   Jaettu OOXML-generointimoottori .docx-vientiin. Käytetään kaikista
   lomakkeista (kuntotarkastus.html, kuntoarvio.html, form-runtime.js).
   Vaatii JSZipin ladatuksi ennen tätä tiedostoa.

   TYYLIOBJEKTIN MUOTO (tallennetaan Supabasen doc_styles-tauluun):
   {
     coverPage: { enabled, title, subtitle, logoDataUrl, accentColor, companyInfo,
                  sourceMode: "generated"|"docx", docxPath, docxFileName },
     headingNumbering: { enabled },   // true = otsikot numeroidaan 1 / 1.1 / 1.1.1
     coverHeader / coverFooter: sama muoto kuin header/footer, vain generoidun kansilehden oma tunniste
     header: { enabled, fontSize, color, left:{type,text}, center:{type,text}, right:{type,text} },
     footer: { enabled, fontSize, color, left:{type,text}, center:{type,text}, right:{type,text} },
     // tunnisteen kentän type: none | text | date | page | pageOf | title | logo
     fonts: { heading, body, headingSize, bodySize },
     colors: { heading, body },
     toc: { enabled, variant: "classic"|"simple" },
     pagesBefore: [ { id, title, blocks, sourceMode, docxPath, docxFileName } ],
     pagesAfter:  [ { id, title, blocks, sourceMode, docxPath, docxFileName } ]

     // Sivun "blocks" on lista lohkoja, esim:
     //   { type:"heading",    text }
     //   { type:"subheading", text, color }
     //   { type:"paragraph",  text, color }
     //   { type:"bullets",    items:[...], color }
     //   { type:"numbered",   items:[...], color }
     // Vanhat tallenteet, joissa on vain { content: "..." } (yksi tekstilohko),
     // luetaan yhä oikein normalizePage()-funktion kautta.
     //
     // sourceMode:"docx" (kansilehdellä tai yksittäisellä sivulla) tarkoittaa,
     // että sisältö tulee käyttäjän itse lataamasta .docx-tiedostosta blocksin
     // sijaan. docxPath on polku Supabase Storagessa; kutsujan (export-koodin)
     // täytyy ladata tiedoston tavut ETUKÄTEEN ja liittää ne kenttään
     // "_docxBytes" (ArrayBuffer/Uint8Array) ennen assembleDocx()-kutsua --
     // tämä moduuli ei itse tee verkkokutsuja.
   }
   ========================================================================= */
window.DocxStyleEngine = (function(){

  function defaultStyle(){
    return {
      coverPage: { enabled:false, title:"", subtitle:"", logoDataUrl:"", accentColor:"#8fb79c", companyInfo:"", sourceMode:"generated", docxPath:"", docxFileName:"" },
      headingNumbering: { enabled:true },
      header: { enabled:false, fontSize:9, color:"#7a7566", left:emptySlot(), center:emptySlot(), right:emptySlot() },
      footer: { enabled:false, fontSize:9, color:"#7a7566", left:emptySlot(), center:{ type:"pageOf", text:"" }, right:emptySlot() },
      fonts: { heading:"Calibri", body:"Calibri", headingSize:16, subheadingSize:11, bodySize:10.5 },
      colors: { heading:"#000000", body:"#1c2430" },
      coverHeader: { enabled:false, fontSize:9, color:"#7a7566", left:emptySlot(), center:emptySlot(), right:emptySlot() },
      coverFooter: { enabled:false, fontSize:9, color:"#7a7566", left:emptySlot(), center:emptySlot(), right:emptySlot() },
      toc: { enabled:false, variant:"classic" },
      pagesBefore: [],
      pagesAfter: []
    };
  }


  /* ---- Ylä-/alatunnisteen kolme kenttää (vasen, keski, oikea) ---- */
  const HF_SLOT_TYPES = [
    ["none","Tyhjä"],
    ["text","Vapaa teksti"],
    ["date","Päivämäärä"],
    ["page","Sivunumero (Sivu 1)"],
    ["pageOf","Sivunumero (Sivu 1 / 5)"],
    ["title","Raportin nimi"],
    ["logo","Logo"]
  ];
  const HF_KEYS = ["left","center","right"];

  function emptySlot(){ return { type:"none", text:"" }; }

  // Vanha muoto (text/showDate/align/showLogo/showPageNumber) -> uusi kolmikenttäinen muoto.
  function migrateLegacyHF(old, kind){
    const out = { enabled: !!old.enabled, fontSize: old.fontSize || 9, color: old.color || "#7a7566",
      left: emptySlot(), center: emptySlot(), right: emptySlot() };
    const align = (old.align === "center" || old.align === "right" || old.align === "left")
      ? old.align : (kind === "footer" ? "center" : "left");
    const free = prefs => prefs.find(k => out[k].type === "none");
    if (old.text) out[align] = { type:"text", text: old.text };
    if (kind === "header"){
      if (old.showDate){
        const k = free(align === "right" ? ["left","center","right"] : ["right","center","left"]);
        if (k) out[k] = { type:"date", text:"" };
      }
      if (old.showLogo){
        const k = free(["left","right","center"]);
        if (k) out[k] = { type:"logo", text:"" };
      }
    } else {
      const showPN = old.showPageNumber === undefined ? true : !!old.showPageNumber;
      if (showPN){
        const k = free(old.text ? (align === "right" ? ["left","center"] : ["right","center","left"]) : [align,"center","right","left"]);
        if (k) out[k] = { type:"pageOf", text:"" };
      }
    }
    return out;
  }

  function mergeHF(saved, def, kind){
    if (!saved) return JSON.parse(JSON.stringify(def));
    const isNew = HF_KEYS.some(k => saved[k] && typeof saved[k] === "object");
    if (!isNew) return migrateLegacyHF(saved, kind);
    const out = Object.assign({}, def, saved);
    HF_KEYS.forEach(k => { out[k] = Object.assign(emptySlot(), saved[k] || {}); });
    return out;
  }

  /*
   * Täydentää tallennetun tyylin oletusarvoilla ja muuntaa vanhan
   * ylä-/alatunnistemuodon uuteen. Idempotentti. Kaikki lataajat käyttävät tätä.
   */
  function mergeStyle(saved){
    const d = defaultStyle();
    const s = saved || {};
    const out = Object.assign({}, s);
    out.coverPage = Object.assign({}, d.coverPage, s.coverPage || {});
    out.fonts = Object.assign({}, d.fonts, s.fonts || {});
    out.colors = Object.assign({}, d.colors, s.colors || {});
    out.toc = Object.assign({}, d.toc, s.toc || {});
    out.headingNumbering = Object.assign({}, d.headingNumbering, s.headingNumbering || {});
    out.header = mergeHF(s.header, d.header, "header");
    out.footer = mergeHF(s.footer, d.footer, "footer");
    out.coverHeader = mergeHF(s.coverHeader, d.coverHeader, "header");
    out.coverFooter = mergeHF(s.coverFooter, d.coverFooter, "footer");
    out.pagesBefore = s.pagesBefore || [];
    out.pagesAfter = s.pagesAfter || [];
    return out;
  }

  /* ---- Rikas teksti: runs = [{ text, bold, color }] ---- */
  function runsPlain(runs){ return (runs || []).map(r => r.text || "").join(""); }
  function listItemsOf(b){
    if (Array.isArray(b.itemRuns) && b.itemRuns.length){
      return b.itemRuns.map(r => ({ runs:r, plain: runsPlain(r) })).filter(x => x.plain.trim() !== "");
    }
    return (b.items || []).filter(t => t != null && String(t).trim() !== "").map(t => ({ runs:null, plain:String(t) }));
  }

  /*
   * Palauttaa sivun blocks-listan. Jos sivulla on vain vanha yksittäinen
   * "content"-teksti (ennen lohkopohjaista editoria tallennettu), se
   * muunnetaan yhdeksi paragraph-lohkoksi -- vanhat tallenteet siis
   * näkyvät jatkossakin ennallaan.
   */
  function normalizePage(page){
    if (page.blocks && page.blocks.length) return page.blocks;
    if (page.content) return [{ type:"paragraph", text: page.content }];
    return [];
  }

  /*
   * Muuntaa yhden vakiotekstisivun blocks-listan OOXML-kappaleiksi.
   * Palauttaa taulukon valmiita <w:p>...</w:p> -merkkijonoja.
   */
  function renderPageBlocks(blocks, style){
    const parts = [];
    blocks.forEach(b => {
      const type = b.type || "paragraph";
      if (type === "heading"){
        parts.push(paraXml(b.text || "", {
          bold:true, sz: pt2hp((style.fonts.headingSize||14)), font: style.fonts.heading,
          color: b.color || style.colors.heading, before:160, after:100
        }));
      } else if (type === "subheading"){
        parts.push(paraXml(b.text || "", {
          bold:true, sz: pt2hp(style.fonts.subheadingSize||11), font: style.fonts.heading,
          color: b.color || style.colors.heading, before:120, after:80
        }));
      } else if (type === "bullets" || type === "numbered"){
        listItemsOf(b).forEach(item => {
          parts.push(paraXml(item.runs ? "" : item.plain, {
            font: style.fonts.body, sz: pt2hp(style.fonts.bodySize), color: b.color || style.colors.body,
            numId: type === "bullets" ? 1 : 2, after:40, runs: item.runs || undefined
          }));
        });
      } else {
        // paragraph (myös vanhojen tallenteiden migroitu content-teksti)
        if (Array.isArray(b.runs) && b.runs.length && runsPlain(b.runs).trim() !== "") {
          parts.push(paraXml("", {
            font: style.fonts.body, sz: pt2hp(style.fonts.bodySize), color: b.color || style.colors.body, after:100, runs: b.runs
          }));
        } else if (b.text) {
          parts.push(paraXml(b.text, {
            font: style.fonts.body, sz: pt2hp(style.fonts.bodySize), color: b.color || style.colors.body, after:100
          }));
        }
      }
    });
    return parts;
  }

  const FONT_CHOICES = ["Calibri","Arial","Georgia","Times New Roman","Verdana","Cambria","Tahoma","Ebrima"];

  // Tuotujen .docx-liitteiden mediatiedostojen tarvitsemat Content_Types-oletukset
  // (jpeg/xml/rels ovat jo aina mukana peruspaketissa).
  const EXT_CONTENT_TYPES = {
    png:"image/png", gif:"image/gif", bmp:"image/bmp", tif:"image/tiff", tiff:"image/tiff",
    emf:"image/x-emf", wmf:"image/x-wmf", wdp:"image/vnd.ms-photo", jpg:"image/jpeg", jpeg:"image/jpeg"
  };

  function xmlEsc(s){
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  }

  function fontRpr(font){
    return font ? '<w:rFonts w:ascii="' + xmlEsc(font) + '" w:hAnsi="' + xmlEsc(font) + '" w:cs="' + xmlEsc(font) + '"/>' : "";
  }

  function pt2hp(pt){ return Math.round(pt * 2); }

  // opts: bold, italic, color (hex no #), sz (half-points), font, before, after, align("center"|"right"|"left"),
  //       bottomBorder: { color, sz } -- ohut viiva kappaleen alle, pStyle: "Heading1" -- viittaus tyyliin (TOC:ia varten)
  //       noNum: true -- otsikkotyylin (Heading1-3) numerointi pois tältä kappaleelta
  //       numId: 1 (luettelomerkki) tai 2 (numeroitu) -- ks. numberingXml(); ilvl: sisennystaso (0 = ensimmäinen)
  function paraXml(text, opts){
    opts = opts || {};
    const rPrFor = o => {
      const rPr = [];
      if (o.font) rPr.push(fontRpr(o.font));
      if (o.bold) rPr.push("<w:b/>");
      if (o.italic) rPr.push("<w:i/>");
      if (o.color && /^#?[0-9a-fA-F]{6}$/.test(o.color)) rPr.push('<w:color w:val="' + o.color.replace("#","") + '"/>');
      if (o.sz) rPr.push('<w:sz w:val="' + o.sz + '"/><w:szCs w:val="' + o.sz + '"/>');
      return rPr.length ? '<w:rPr>' + rPr.join('') + '</w:rPr>' : "";
    };
    const textRuns = t => String(t == null ? "" : t).split(/\r?\n/)
      .map((line,i) => (i>0?"<w:br/>":"") + '<w:t xml:space="preserve">' + xmlEsc(line) + '</w:t>').join("");
    // OOXML-skeeman mukainen pPr-lasten järjestys: pStyle, numPr, pBdr, spacing, jc
    const pPr = [];
    if (opts.pStyle) pPr.push('<w:pStyle w:val="' + xmlEsc(opts.pStyle) + '"/>');
    if (opts.numId){
      pPr.push('<w:numPr><w:ilvl w:val="' + (opts.ilvl || 0) + '"/><w:numId w:val="' + opts.numId + '"/></w:numPr>');
    } else if (opts.noNum){
      // numId 0 = poistaa tyylin numeroinnin tältä kappaleelta (esim. raportin nimi tai liitesivun otsikko Heading1-tyylillä)
      pPr.push('<w:numPr><w:ilvl w:val="0"/><w:numId w:val="0"/></w:numPr>');
    }
    if (opts.bottomBorder){
      pPr.push('<w:pBdr><w:bottom w:val="single" w:sz="' + (opts.bottomBorder.sz||16) + '" w:space="4" w:color="' + opts.bottomBorder.color.replace("#","") + '"/></w:pBdr>');
    }
    if (opts.before || opts.after){
      pPr.push('<w:spacing' + (opts.before?' w:before="'+opts.before+'"':'') + (opts.after?' w:after="'+opts.after+'"':'') + '/>');
    }
    if (opts.ind0) pPr.push('<w:ind w:left="0" w:right="0" w:firstLine="0"/>');
    if (opts.align) pPr.push('<w:jc w:val="' + opts.align + '"/>');
    let runsOut;
    if (Array.isArray(opts.runs) && opts.runs.length){
      runsOut = opts.runs.filter(r => r && r.text).map(r => '<w:r>' + rPrFor({
        font: opts.font, sz: opts.sz, italic: opts.italic,
        bold: opts.bold || r.bold, color: r.color || opts.color
      }) + textRuns(r.text) + '</w:r>').join("");
    } else {
      runsOut = '<w:r>' + rPrFor(opts) + textRuns(text) + '</w:r>';
    }
    return '<w:p>' + (pPr.length?'<w:pPr>'+pPr.join('')+'</w:pPr>':'') + runsOut + '</w:p>';
  }

  /*
   * Kiinteä numerointimääritelmä: numId=1 luettelomerkeille (•),
   * numId=2 numeroidulle listalle (1. 2. 3. ...). Sisällytetään aina
   * dokumenttiin -- ei haittaa vaikka mitään listaa ei käytettäisi.
   * extraAbsXml / extraNumXml: tuodusta .docx-liitteestä poimitut
   * (uudelleennimetyt) abstractNum- ja num-määritelmät. Ne annetaan erikseen,
   * jotta abstractNum-lohkot voidaan kirjoittaa ennen num-lohkoja.
   */
  /*
   * Otsikoiden monitasonumerointi (numId 3): Heading1 = 1, 2, 3 ...;
   * Heading2 = 1.1, 1.2 ...; Heading3 = 1.1.1, 1.1.2 ... Tasot on sidottu
   * otsikkotyyleihin (lvl/pStyle + tyylin numPr), joten numerointi seuraa
   * kappaleen tyyliä eikä sitä tarvitse kirjoittaa tekstiin käsin.
   */
  function headingNumberingAbstractXml(){
    const indents = [567, 709, 851];
    let lvls = "";
    for (let i = 0; i < 9; i++){
      let text = "";
      for (let k = 1; k <= i + 1; k++) text += (k > 1 ? "." : "") + "%" + k;
      const ind = indents[i] || 992;
      lvls += '<w:lvl w:ilvl="' + i + '"><w:start w:val="1"/><w:numFmt w:val="decimal"/>' +
        (i < 3 ? '<w:pStyle w:val="Heading' + (i + 1) + '"/>' : '') +
        '<w:lvlText w:val="' + text + '"/><w:lvlJc w:val="left"/>' +
        '<w:pPr><w:ind w:left="' + ind + '" w:hanging="' + ind + '"/></w:pPr></w:lvl>';
    }
    return '<w:abstractNum w:abstractNumId="2"><w:multiLevelType w:val="multilevel"/>' + lvls + '</w:abstractNum>';
  }

  function numberingXml(extraAbsXml, extraNumXml, extraNsAttrs){
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"' + (extraNsAttrs || '') + '>' +
      '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/>' +
      '<w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="432" w:hanging="432"/></w:pPr>' +
      '<w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol" w:hint="default"/></w:rPr></w:lvl></w:abstractNum>' +
      '<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/>' +
      '<w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="432" w:hanging="432"/></w:pPr></w:lvl></w:abstractNum>' +
      headingNumberingAbstractXml() +
      // OOXML-skeema vaatii: kaikki abstractNum-lohkot ENNEN w:num-lohkoja
      (extraAbsXml || '') +
      '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>' +
      '<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>' +
      '<w:num w:numId="3"><w:abstractNumId w:val="2"/></w:num>' +
      (extraNumXml || '') +
      '</w:numbering>';
  }

  /*
   * Poimii OOXML-elementin (esim. <w:style ...>...</w:style>) merkkijonosta
   * kaikki esiintymät alkaen annetusta avaavasta tagista, laskien
   * <tag ...> / </tag> -sisäkkäisyyden itse (regex ei osaa tätä luotettavasti
   * kun sisältöä on paljon ja se voi teoriassa sisältää samannimisiä
   * sisäkkäisiä elementtejä).
   */
  function extractTopLevelBlocks(xml, tagName){
    const blocks = [];
    const openRe = new RegExp('<' + tagName + '(?:\\s[^>]*)?>', 'g');
    const selfCloseRe = new RegExp('<' + tagName + '(?:\\s[^>]*)?/>');
    let m;
    while ((m = openRe.exec(xml))){
      if (selfCloseRe.test(m[0])) continue; // ei pitäisi tapahtua näille tageille, mutta varmuuden vuoksi
      const start = m.index;
      let depth = 1;
      const scanRe = new RegExp('<' + tagName + '(?:\\s[^>]*)?/?>|</' + tagName + '>', 'g');
      scanRe.lastIndex = openRe.lastIndex;
      let end = -1, sm;
      while ((sm = scanRe.exec(xml))){
        if (sm[0].charAt(1) === '/') { depth--; if (depth === 0){ end = sm.index + sm[0].length; break; } }
        else if (!sm[0].endsWith('/>')) depth++;
      }
      if (end === -1) break;
      blocks.push(xml.slice(start, end));
      openRe.lastIndex = end;
    }
    return blocks;
  }


  /* -----------------------------------------------------------------------
     Apufunktiot .docx-tuonnin tyyli-/oletusmuotoilun käsittelyyn
     ----------------------------------------------------------------------- */

  // Kenttien järjestys OOXML-skeeman mukaan (pPr / rPr) -- Word on järjestyksestä tarkka.
  const PPR_ORDER = ["w:pStyle","w:keepNext","w:keepLines","w:pageBreakBefore","w:framePr","w:widowControl","w:numPr",
    "w:suppressLineNumbers","w:pBdr","w:shd","w:tabs","w:suppressAutoHyphens","w:kinsoku","w:wordWrap","w:overflowPunct",
    "w:topLinePunct","w:autoSpaceDE","w:autoSpaceDN","w:bidi","w:adjustRightInd","w:snapToGrid","w:spacing","w:ind",
    "w:contextualSpacing","w:mirrorIndents","w:suppressOverlap","w:jc","w:textDirection","w:textAlignment",
    "w:textboxTightWrap","w:outlineLvl","w:divId","w:cnfStyle","w:rPr","w:sectPr","w:pPrChange"];
  const RPR_ORDER = ["w:rStyle","w:rFonts","w:b","w:bCs","w:i","w:iCs","w:caps","w:smallCaps","w:strike","w:dstrike",
    "w:outline","w:shadow","w:emboss","w:imprint","w:noProof","w:snapToGrid","w:vanish","w:webHidden","w:color",
    "w:spacing","w:w","w:kern","w:position","w:sz","w:szCs","w:highlight","w:u","w:effect","w:bdr","w:shd","w:fitText",
    "w:vertAlign","w:rtl","w:cs","w:em","w:lang","w:eastAsianLayout","w:specVanish","w:oMath"];

  // Jakaa pPr/rPr-sisällön ylätason lapsielementteihin (myös w14:-tyyppiset).
  function splitChildren(xml){
    const out = [];
    const re = /<(\/?)([A-Za-z0-9]+:[A-Za-z0-9]+)\b[^>]*?(\/?)>/g;
    let depth = 0, start = -1, name = "", m;
    while ((m = re.exec(xml))){
      const closing = m[1] === "/", selfc = m[3] === "/";
      if (!closing){
        if (depth === 0){ start = m.index; name = m[2]; }
        if (selfc){ if (depth === 0) out.push({ name, xml: m[0] }); }
        else depth++;
      } else {
        depth--;
        if (depth === 0) out.push({ name, xml: xml.slice(start, m.index + m[0].length) });
      }
    }
    return out;
  }

  // Yhdistää kaksi pPr/rPr-sisältöä (jälkimmäinen voittaa) ja järjestää skeeman mukaan.
  function mergeProps(baseXml, overXml, order){
    const map = new Map();
    splitChildren(baseXml || "").forEach(c => map.set(c.name, c.xml));
    splitChildren(overXml || "").forEach(c => map.set(c.name, c.xml));
    const items = [];
    let i = 0;
    map.forEach((xml, name) => {
      const idx = order.indexOf(name);
      items.push({ xml, idx: idx < 0 ? order.length : idx, i: i++ });
    });
    items.sort((a, b) => (a.idx - b.idx) || (a.i - b.i));
    return items.map(x => x.xml).join("");
  }

  /*
   * Lähteen oletusmuotoilu (docDefaults) elää Wordissa dokumenttitasolla, mutta
   * tämän moottorin docDefaults on yhteinen koko dokumentille eikä sitä voi
   * vaihtaa tuotavan sivun mukaan. Siksi lähteen oletuskappaletyyli (Normal)
   * saa mukaansa lähteen docDefaults-arvot (kappaleväli, riviväli, fontti, koko).
   * Palauttaa:
   *   normal -- täysi tyyli (docDefaults + Normalin omat arvot)
   *   cell   -- sama ilman kappalemuotoilua (vain merkkimuotoilu + Normalin omat
   *             kappalearvot); käytetään taulukkosolujen kappaleissa, kun
   *             taulukkotyyli määrää itse kappaleväliä (OOXML: taulukkotyyli
   *             voittaa docDefaultsin, mutta kappaletyyli voittaa taulukkotyylin).
   */
  function buildDefaultParaStyles(block, ddPPr, ddRPr, prefix, importIdx){
    let pPrOwn = "", rPrOwn = "";
    let rest = block.replace(/<w:pPr>([\s\S]*?)<\/w:pPr>|<w:pPr\s*\/>/, (m, inner) => { pPrOwn = inner || ""; return ""; });
    rest = rest.replace(/<w:rPr>([\s\S]*?)<\/w:rPr>|<w:rPr\s*\/>/, (m, inner) => { rPrOwn = inner || ""; return ""; });
    // Wordin oletukset, jos lähteen docDefaults ei määrää: väri automaattinen, 10 pt
    const rFallback = '<w:color w:val="auto"/><w:sz w:val="20"/>';
    const mergedR = mergeProps(rFallback + (ddRPr || ""), rPrOwn, RPR_ORDER);
    const mergedP = mergeProps(ddPPr, pPrOwn, PPR_ORDER);
    const cellP = mergeProps("", pPrOwn, PPR_ORDER);
    const label = "(tuotu " + importIdx + ")";
    // Nimi muutetaan, ettei dokumentissa ole kahta tyyliä nimeltä "Normal".
    rest = rest.replace(/<w:name\s+w:val="[^"]*"\s*\/>/, '<w:name w:val="Normal ' + label + '"/>');
    const tail = (mergedP ? '<w:pPr>' + mergedP + '</w:pPr>' : '') + (mergedR ? '<w:rPr>' + mergedR + '</w:rPr>' : '');
    const normal = rest.replace(/<\/w:style>\s*$/, tail + '</w:style>');
    const cell = '<w:style w:type="paragraph" w:customStyle="1" w:styleId="' + prefix + 'NormalCell">' +
      '<w:name w:val="Normal cell ' + label + '"/>' +
      (cellP ? '<w:pPr>' + cellP + '</w:pPr>' : '') + (mergedR ? '<w:rPr>' + mergedR + '</w:rPr>' : '') + '</w:style>';
    return { normal, cell };
  }

  /*
   * Lisää pStyle-viittauksen kappaleisiin, joilla ei ole omaa tyyliä. Wordin
   * tallentamissa tiedostoissa tavallisilla kappaleilla ei ole pStyleä (ne ovat
   * implisiittisesti "Normal"), ja ilman tätä ne saisivat HOSTIN Normal-tyylin
   * eivätkä lähteen. Taulukon solun kappaleille käytetään cellId-tyyliä, jos
   * taulukon tyyli (tblNeedsCell) määrää itse kappaleväliä.
   */
  function addDefaultParaStyle(xml, normalId, cellId, tblNeedsCell){
    const re = /<w:tbl>|<\/w:tbl>|<w:tblStyle\s+w:val="([^"]+)"\s*\/>|<w:p(?:\s[^>]*?)?(\/?)>/g;
    const stack = [];
    let out = "", last = 0, m;
    const ps = id => '<w:pStyle w:val="' + id + '"/>';
    while ((m = re.exec(xml))){
      const tag = m[0];
      if (tag === "<w:tbl>"){ stack.push(false); continue; }
      if (tag === "</w:tbl>"){ stack.pop(); continue; }
      if (tag.indexOf("<w:tblStyle") === 0){
        if (stack.length) stack[stack.length - 1] = !!tblNeedsCell(m[1]);
        continue;
      }
      const id = (stack.length && stack[stack.length - 1]) ? cellId : normalId;
      if (m[2] === "/"){ // <w:p .../>
        out += xml.slice(last, m.index) + tag.slice(0, -2) + '><w:pPr>' + ps(id) + '</w:pPr></w:p>';
        last = re.lastIndex;
        continue;
      }
      const after = xml.slice(re.lastIndex, re.lastIndex + 400);
      if (/^\s*<w:pPr>\s*<w:pStyle\b/.test(after)) continue;       // jo tyylitetty
      const open = /^\s*<w:pPr>/.exec(after);
      const selfPPr = /^\s*<w:pPr\s*\/>/.exec(after);
      if (open){
        out += xml.slice(last, re.lastIndex) + open[0] + ps(id);
        last = re.lastIndex + open[0].length;
      } else if (selfPPr){
        out += xml.slice(last, re.lastIndex) + '<w:pPr>' + ps(id) + '</w:pPr>';
        last = re.lastIndex + selfPPr[0].length;
      } else {
        out += xml.slice(last, re.lastIndex) + '<w:pPr>' + ps(id) + '</w:pPr>';
        last = re.lastIndex;
      }
    }
    return out + xml.slice(last);
  }

  /*
   * Tuo käyttäjän lataaman .docx-tiedoston sisällön (kansilehti tai
   * vakiotekstisivu) suoraan osaksi tuotettavaa dokumenttia -- EI
   * altChunk-viittauksena (joka vaatii Wordin tulkitsevan sen erikseen ja
   * jättää nimettyihin tyyleihin/teemaan perustuvan muotoilun helposti
   * soveltamatta), vaan kopioimalla ja uudelleennimeämällä tyylit,
   * numeroinnit, teeman, kuvat ja mahdollisen ylä-/alatunnisteen niin,
   * etteivät ne törmää tämän dokumentin omiin. Näin muotoilu säilyy
   * täsmälleen samana kaikissa Word-yhteensopivissa ohjelmissa, ei vain
   * Wordissa.
   *
   * ctx-oliossa jaetut, koko assembleDocx-kutsun ajan kertyvät taulukot:
   * relParts, contentTypeOverrides, mediaFiles, headerFolderFiles,
   * headerRelsFiles, importedStyleDefs, importedAbsDefs, importedNumInstDefs, defaultStyleTypes, extraDefaultExts
   * (Set), sekä ctx.theme (ensimmäinen tuotu teema voittaa).
   * Palauttaa { bodyXml, sectPr } -- sectPr sisältää lähteen oman
   * sivukoon/marginaalit (ja ylä/alatunnisteen, jos sellainen löytyi).
   */
  async function importDocxAsSection(bytes, ctx, label){
    const zip = await JSZip.loadAsync(bytes);
    const docFile = zip.file("word/document.xml");
    if (!docFile) throw new Error("word/document.xml puuttuu ladatusta tiedostosta");
    const docXml = await docFile.async("string");
    const relsFile = zip.file("word/_rels/document.xml.rels");
    const relsXml = relsFile ? await relsFile.async("string") : "";

    const importIdx = ++ctx.importCounter;

    // Nykyaikaiset Wordin tallentamat tiedostot käyttävät kymmeniä lisä-
    // nimiavaruusetuliitteitä juuritasolla (w14, w15, mc, wp14, w16cid, ...),
    // ja niitä käytetään usein suoraan runko-XML:ssä (esim. w14:paraId JOKA
    // kappaleessa, mc:AlternateContent kuvien ympärillä). Jos emme poimi ja
    // lisää näitä myös OMAAN juurielementtiimme, tuloksena on "unbound
    // prefix" -virhe eikä Word avaa tiedostoa lainkaan. Poimitaan siis kaikki
    // lähteen ilmoittamat xmlns:-liitteet ja kerätään ne ctx:ään, josta
    // assembleDocx lisää ne kaikkiin generoimiinsa juurielementteihin.
    function collectNamespaceDecls(openTagStr){
      const re = /xmlns:([a-zA-Z0-9]+)="([^"]*)"/g;
      let m;
      while ((m = re.exec(openTagStr))){
        if (!(m[1] in ctx.extraNamespaces)) ctx.extraNamespaces[m[1]] = m[2];
      }
    }
    const rootTagMatch = /^<w:document\b[^>]*>/.exec(docXml.replace(/^\uFEFF?<\?xml[^>]*\?>\s*/, ""));
    if (rootTagMatch) collectNamespaceDecls(rootTagMatch[0]);

    function parseRelationships(xmlText){
      const map = {};
      const re = /<Relationship\s+Id="([^"]+)"\s+Type="([^"]+)"\s+Target="([^"]+)"(\s+TargetMode="([^"]+)")?\s*\/>/g;
      let m;
      while ((m = re.exec(xmlText))){
        map[m[1]] = { type: m[2], target: m[3], external: m[5] === "External" };
      }
      return map;
    }

    // ---- kuvat + ulkoiset linkit: kopioi ja rakenna vanha->uusi rId -kartta ----
    async function importMediaFromRels(relMap, basePath, filePrefix){
      const idMap = {};
      for (const oldId in relMap){
        const r = relMap[oldId];
        if (r.target.indexOf("media/") === 0){
          const zipPath = basePath + r.target;
          const f = zip.file(zipPath);
          if (!f) continue;
          const blob = await f.async("blob");
          const origName = r.target.split("/").pop();
          const ext = (origName.split(".").pop() || "bin").toLowerCase();
          if (EXT_CONTENT_TYPES[ext]) ctx.extraDefaultExts.add(ext);
          const newName = filePrefix + "_" + origName;
          ctx.mediaFiles.push({ name: newName, blob });
          const newRid = ctx.relCounter.value++;
          ctx.relParts.push('<Relationship Id="rId'+newRid+'" Type="'+r.type+'" Target="media/'+newName+'"/>');
          idMap[oldId] = newRid;
        } else if (r.external){
          const newRid = ctx.relCounter.value++;
          ctx.relParts.push('<Relationship Id="rId'+newRid+'" Type="'+r.type+'" Target="'+xmlEsc(r.target)+'" TargetMode="External"/>');
          idMap[oldId] = newRid;
        }
      }
      return idMap;
    }

    function remapRidsInXml(xmlStr, idMap){
      let out = xmlStr;
      for (const oldId in idMap) out = out.split('"'+oldId+'"').join('"rId'+idMap[oldId]+'"');
      const validSet = {}; for (const k in idMap) validSet['rId'+idMap[k]] = true;
      // pura roikkuvat hyperlinkit, joiden kohderelaatiota ei tuotu mukaan
      out = out.replace(/<w:hyperlink([^>]*)r:id="([^"]+)"([^>]*)>([\s\S]*?)<\/w:hyperlink>/g, function(m,a,rid,b,inner){
        return validSet[rid] ? m : inner;
      });
      return out;
    }

    const docRels = parseRelationships(relsXml);
    const docIdMap = await importMediaFromRels(docRels, "word/", "imp" + importIdx);

    // ---- runko + viimeinen (koko sivun) sectPr ----
    const bodyMatch = /<w:body[^>]*>([\s\S]*)<\/w:body>/.exec(docXml);
    let bodyInner = bodyMatch ? bodyMatch[1] : "";
    const trimmed = bodyInner.trim();
    let sourceSectPr = null;
    const lastOpenIdx = trimmed.lastIndexOf('<w:sectPr');
    if (lastOpenIdx !== -1){
      const candidate = trimmed.slice(lastOpenIdx);
      if (/^<w:sectPr\b[\s\S]*<\/w:sectPr>\s*$/.test(candidate)){
        sourceSectPr = candidate.match(/^<w:sectPr\b[\s\S]*<\/w:sectPr>/)[0];
        const idx = bodyInner.lastIndexOf(sourceSectPr);
        bodyInner = bodyInner.slice(0, idx) + bodyInner.slice(idx + sourceSectPr.length);
      }
    }
    // Dokumentin SISÄLLÄ olevat (väli-)osiovaihdot voivat viitata omiin
    // ylä/alatunnisteisiinsa -- niitä ei tuoda, joten viittaukset poistetaan
    // ettei jää roikkuvia rId:eitä.
    bodyInner = bodyInner.replace(/<w:headerReference[^/]*\/>/g, "").replace(/<w:footerReference[^/]*\/>/g, "");

    bodyInner = remapRidsInXml(bodyInner, docIdMap);

    // ---- tyylit: poimi, nimeä uudelleen törmäysten välttämiseksi ----
    const styleIdMap = {};
    const prefix = "imp" + importIdx + "_";
    const remapStyleIds = str => str.replace(
      /(<w:(?:pStyle|rStyle|tblStyle|numStyleLink|styleLink|basedOn|next|link)\s+w:val=")([^"]+)(")/g,
      (m,pre,val,post) => styleIdMap[val] ? pre+styleIdMap[val]+post : m
    );
    ctx.defaultStyleTypes = ctx.defaultStyleTypes || {};
    let importedStylesXml = "";
    let normalStyleId = null, cellStyleId = null;
    const tblSpacingStyleIds = {};   // taulukkotyylit, jotka määräävät kappalevälin itse
    const stylesFile = zip.file("word/styles.xml");
    if (stylesFile){
      const stylesXmlSrc = await stylesFile.async("string");
      const stylesRootMatch = /^<w:styles\b[^>]*>/.exec(stylesXmlSrc.replace(/^\uFEFF?<\?xml[^>]*\?>\s*/, ""));
      if (stylesRootMatch) collectNamespaceDecls(stylesRootMatch[0]);
      const styleBlocks = extractTopLevelBlocks(stylesXmlSrc, "w:style");
      const srcById = {};
      styleBlocks.forEach(block => {
        const idMatch = /w:styleId="([^"]+)"/.exec(block);
        if (idMatch){ styleIdMap[idMatch[1]] = prefix + idMatch[1]; srcById[idMatch[1]] = block; }
      });

      // lähteen docDefaults (kappale- ja merkkimuotoilun oletukset)
      const ddMatch = /<w:docDefaults>[\s\S]*?<\/w:docDefaults>/.exec(stylesXmlSrc);
      const dd = ddMatch ? ddMatch[0] : "";
      const ddPPr = (/<w:pPrDefault>\s*<w:pPr>([\s\S]*?)<\/w:pPr>/.exec(dd) || ["",""])[1];
      const ddRPr = (/<w:rPrDefault>\s*<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(dd) || ["",""])[1];

      // määrääkö taulukkotyyli (tai sen perimä tyyli) itse kappalevälin?
      const chainHasSpacing = (id, seen) => {
        seen = seen || {};
        if (!id || seen[id] || !srcById[id]) return false;
        seen[id] = true;
        const blk = srcById[id].replace(/<w:tblStylePr\b[\s\S]*?<\/w:tblStylePr>/g, "");
        const pp = /<w:pPr>([\s\S]*?)<\/w:pPr>/.exec(blk);
        if (pp && /<w:spacing\b/.test(pp[1])) return true;
        const bo = /<w:basedOn\s+w:val="([^"]+)"/.exec(blk);
        return bo ? chainHasSpacing(bo[1], seen) : false;
      };

      importedStylesXml = styleBlocks.map(block => {
        const openTag = (/^<w:style\b[^>]*>/.exec(block) || [""])[0];
        const type = (/\sw:type="([^"]+)"/.exec(openTag) || [])[1];
        const oldId = (/\sw:styleId="([^"]+)"/.exec(openTag) || [])[1];
        const isDefault = /\sw:default="(?:1|true|on)"/.test(openTag);
        let b = block.replace(/w:styleId="([^"]+)"/, (m,id) => 'w:styleId="' + (styleIdMap[id] || id) + '"');
        b = remapStyleIds(b);
        let extra = "";
        let keepsName = false;
        if (type === "table" && oldId && chainHasSpacing(oldId)) tblSpacingStyleIds[styleIdMap[oldId]] = true;
        if (isDefault){
          if (type === "paragraph"){
            const res = buildDefaultParaStyles(b, ddPPr, ddRPr, prefix, importIdx);
            b = res.normal; extra = res.cell;
            normalStyleId = styleIdMap[oldId]; cellStyleId = prefix + "NormalCell";
          }
          // Samaa tyyppiä ei saa olla useaa oletustyyliä: hostilla on jo oletuskappaletyyli,
          // ja muiden tyyppien (taulukko, merkki, luettelo) oletus on se, joka tuli ensin.
          if (type === "paragraph" || ctx.defaultStyleTypes[type]){
            b = b.replace(/\sw:default="(?:1|true|on)"/, "");
          } else if (type){
            ctx.defaultStyleTypes[type] = true;
            keepsName = true;
          }
        }
        // Tyylin NIMI (w:name) tunnistetaan Wordissa ja LibreOfficessa nimen perusteella:
        // jos tuotu "heading 1" on samanniminen kuin hostin oma "heading 1", tyylit
        // sekoittuvat (esim. tuodun otsikon numerointi valuisi hostin otsikoihin).
        // Siksi kaikkiin tuotuihin tyyleihin lisätään tunniste, paitsi Normal-tyyliin
        // (nimetty jo buildDefaultParaStyles:ssa) ja ensimmäiseen oletustyyliin.
        if (!keepsName && !(type === "paragraph" && isDefault)){
          b = b.replace(/<w:name\s+w:val="([^"]*)"\s*\/>/, (m, n) => '<w:name w:val="' + n + ' (tuotu ' + importIdx + ')"/>');
        }
        return b + extra;
      }).join("");

      // Ei oletuskappaletyyliä lähteessä mutta docDefaults löytyy -> luodaan tyyli
      if (!normalStyleId && (ddPPr || ddRPr)){
        const fake = '<w:style w:type="paragraph" w:styleId="' + prefix + 'Normal"><w:name w:val="Normal"/></w:style>';
        const res = buildDefaultParaStyles(fake, ddPPr, ddRPr, prefix, importIdx);
        importedStylesXml += res.normal + res.cell;
        normalStyleId = prefix + "Normal"; cellStyleId = prefix + "NormalCell";
      }
      bodyInner = remapStyleIds(bodyInner);
    }

    // ---- numerointi: poimi, nimeä uudelleen ----
    // (tehdään ennen tyylien tallennusta, koska tyylien numPr/numId viittaa näihin)
    let numIdMap = {};
    const numberingFile = zip.file("word/numbering.xml");
    if (numberingFile){
      const numXmlSrc = await numberingFile.async("string");
      const numRootMatch = /^<w:numbering\b[^>]*>/.exec(numXmlSrc.replace(/^\uFEFF?<\?xml[^>]*\?>\s*/, ""));
      if (numRootMatch) collectNamespaceDecls(numRootMatch[0]);
      const absBlocks = extractTopLevelBlocks(numXmlSrc, "w:abstractNum");
      const numBlocks = extractTopLevelBlocks(numXmlSrc, "w:num");
      const absIdMap = {};
      const base = 9000 + importIdx * 500;
      absBlocks.forEach(b => {
        const m = /w:abstractNumId="([^"]+)"/.exec(b);
        if (m) absIdMap[m[1]] = String(base + parseInt(m[1], 10));
      });
      numBlocks.forEach(b => {
        const m = /w:numId="([^"]+)"/.exec(b);
        if (m) numIdMap[m[1]] = String(base + 200 + parseInt(m[1], 10));
      });
      const remappedAbs = absBlocks.map(b => {
        let o = b.replace(/w:abstractNumId="([^"]+)"/, (m,id) => 'w:abstractNumId="'+(absIdMap[id]||id)+'"');
        o = remapStyleIds(o); // lvl/pStyle (numeroidut otsikot), numStyleLink, styleLink
        // kuvaluettelomerkkejä (numPicBullet) ei tuoda -> poistetaan viittaukset niihin
        o = o.replace(/<w:lvlPicBulletId\b[^>]*\/>/g, "");
        return o;
      });
      const remappedNum = numBlocks.map(b => {
        let out = b.replace(/w:numId="([^"]+)"/, (m,id) => 'w:numId="'+(numIdMap[id]||id)+'"');
        out = out.replace(/(<w:abstractNumId\s+w:val=")([^"]+)(")/, (m,pre,val,post) => absIdMap[val] ? pre+absIdMap[val]+post : m);
        return out;
      });
      ctx.importedAbsDefs.push(remappedAbs.join(''));
      ctx.importedNumInstDefs.push(remappedNum.join(''));
    }
    const remapNumIds = str => str.replace(/(<w:numId\s+w:val=")([^"]+)(")/g,
      (m,pre,val,post) => numIdMap[val] ? pre+numIdMap[val]+post : m);

    // numId:t päivitetään SEKÄ rungossa ETTÄ tyylimäärityksissä
    importedStylesXml = remapNumIds(importedStylesXml);
    ctx.importedStyleDefs.push(importedStylesXml);
    bodyInner = remapNumIds(bodyInner);
    const tblNeedsCell = id => !!tblSpacingStyleIds[id];
    if (normalStyleId) bodyInner = addDefaultParaStyle(bodyInner, normalStyleId, cellStyleId, tblNeedsCell);

    // ---- teema (fontit/värit): vain ensimmäinen tuonti voittaa ----
    if (!ctx.theme.xml){
      const themeFile = zip.file("word/theme/theme1.xml");
      if (themeFile){
        ctx.theme.xml = await themeFile.async("string");
        const themeRid = ctx.relCounter.value++;
        ctx.relParts.push('<Relationship Id="rId'+themeRid+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>');
        ctx.contentTypeOverrides.push('<Override PartName="/word/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>');
      }
    }

    // ---- ylä-/alatunniste ----
    // "page"-tyyppinen tuonti (vakiotekstisivu) käyttää AINA sovelluksen
    // omaa vakioylä-/alatunnistetta (ctx.mainHeaderRefXml/mainFooterRefXml),
    // jotta sivu näyttää samalta kuin muutkin sivut -- lähdetiedoston OMAA
    // ylä-/alatunnistetta ei tuoda tähän. "cover"-tyyppinen tuonti (kansilehti)
    // säilyttää lähteensä oman ylä-/alatunnisteen (default + first) tai ei mitään.
    let headerRefXml = "", footerRefXml = "";
    if (label === "page"){
      headerRefXml = ctx.mainHeaderRefXml || "";
      footerRefXml = ctx.mainFooterRefXml || "";
    } else if (sourceSectPr){
      for (const kind of ["header", "footer"]){
        for (const rtype of ["default", "first"]){
          const refRe = new RegExp('<w:' + kind + 'Reference\\s+w:type="' + rtype + '"\\s+r:id="([^"]+)"');
          const rm = refRe.exec(sourceSectPr);
          if (!rm) continue;
          const info = docRels[rm[1]];
          if (!info) continue;
          const partPath = "word/" + info.target;
          const partFile = zip.file(partPath);
          if (!partFile) continue;
          let partXml = await partFile.async("string");
          const partRelsPath = "word/_rels/" + info.target.split("/").pop() + ".rels";
          const partRelsFile = zip.file(partRelsPath);
          const partRels = partRelsFile ? parseRelationships(await partRelsFile.async("string")) : {};
          const suffix = rtype === "first" ? "-first" : "";
          const partIdMap = await importMediaFromRels(partRels, "word/", "imp" + importIdx + "_" + kind + (rtype === "first" ? "f" : ""));
          partXml = remapRidsInXml(partXml, partIdMap);
          partXml = remapNumIds(remapStyleIds(partXml));
          if (normalStyleId) partXml = addDefaultParaStyle(partXml, normalStyleId, cellStyleId, tblNeedsCell);
          const partName = "imp-" + kind + importIdx + suffix + ".xml";
          ctx.headerFolderFiles.push({ name: partName, content: partXml });
          const partRid = ctx.relCounter.value++;
          ctx.relParts.push('<Relationship Id="rId'+partRid+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/'+kind+'" Target="'+partName+'"/>');
          ctx.contentTypeOverrides.push('<Override PartName="/word/'+partName+'" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.'+kind+'+xml"/>');
          const refXml = '<w:' + kind + 'Reference w:type="' + rtype + '" r:id="rId' + partRid + '"/>';
          if (kind === "header") headerRefXml += refXml; else footerRefXml += refXml;
        }
      }
    }

    // ---- siisti sectPr: sivukoko, marginaalit, palstat, sivun reunaviivat, pystytasaus,
    //      ruudukko (+ titlePg kansilehdelle) + mahd. oma ylä/alatunniste ----
    // Kentät kirjoitetaan OOXML-skeeman mukaisessa järjestyksessä.
    // titlePg jätetään pois "page"-tuonnista: muuten sivun ensimmäiseltä sivulta
    // puuttuisi sovelluksen vakioylätunniste. pgNumType (numeroinnin uudelleenaloitus)
    // jätetään pois, jotta tuotu sivu ei nollaa koko raportin sivunumerointia.
    const defaultSect = '<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417"/>';
    let cleanSectPr;
    if (sourceSectPr){
      const grab = tag => {
        const m = new RegExp('<w:' + tag + '\\b[^>]*?(?:\\/>|>[\\s\\S]*?<\\/w:' + tag + '>)').exec(sourceSectPr);
        return m ? m[0] : "";
      };
      const titlePg = (label === "cover") ? grab("titlePg") : "";
      cleanSectPr = '<w:sectPr>' + headerRefXml + footerRefXml +
        grab("pgSz") + grab("pgMar") + grab("pgBorders") + grab("cols") + grab("vAlign") + titlePg + grab("docGrid") +
        '</w:sectPr>';
    } else {
      cleanSectPr = '<w:sectPr>' + headerRefXml + footerRefXml + defaultSect + '</w:sectPr>';
    }

    return { bodyXml: bodyInner, sectPr: cleanSectPr };
  }

  function imageXml(rId, cx, cy, docPrId, align){
    const pPr = align ? '<w:pPr><w:jc w:val="' + align + '"/></w:pPr>' : "";
    return '<w:p>' + pPr + '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="'+cx+'" cy="'+cy+'"/><wp:docPr id="'+docPrId+'" name="Kuva'+docPrId+'"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="'+docPrId+'" name="Kuva'+docPrId+'"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId'+rId+'"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="'+cx+'" cy="'+cy+'"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
  }

  function pageNumberFieldXml(prefixText, align, opts){
    opts = opts || {};
    const rPr = [];
    if (opts.font) rPr.push(fontRpr(opts.font));
    if (opts.color) rPr.push('<w:color w:val="' + opts.color.replace("#","") + '"/>');
    if (opts.sz) rPr.push('<w:sz w:val="' + opts.sz + '"/><w:szCs w:val="' + opts.sz + '"/>');
    const rPrXml = rPr.length ? '<w:rPr>' + rPr.join('') + '</w:rPr>' : "";
    return '<w:p><w:pPr><w:jc w:val="' + (align||"center") + '"/></w:pPr>' +
      (prefixText ? '<w:r>' + rPrXml + '<w:t xml:space="preserve">' + xmlEsc(prefixText) + ' — Sivu </w:t></w:r>' : '<w:r>' + rPrXml + '<w:t xml:space="preserve">Sivu </w:t></w:r>') +
      '<w:fldSimple w:instr="PAGE"><w:r>' + rPrXml + '<w:t>1</w:t></w:r></w:fldSimple>' +
      '<w:r>' + rPrXml + '<w:t xml:space="preserve"> / </w:t></w:r>' +
      '<w:fldSimple w:instr="NUMPAGES"><w:r>' + rPrXml + '<w:t>1</w:t></w:r></w:fldSimple>' +
      '</w:p>';
  }

  function pageBreakXml(){
    return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
  }

  function tocFieldXml(variant, headingText){
    const switches = variant === "simple" ? '\\o "1-1" \\h \\n \\z' : '\\o "1-1" \\h \\z \\u';
    return paraXml(headingText || "Sisällysluettelo", { bold:true, sz:32 }) +
      '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
      '<w:r><w:instrText xml:space="preserve"> TOC ' + switches + ' </w:instrText></w:r>' +
      '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
      '<w:r><w:t xml:space="preserve">Napsauta hiiren kakkospainikkeella ja valitse "Päivitä kenttä" nähdäksesi sisällysluettelon.</w:t></w:r>' +
      '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>';
  }

  // rows: [[cellText,...], ...]; headerRowCount/headerColCount = kuinka monta ensimmäistä
  // riviä/saraketta lihavoidaan kiinteinä otsikkoina. cellOpts(rowIdx,colIdx) voi palauttaa
  // lisäasetuksia (esim. font/color) yksittäiselle solulle.
  function tableXml(rows, opts){
    opts = opts || {};
    const headerRowCount = opts.headerRowCount || 0;
    const headerColCount = opts.headerColCount || 0;
    const colCount = rows[0] ? rows[0].length : 0;
    const totalWidth = 9026;
    const rawColWidths = opts.colWidthPercents
      ? opts.colWidthPercents.map(p => Math.floor(totalWidth * p / 100))
      : Array.from({length:colCount}, () => Math.floor(totalWidth / (colCount||1)));

    // Pyöristys (ja opts.colWidthPercents-prosenttien pyöristys esim. 16+16+
    // 16+16+16+16=96) voi jättää sarakeleveydet summaamaan hieman alle
    // totalWidth:n. Ilman w:tblLayout="fixed" (ks. alla) Word saattaisi
    // silloin laskea sarakeleveydet UUDELLEEN sisällön perusteella, jolloin
    // otsikkosanat voivat pilkkoutua kirjain kerrallaan omille riveilleen.
    // Varmistetaan siis, että leveydet summaavat TÄSMÄLLEEN totalWidth:iin
    // (erotus lisätään viimeiseen sarakkeeseen).
    const colWidths = rawColWidths.slice();
    if (colWidths.length){
      const sum = colWidths.reduce((a,b) => a+b, 0);
      colWidths[colWidths.length-1] += (totalWidth - sum);
    }

    const gridCols = colWidths.map(w => '<w:gridCol w:w="'+w+'"/>').join('');
    const noBorders = !!opts.noBorders;
    const shade = opts.shadeHeaderCells !== false;

    const borderXml = noBorders
      ? '<w:tblBorders><w:top w:val="none" w:sz="0"/><w:left w:val="none" w:sz="0"/>' +
        '<w:bottom w:val="none" w:sz="0"/><w:right w:val="none" w:sz="0"/>' +
        '<w:insideH w:val="none" w:sz="0"/><w:insideV w:val="none" w:sz="0"/></w:tblBorders>'
      : '<w:tblBorders><w:top w:val="single" w:sz="4" w:color="B9B2A0"/><w:left w:val="single" w:sz="4" w:color="B9B2A0"/>' +
        '<w:bottom w:val="single" w:sz="4" w:color="B9B2A0"/><w:right w:val="single" w:sz="4" w:color="B9B2A0"/>' +
        '<w:insideH w:val="single" w:sz="4" w:color="B9B2A0"/><w:insideV w:val="single" w:sz="4" w:color="B9B2A0"/></w:tblBorders>';

    const trXml = rows.map((row, rIdx) => {
      const isHeaderRow = rIdx < headerRowCount;
      const tcXml = row.map((cellText, cIdx) => {
        const isHeaderCol = cIdx < headerColCount;
        const bold = isHeaderRow || isHeaderCol;
        const w = colWidths[cIdx] || Math.floor(totalWidth / (colCount||1));
        const p = paraXml(cellText || "", {
          align: "left", ind0: true,
          bold, font: opts.font, sz: opts.sz, color: (isHeaderCol && !isHeaderRow && opts.labelColor) ? opts.labelColor : opts.color
        });
        return '<w:tc><w:tcPr><w:tcW w:w="'+w+'" w:type="dxa"/>' +
          (bold && shade && !noBorders ? '<w:shd w:val="clear" w:color="auto" w:fill="F2EFE6"/>' : '') +
          '</w:tcPr>' + p + '</w:tc>';
      }).join('');
      return '<w:tr>' + tcXml + '</w:tr>';
    }).join('');

    // w:tblLayout type="fixed" + w:tblW type="dxa" (eikä "auto") pakottaa
    // Wordin käyttämään juuri näitä sarakeleveyksiä sellaisenaan, sen sijaan
    // että se laskisi ne uudelleen solujen sisällön perusteella. Ilman tätä
    // kapeat, moniriviset otsikkosolut (esim. "Paksuus (mm)") saattoivat
    // renderöityä lähes nollaleveinä, jolloin teksti pilkkoutui kirjain
    // kerrallaan omille riveilleen.
    return '<w:tbl>' +
      '<w:tblPr>' +
      '<w:tblW w:w="'+totalWidth+'" w:type="dxa"/>' +
      '<w:tblLayout w:type="fixed"/>' +
      '<w:tblCellMar>' +
      '<w:top w:w="70" w:type="dxa"/>' +
      '<w:left w:w="70" w:type="dxa"/>' +
      '<w:bottom w:w="70" w:type="dxa"/>' +
      '<w:right w:w="70" w:type="dxa"/>' +
      '</w:tblCellMar>' +
      borderXml +
      '</w:tblPr>' +
      '<w:tblGrid>' + gridCols + '</w:tblGrid>' +
      trXml + '</w:tbl>';
  }

  async function dataUrlToBlobAndDims(dataUrl){
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        fetch(dataUrl).then(r => r.blob()).then(blob => {
          resolve({ blob, w: img.naturalWidth, h: img.naturalHeight });
        }).catch(reject);
      };
      img.onerror = reject;
      img.src = dataUrl;
    });
  }

  function pxToEmu(px){ return Math.round(px * 9525); }

  function scaledDims(w, h, maxCxEmu, maxCyEmu){
    let cx = pxToEmu(w), cy = pxToEmu(h);
    let s = 1;
    if (cx > maxCxEmu) s = Math.min(s, maxCxEmu / cx);
    if (maxCyEmu && cy > maxCyEmu) s = Math.min(s, maxCyEmu / cy);
    if (s < 1){
      cx = Math.round(cx * s);
      cy = Math.round(cy * s);
    }
    return { cx, cy };
  }


  /* ---- Ylä-/alatunnisteen sisältö: 3 solun taulukko (vasen / keski / oikea) ---- */
  function hfCellXml(slot, align, o, ctx){
    const rPrXml = (function(){
      const r = [];
      if (o.font) r.push(fontRpr(o.font));
      if (o.color) r.push('<w:color w:val="' + o.color.replace("#","") + '"/>');
      if (o.sz) r.push('<w:sz w:val="' + o.sz + '"/><w:szCs w:val="' + o.sz + '"/>');
      return r.length ? '<w:rPr>' + r.join('') + '</w:rPr>' : "";
    })();
    const jc = '<w:pPr><w:jc w:val="' + align + '"/></w:pPr>';
    const run = t => '<w:r>' + rPrXml + '<w:t xml:space="preserve">' + xmlEsc(t) + '</w:t></w:r>';
    const fld = instr => '<w:fldSimple w:instr="' + instr + '"><w:r>' + rPrXml + '<w:t>1</w:t></w:r></w:fldSimple>';
    switch (slot.type){
      case "text":
        return '<w:p>' + jc + String(slot.text || "").split(/\r?\n/)
          .map((line,i) => (i>0 ? '<w:r>' + rPrXml + '<w:br/></w:r>' : "") + run(line)).join("") + '</w:p>';
      case "date": return '<w:p>' + jc + run(ctx.dateStr) + '</w:p>';
      case "page": return '<w:p>' + jc + run("Sivu ") + fld("PAGE") + '</w:p>';
      case "pageOf": return '<w:p>' + jc + run("Sivu ") + fld("PAGE") + run(" / ") + fld("NUMPAGES") + '</w:p>';
      case "title": return '<w:p>' + jc + run(ctx.title || "") + '</w:p>';
      case "logo":
        if (ctx.logo) return imageXml(ctx.logo.rId, ctx.logo.cx, ctx.logo.cy, ctx.logo.docPrId, align);
        return '<w:p>' + jc + '</w:p>';
      default: return '<w:p>' + jc + '</w:p>';
    }
  }

  function hfTableXml(cells){
    const w = 3024; // 3 x 3024 = 9072 twipin tekstialue (A4, 2,5 cm marginaalit)
    const none = '<w:tblBorders><w:top w:val="none" w:sz="0"/><w:left w:val="none" w:sz="0"/><w:bottom w:val="none" w:sz="0"/><w:right w:val="none" w:sz="0"/><w:insideH w:val="none" w:sz="0"/><w:insideV w:val="none" w:sz="0"/></w:tblBorders>';
    return '<w:tbl><w:tblPr><w:tblW w:w="' + (w*3) + '" w:type="dxa"/>' + none + '<w:tblLayout w:type="fixed"/>' +
      '<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="' + w + '"/><w:gridCol w:w="' + w + '"/><w:gridCol w:w="' + w + '"/></w:tblGrid><w:tr>' +
      cells.map(c => '<w:tc><w:tcPr><w:tcW w:w="' + w + '" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>' + c + '</w:tc>').join("") +
      '</w:tr></w:tbl>' +
      '<w:p><w:pPr><w:spacing w:before="0" w:after="0"/><w:rPr><w:sz w:val="2"/></w:rPr></w:pPr></w:p>';
  }

  /* -----------------------------------------------------------------------
     assembleDocx({ meta:{title}, bodyParts: [xmlString,...], style })
     bodyParts pitää rakentaa kutsujan puolella tämän moduulin paraXml/
     imageXml-funktioilla (käytä style.fonts.heading/body & style.colors.heading
     kutsuissa saadaksesi valitun ulkoasun).
     ----------------------------------------------------------------------- */
  async function assembleDocx({ meta, bodyParts, style, extraMedia }){
    style = mergeStyle(style);
    meta = meta || {};
    extraMedia = extraMedia || []; // [{ rId, name, blob }] -- kutsujan itse hallinnoimat sisältökuvat
    const relParts = [];
    const contentTypeOverrides = [];
    const mediaFiles = [];
    const headerFolderFiles = [];
    const headerRelsFiles = []; // [{ name:"header1.xml.rels", content }] -- ei enää käytössä (ks. ctx-tuonti), säilytetty taaksepäin yhteensopivuuden vuoksi
    let docPrCounter = 100;

    // Jaettu tila importDocxAsSection()-kutsuille (kansilehti + vakiotekstisivut,
    // jotka on ladattu valmiina .docx-tiedostoina): tyylit/numeroinnit/teema/media
    // kertyvät tänne ja kirjoitetaan pakettiin lopussa. relCounter.value on AINOA
    // rId-laskuri koko funktiossa (myös alla oleva host-koodi käyttää sitä), jotta
    // tuotu ja itse generoitu sisältö eivät koskaan saa samaa rId:tä.
    const importCtx = {
      relParts, contentTypeOverrides, mediaFiles, headerFolderFiles,
      relCounter: { value: 10 },
      importCounter: 0,
      importedStyleDefs: [],
      importedAbsDefs: [],
      importedNumInstDefs: [],
      defaultStyleTypes: {},
      extraDefaultExts: new Set(),
      extraNamespaces: {},
      theme: { xml: null }
    };

    extraMedia.forEach(m => {
      mediaFiles.push({ name: m.name, blob: m.blob });
      relParts.push('<Relationship Id="rId'+m.rId+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/'+m.name+'"/>');
    });

    let logoInfo = null;
    const hfUses = (hf, type) => !!(hf && hf.enabled && HF_KEYS.some(k => hf[k] && hf[k].type === type));
    if (style.coverPage && style.coverPage.logoDataUrl && (style.coverPage.enabled || hfUses(style.header, "logo") || hfUses(style.footer, "logo") || hfUses(style.coverHeader, "logo") || hfUses(style.coverFooter, "logo"))){
      try{
        logoInfo = await dataUrlToBlobAndDims(style.coverPage.logoDataUrl);
      }catch(e){ logoInfo = null; }
    }

    const finalBodyParts = [];
    let headerFooterSectPrExtra = "";

    // ---- Ylä-/alatunniste ----
    // Lasketaan TÄSSÄ (ennen kansilehteä/sivuja), jotta samat rId:t
    // (headerRefXml/footerRefXml) ovat käytettävissä myös silloin, kun
    // käyttäjä on ladannut vakiotekstisivuksi oman .docx-tiedoston --
    // muuten importDocxAsSection() käyttäisi tuodun tiedoston OMAA
    // ylä-/alatunnistetta (tai ei mitään), eivätkä ladatut sivut näyttäisi
    // samalta kuin sovelluksen muut sivut.
    let headerRefXml = "", footerRefXml = "";

    const hfDate = (function(){ const d = new Date(); return d.getDate() + "." + (d.getMonth()+1) + "." + d.getFullYear(); })();
    let hfLogoMediaAdded = false;
    // tag: "1" = pääsisältö, "2" = kansilehti, "3" = tyhjä (estää tunnisteen perimisen edelliseltä sectiolta)
    function buildHeaderFooterRef(kind, hf, tag){
      tag = tag || "1";
      const rId = importCtx.relCounter.value++;
      const fileName = kind + tag + ".xml";
      const o = { font: style.fonts.body, sz: pt2hp(hf.fontSize || 9), color: hf.color || "#7a7566" };
      const ctx = { title: meta.title || "", dateStr: hfDate, logo: null };
      let relsContent = "";
      if (logoInfo && HF_KEYS.some(k => hf[k].type === "logo")){
        const { cx, cy } = scaledDims(logoInfo.w, logoInfo.h, 900000, 600000);
        ctx.logo = { rId:1, cx, cy, docPrId: (kind === "header" ? 900 : 910) + Number(tag) };
        if (!hfLogoMediaAdded){ mediaFiles.push({ name:"header-logo.jpeg", blob: logoInfo.blob }); hfLogoMediaAdded = true; }
        relsContent = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/header-logo.jpeg"/></Relationships>';
      }
      const root = kind === "header" ? "w:hdr" : "w:ftr";
      const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<' + root +
        ' xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">' +
        hfTableXml(HF_KEYS.map(k => hfCellXml(hf[k], k, o, ctx))) + '</' + root + '>';
      headerFolderFiles.push({ name: fileName, content: xml });
      if (relsContent) headerRelsFiles.push({ name: fileName + ".rels", content: relsContent });
      relParts.push('<Relationship Id="rId' + rId + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/' + kind + '" Target="' + fileName + '"/>');
      contentTypeOverrides.push('<Override PartName="/word/' + fileName + '" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.' + kind + '+xml"/>');
      return '<w:' + kind + 'Reference w:type="default" r:id="rId' + rId + '"/>';
    }
    if (style.header && style.header.enabled) headerRefXml = buildHeaderFooterRef("header", style.header);
    if (style.footer && style.footer.enabled) footerRefXml = buildHeaderFooterRef("footer", style.footer);

    // Kansilehden OMA ylä-/alatunniste (vain sovelluksen generoimalle kansilehdelle).
    // Word perii puuttuvan tunnisteen edelliseltä sectiolta, joten jos kansilehdellä on
    // tunniste mutta pääsisällöllä ei, pääsisällölle luodaan tyhjä tunniste.
    let coverHeaderRefXml = "", coverFooterRefXml = "";
    if (style.coverPage && style.coverPage.enabled && style.coverPage.sourceMode !== "docx"){
      if (style.coverHeader && style.coverHeader.enabled) coverHeaderRefXml = buildHeaderFooterRef("header", style.coverHeader, "2");
      if (style.coverFooter && style.coverFooter.enabled) coverFooterRefXml = buildHeaderFooterRef("footer", style.coverFooter, "2");
    }
    const blankHF = { fontSize:9, color:"#7a7566", left:emptySlot(), center:emptySlot(), right:emptySlot() };
    if (coverHeaderRefXml && !headerRefXml) headerRefXml = buildHeaderFooterRef("header", blankHF, "3");
    if (coverFooterRefXml && !footerRefXml) footerRefXml = buildHeaderFooterRef("footer", blankHF, "3");

    // Sivukohtaisesti tuoduille vakiotekstisivuille (importDocxAsSection,
    // label "page") jaettavat samat viittaukset, ks. kommentti kohdassa
    // "---- ylä-/alatunniste ----" tuonnin sisällä.
    importCtx.mainHeaderRefXml = headerRefXml;
    importCtx.mainFooterRefXml = footerRefXml;

    // ---- Kansilehti (oma sectio; jos ladattu .docx, käyttää sen omaa sivukokoa/marginaaleja/ylä-alatunnistetta) ----
    if (style.coverPage && style.coverPage.enabled){
      const coverParts = [];
      let coverSectPr = null;
      if (style.coverPage.sourceMode === "docx"){
        if (style.coverPage._docxBytes){
          try{
            const imported = await importDocxAsSection(style.coverPage._docxBytes, importCtx, "cover");
            coverParts.push(imported.bodyXml);
            coverSectPr = imported.sectPr;
          } catch(e){
            coverParts.push(paraXml("", { after:1200 }));
            coverParts.push(paraXml("Kansilehden liitetiedostoa (" + (style.coverPage.docxFileName || "ladattu .docx") + ") ei voitu lukea: " + (e && e.message || e), {
              align:"center", italic:true, font: style.fonts.body, color:"A13030"
            }));
          }
        } else {
          coverParts.push(paraXml("", { after:1200 }));
          coverParts.push(paraXml("Kansilehden liitetiedostoa (" + (style.coverPage.docxFileName || "ladattu .docx") + ") ei saatu haettua.", {
            align:"center", italic:true, font: style.fonts.body, color:"A13030"
          }));
        }
      } else {
        coverParts.push(paraXml("", { after:1200 }));
        if (logoInfo){
          const maxCx = 3200000;
          const { cx, cy } = scaledDims(logoInfo.w, logoInfo.h, maxCx);
          const rId = importCtx.relCounter.value++;
          mediaFiles.push({ name:"logo.jpeg", blob: logoInfo.blob });
          relParts.push('<Relationship Id="rId'+rId+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/logo.jpeg"/>');
          coverParts.push(imageXml(rId, cx, cy, docPrCounter++, "center"));
          coverParts.push(paraXml("", { after:400 }));
        }
        coverParts.push(paraXml(style.coverPage.title || meta.title || "Lomake", {
          bold:true, sz:56, align:"center", font: style.fonts.heading, color: style.colors.heading, after:120,
          bottomBorder: style.coverPage.accentColor ? { color: style.coverPage.accentColor, sz:20 } : null
        }));
        if (style.coverPage.subtitle){
          coverParts.push(paraXml(style.coverPage.subtitle, {
            sz:26, align:"center", font: style.fonts.body, color: style.colors.body, after:120
          }));
        }
        if (style.coverPage.companyInfo){
          coverParts.push(paraXml("", { after:800 }));
          coverParts.push(paraXml(style.coverPage.companyInfo, {
            sz:18, align:"center", font: style.fonts.body, color:"7A7566"
          }));
        }
      }
      finalBodyParts.push(...coverParts);

      // Sectionin päätös: ladatulla sivulla sen OMA sivukoko/marginaalit (ja ylä-/alatunniste,
      // jos sillä oli sellainen); generoidulla kansilehdellä ennallaan puhdas, ilman ylä/alatunnistetta.
      finalBodyParts.push(
        '<w:p><w:pPr>' + (coverSectPr || '<w:sectPr>' + coverHeaderRefXml + coverFooterRefXml + '<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417"/></w:sectPr>') + '</w:pPr></w:p>'
      );
    }

    // ---- Pääsisältö (kansilehden jälkeen: TOC, ennen-sivut, itse lomake, jälkeen-sivut) ----
    if (style.toc && style.toc.enabled){
      finalBodyParts.push(tocFieldXml(style.toc.variant));
      finalBodyParts.push(pageBreakXml());
    }
    for (const page of (style.pagesBefore || [])){
      finalBodyParts.push(paraXml(page.title || "Sivu", {
        bold:true, sz: pt2hp(style.fonts.headingSize), font: style.fonts.heading, color: style.colors.heading,
        pStyle:"Heading1", noNum:true, after:160
      }));
      if (page.sourceMode === "docx"){
        if (page._docxBytes){
          try{
            const imported = await importDocxAsSection(page._docxBytes, importCtx, "page");
            finalBodyParts.push(imported.bodyXml);
            // Oma sectio säilyttää sivun alkuperäisen sivukoon/marginaalit/ylä-alatunnisteen.
            finalBodyParts.push('<w:p><w:pPr>' + imported.sectPr + '</w:pPr></w:p>');
          } catch(e){
            finalBodyParts.push(paraXml("Sivun liitetiedostoa (" + (page.docxFileName || "ladattu .docx") + ") ei voitu lukea: " + (e && e.message || e), {
              italic:true, font: style.fonts.body, color:"A13030"
            }));
            finalBodyParts.push(pageBreakXml());
          }
        } else {
          finalBodyParts.push(paraXml("Sivun liitetiedostoa (" + (page.docxFileName || "ladattu .docx") + ") ei saatu haettua.", {
            italic:true, font: style.fonts.body, color:"A13030"
          }));
          finalBodyParts.push(pageBreakXml());
        }
      } else {
        finalBodyParts.push(...renderPageBlocks(normalizePage(page), style));
        finalBodyParts.push(pageBreakXml());
      }
    }

    finalBodyParts.push(...bodyParts);

    for (const page of (style.pagesAfter || [])){
      finalBodyParts.push(pageBreakXml());
      finalBodyParts.push(paraXml(page.title || "Sivu", {
        bold:true, sz: pt2hp(style.fonts.headingSize), font: style.fonts.heading, color: style.colors.heading,
        pStyle:"Heading1", noNum:true, after:160
      }));
      if (page.sourceMode === "docx"){
        if (page._docxBytes){
          try{
            const imported = await importDocxAsSection(page._docxBytes, importCtx, "page");
            finalBodyParts.push(imported.bodyXml);
            finalBodyParts.push('<w:p><w:pPr>' + imported.sectPr + '</w:pPr></w:p>');
          } catch(e){
            finalBodyParts.push(paraXml("Sivun liitetiedostoa (" + (page.docxFileName || "ladattu .docx") + ") ei voitu lukea: " + (e && e.message || e), {
              italic:true, font: style.fonts.body, color:"A13030"
            }));
          }
        } else {
          finalBodyParts.push(paraXml("Sivun liitetiedostoa (" + (page.docxFileName || "ladattu .docx") + ") ei saatu haettua.", {
            italic:true, font: style.fonts.body, color:"A13030"
          }));
        }
      } else {
        finalBodyParts.push(...renderPageBlocks(normalizePage(page), style));
      }
    }

    // (headerRefXml/footerRefXml laskettu jo funktion alussa, ks. yllä.)

    const finalSectPr = '<w:sectPr>' + headerRefXml + footerRefXml +
      '<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417"/></w:sectPr>';

    function nsAttrsExcluding(exclude){
      return Object.keys(importCtx.extraNamespaces)
        .filter(p => exclude.indexOf(p) === -1)
        .map(p => ' xmlns:' + p + '="' + xmlEsc(importCtx.extraNamespaces[p]) + '"').join('');
    }
    const extraNsAttrs = nsAttrsExcluding(["w","wp","r"]);

    const documentXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
      'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"' + extraNsAttrs + '>' +
      '<w:body>' + finalBodyParts.join('') + finalSectPr + '</w:body></w:document>';

    const numOn = !(style.headingNumbering && style.headingNumbering.enabled === false);
    const hnum = lvl => numOn ? '<w:numPr>' + (lvl ? '<w:ilvl w:val="' + lvl + '"/>' : '') + '<w:numId w:val="3"/></w:numPr>' : '';
    const stylesXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"' + nsAttrsExcluding(["w"]) + '>' +
      '<w:docDefaults><w:rPrDefault><w:rPr>' + fontRpr(style.fonts.body) + '<w:color w:val="' + (style.colors.body||"#1c2430").replace("#","") + '"/><w:sz w:val="' + pt2hp(style.fonts.bodySize||10.5) + '"/></w:rPr></w:rPrDefault></w:docDefaults>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:qFormat/>' +
      '<w:pPr>' + hnum(0) + '<w:outlineLvl w:val="0"/></w:pPr>' +
      '<w:rPr>' + fontRpr(style.fonts.heading) + '<w:b/><w:color w:val="' + (style.colors.heading||"#233043").replace("#","") + '"/><w:sz w:val="' + pt2hp(style.fonts.headingSize||14) + '"/></w:rPr>' +
      '</w:style>' +
      '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:qFormat/>' +
      '<w:pPr>' + hnum(1) + '<w:outlineLvl w:val="1"/></w:pPr>' +
      '<w:rPr>' + fontRpr(style.fonts.heading) + '<w:b/><w:color w:val="' + (style.colors.heading||"#233043").replace("#","") + '"/><w:sz w:val="' + pt2hp(style.fonts.subheadingSize||11) + '"/></w:rPr>' +
      '</w:style>' +
      '<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:qFormat/>' +
      '<w:pPr>' + hnum(2) + '<w:outlineLvl w:val="2"/></w:pPr>' +
      '<w:rPr>' + fontRpr(style.fonts.heading) + '<w:b/><w:color w:val="' + (style.colors.heading||"#233043").replace("#","") + '"/><w:sz w:val="' + pt2hp(style.fonts.subheadingSize||11) + '"/></w:rPr>' +
      '</w:style>' +
      importCtx.importedStyleDefs.join('') +
      '</w:styles>';

    const contentTypesXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Default Extension="jpeg" ContentType="image/jpeg"/>' +
      Array.from(importCtx.extraDefaultExts).filter(ext => ext !== "jpeg" && ext !== "jpg").map(ext =>
        '<Default Extension="' + ext + '" ContentType="' + (EXT_CONTENT_TYPES[ext] || "application/octet-stream") + '"/>'
      ).join('') +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
      contentTypeOverrides.join('') + '</Types>';

    const rootRelsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
      '</Relationships>';

    const docRelsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '<Relationship Id="rId8" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>' +
      relParts.join('') + '</Relationships>';

    const coreXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">' +
      '<dc:title>' + xmlEsc(meta.title || "Lomake") + '</dc:title></cp:coreProperties>';

    const appXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Kenttalomake</Application></Properties>';

    const zip = new JSZip();
    zip.file("[Content_Types].xml", contentTypesXml);
    zip.folder("_rels").file(".rels", rootRelsXml);
    const wordFolder = zip.folder("word");
    wordFolder.file("document.xml", documentXml);
    wordFolder.file("styles.xml", stylesXml);
    wordFolder.file("numbering.xml", numberingXml(importCtx.importedAbsDefs.join(''), importCtx.importedNumInstDefs.join(''), nsAttrsExcluding(["w"])));
    wordFolder.folder("_rels").file("document.xml.rels", docRelsXml);
    headerFolderFiles.forEach(f => wordFolder.file(f.name, f.content));
    if (headerRelsFiles.length){
      const wordRels = wordFolder.folder("_rels");
      headerRelsFiles.forEach(f => wordRels.file(f.name, f.content));
    }
    if (mediaFiles.length){
      const mediaFolder = wordFolder.folder("media");
      mediaFiles.forEach(m => mediaFolder.file(m.name, m.blob));
    }
    if (importCtx.theme.xml){
      wordFolder.folder("theme").file("theme1.xml", importCtx.theme.xml);
    }
    zip.folder("docProps").file("core.xml", coreXml);
    zip.folder("docProps").file("app.xml", appXml);

    return zip.generateAsync({ type:"blob", mimeType:"application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  }

  return { defaultStyle, FONT_CHOICES, xmlEsc, paraXml, imageXml, pageBreakXml, tocFieldXml, tableXml, pxToEmu, scaledDims, pt2hp, assembleDocx, normalizePage, mergeStyle, HF_SLOT_TYPES, runsPlain };
})();
