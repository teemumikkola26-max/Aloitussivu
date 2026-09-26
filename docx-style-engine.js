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
     header: { enabled, text, showDate, align, showLogo, fontSize, color },
     footer: { enabled, text, showPageNumber, align, fontSize, color },
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
      header: { enabled:false, text:"", showDate:false, align:"left", showLogo:false, fontSize:9, color:"#7a7566" },
      footer: { enabled:false, text:"", showPageNumber:true, align:"center", fontSize:9, color:"#7a7566" },
      fonts: { heading:"Calibri", body:"Calibri", headingSize:14, bodySize:10.5 },
      colors: { heading:"#233043", body:"#1c2430" },
      toc: { enabled:false, variant:"classic" },
      pagesBefore: [],
      pagesAfter: []
    };
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
          bold:true, sz: pt2hp(Math.max(10, (style.fonts.headingSize||14) - 3)), font: style.fonts.heading,
          color: b.color || style.colors.heading, before:120, after:80
        }));
      } else if (type === "bullets" || type === "numbered"){
        const items = (b.items || []).filter(s => s != null && String(s).trim() !== "");
        items.forEach(item => {
          parts.push(paraXml(item, {
            font: style.fonts.body, sz: pt2hp(style.fonts.bodySize), color: b.color || style.colors.body,
            numId: type === "bullets" ? 1 : 2, after:40
          }));
        });
      } else {
        // paragraph (myös vanhojen tallenteiden migroitu content-teksti)
        if (b.text) {
          parts.push(paraXml(b.text, {
            font: style.fonts.body, sz: pt2hp(style.fonts.bodySize), color: b.color || style.colors.body, after:100
          }));
        }
      }
    });
    return parts;
  }

  const FONT_CHOICES = ["Calibri","Arial","Georgia","Times New Roman","Verdana","Cambria","Tahoma"];

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
  //       numId: 1 (luettelomerkki) tai 2 (numeroitu) -- ks. numberingXml(); ilvl: sisennystaso (0 = ensimmäinen)
  function paraXml(text, opts){
    opts = opts || {};
    const rPr = [];
    if (opts.font) rPr.push(fontRpr(opts.font));
    if (opts.bold) rPr.push("<w:b/>");
    if (opts.italic) rPr.push("<w:i/>");
    if (opts.color) rPr.push('<w:color w:val="' + opts.color.replace("#","") + '"/>');
    if (opts.sz) rPr.push('<w:sz w:val="' + opts.sz + '"/><w:szCs w:val="' + opts.sz + '"/>');
    // OOXML-skeeman mukainen pPr-lasten järjestys: pStyle, numPr, pBdr, spacing, jc
    const pPr = [];
    if (opts.pStyle) pPr.push('<w:pStyle w:val="' + xmlEsc(opts.pStyle) + '"/>');
    if (opts.numId){
      pPr.push('<w:numPr><w:ilvl w:val="' + (opts.ilvl || 0) + '"/><w:numId w:val="' + opts.numId + '"/></w:numPr>');
    }
    if (opts.bottomBorder){
      pPr.push('<w:pBdr><w:bottom w:val="single" w:sz="' + (opts.bottomBorder.sz||16) + '" w:space="4" w:color="' + opts.bottomBorder.color.replace("#","") + '"/></w:pBdr>');
    }
    if (opts.before || opts.after){
      pPr.push('<w:spacing' + (opts.before?' w:before="'+opts.before+'"':'') + (opts.after?' w:after="'+opts.after+'"':'') + '/>');
    }
    if (opts.align) pPr.push('<w:jc w:val="' + opts.align + '"/>');
    const lines = String(text == null ? "" : text).split(/\r?\n/);
    const runs = lines.map((line,i) => (i>0?"<w:br/>":"") + '<w:t xml:space="preserve">' + xmlEsc(line) + '</w:t>').join("");
    return '<w:p>' + (pPr.length?'<w:pPr>'+pPr.join('')+'</w:pPr>':'') + '<w:r>' + (rPr.length?'<w:rPr>'+rPr.join('')+'</w:rPr>':'') + runs + '</w:r></w:p>';
  }

  /*
   * Kiinteä numerointimääritelmä: numId=1 luettelomerkeille (•),
   * numId=2 numeroidulle listalle (1. 2. 3. ...). Sisällytetään aina
   * dokumenttiin -- ei haittaa vaikka mitään listaa ei käytettäisi.
   * extraXml: tuodusta .docx-liitteestä poimitut (uudelleennimetyt)
   * abstractNum/num-määritelmät, jotka lisätään perään.
   */
  function numberingXml(extraXml){
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/>' +
      '<w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="432" w:hanging="432"/></w:pPr>' +
      '<w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol" w:hint="default"/></w:rPr></w:lvl></w:abstractNum>' +
      '<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/>' +
      '<w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="432" w:hanging="432"/></w:pPr></w:lvl></w:abstractNum>' +
      '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>' +
      '<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>' +
      (extraXml || '') +
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
   * headerRelsFiles, importedStyleDefs, importedNumDefs, extraDefaultExts
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
    let importedStylesXml = "";
    const stylesFile = zip.file("word/styles.xml");
    if (stylesFile){
      const stylesXmlSrc = await stylesFile.async("string");
      const styleBlocks = extractTopLevelBlocks(stylesXmlSrc, "w:style");
      const prefix = "imp" + importIdx + "_";
      styleBlocks.forEach(block => {
        const idMatch = /w:styleId="([^"]+)"/.exec(block);
        if (idMatch) styleIdMap[idMatch[1]] = prefix + idMatch[1];
      });
      const remapStyleRef = s => s.replace(
        /(<w:(?:pStyle|rStyle|tblStyle|tblStylePr|basedOn|next|link|numStyleLink|styleLink)\s+w:val=")([^"]+)(")/g,
        (m,pre,val,post) => styleIdMap[val] ? pre+styleIdMap[val]+post : m
      );
      importedStylesXml = styleBlocks.map(block => {
        let b = block.replace(/w:styleId="([^"]+)"/, (m,id) => 'w:styleId="' + (styleIdMap[id] || id) + '"');
        return remapStyleRef(b);
      }).join('');
      bodyInner = bodyInner.replace(
        /(<w:(?:pStyle|rStyle|tblStyle|numStyleLink|styleLink)\s+w:val=")([^"]+)(")/g,
        (m,pre,val,post) => styleIdMap[val] ? pre+styleIdMap[val]+post : m
      );
    }
    ctx.importedStyleDefs.push(importedStylesXml);

    // ---- numerointi: poimi, nimeä uudelleen ----
    let importedNumXml = "";
    const numberingFile = zip.file("word/numbering.xml");
    if (numberingFile){
      const numXmlSrc = await numberingFile.async("string");
      const absBlocks = extractTopLevelBlocks(numXmlSrc, "w:abstractNum");
      const numBlocks = extractTopLevelBlocks(numXmlSrc, "w:num");
      const absIdMap = {}, numIdMap = {};
      const base = 9000 + importIdx * 500;
      absBlocks.forEach(b => {
        const m = /w:abstractNumId="([^"]+)"/.exec(b);
        if (m) absIdMap[m[1]] = String(base + parseInt(m[1], 10));
      });
      numBlocks.forEach(b => {
        const m = /w:numId="([^"]+)"/.exec(b);
        if (m) numIdMap[m[1]] = String(base + 200 + parseInt(m[1], 10));
      });
      const remappedAbs = absBlocks.map(b => b.replace(/w:abstractNumId="([^"]+)"/, (m,id) => 'w:abstractNumId="'+(absIdMap[id]||id)+'"'));
      const remappedNum = numBlocks.map(b => {
        let out = b.replace(/w:numId="([^"]+)"/, (m,id) => 'w:numId="'+(numIdMap[id]||id)+'"');
        out = out.replace(/(<w:abstractNumId\s+w:val=")([^"]+)(")/, (m,pre,val,post) => absIdMap[val] ? pre+absIdMap[val]+post : m);
        return out;
      });
      importedNumXml = remappedAbs.join('') + remappedNum.join('');
      bodyInner = bodyInner.replace(/(<w:numId\s+w:val=")([^"]+)(")/g, (m,pre,val,post) => numIdMap[val] ? pre+numIdMap[val]+post : m);
    }
    ctx.importedNumDefs.push(importedNumXml);

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

    // ---- ylä-/alatunniste (vain koko tuodun sivun sulkevasta sectPr:stä) ----
    let headerRefXml = "", footerRefXml = "";
    if (sourceSectPr){
      const hRefMatch = /<w:headerReference\s+w:type="default"\s+r:id="([^"]+)"/.exec(sourceSectPr);
      const fRefMatch = /<w:footerReference\s+w:type="default"\s+r:id="([^"]+)"/.exec(sourceSectPr);
      for (const ref of [{ m:hRefMatch, kind:"header", tag:"hdr" }, { m:fRefMatch, kind:"footer", tag:"ftr" }]){
        if (!ref.m) continue;
        const info = docRels[ref.m[1]];
        if (!info) continue;
        const partPath = "word/" + info.target;
        const partFile = zip.file(partPath);
        if (!partFile) continue;
        let partXml = await partFile.async("string");
        const partRelsPath = "word/_rels/" + info.target.split("/").pop() + ".rels";
        const partRelsFile = zip.file(partRelsPath);
        const partRels = partRelsFile ? parseRelationships(await partRelsFile.async("string")) : {};
        const partIdMap = await importMediaFromRels(partRels, "word/", "imp" + importIdx + "_" + ref.kind);
        partXml = remapRidsInXml(partXml, partIdMap);
        if (Object.keys(styleIdMap).length){
          partXml = partXml.replace(
            /(<w:(?:pStyle|rStyle)\s+w:val=")([^"]+)(")/g,
            (m,pre,val,post) => styleIdMap[val] ? pre+styleIdMap[val]+post : m
          );
        }
        const partName = "imp-" + ref.kind + importIdx + ".xml";
        ctx.headerFolderFiles.push({ name: partName, content: partXml });
        const partRid = ctx.relCounter.value++;
        ctx.relParts.push('<Relationship Id="rId'+partRid+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/'+ref.kind+'" Target="'+partName+'"/>');
        ctx.contentTypeOverrides.push('<Override PartName="/word/'+partName+'" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.'+ref.kind+'+xml"/>');
        if (ref.kind === "header") headerRefXml = '<w:headerReference w:type="default" r:id="rId'+partRid+'"/>';
        else footerRefXml = '<w:footerReference w:type="default" r:id="rId'+partRid+'"/>';
      }
    }

    // ---- siisti sectPr: vain sivukoko/marginaalit/suunta + mahd. oma ylä/alatunniste ----
    let cleanSectPr;
    if (sourceSectPr){
      const pgSz = (/<w:pgSz\b[^/]*\/>/.exec(sourceSectPr) || [''])[0];
      const pgMar = (/<w:pgMar\b[^/]*\/>/.exec(sourceSectPr) || [''])[0];
      cleanSectPr = '<w:sectPr>' + headerRefXml + footerRefXml + pgSz + pgMar + '</w:sectPr>';
    } else {
      cleanSectPr = '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417"/></w:sectPr>';
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
    const colWidths = opts.colWidthPercents
      ? opts.colWidthPercents.map(p => Math.floor(totalWidth * p / 100))
      : Array.from({length:colCount}, () => Math.floor(totalWidth / (colCount||1)));

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
          bold, font: opts.font, sz: opts.sz, color: (isHeaderCol && !isHeaderRow && opts.labelColor) ? opts.labelColor : opts.color
        });
        return '<w:tc><w:tcPr><w:tcW w:w="'+w+'" w:type="dxa"/>' +
          (bold && shade && !noBorders ? '<w:shd w:val="clear" w:color="auto" w:fill="F2EFE6"/>' : '') +
          '</w:tcPr>' + p + '</w:tc>';
      }).join('');
      return '<w:tr>' + tcXml + '</w:tr>';
    }).join('');

    return '<w:tbl>' +
      '<w:tblPr><w:tblW w:w="0" w:type="auto"/>' + borderXml + '</w:tblPr>' +
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

  function scaledDims(w, h, maxCxEmu){
    let cx = pxToEmu(w), cy = pxToEmu(h);
    if (cx > maxCxEmu){
      const s = maxCxEmu / cx;
      cx = Math.round(cx * s);
      cy = Math.round(cy * s);
    }
    return { cx, cy };
  }

  /* -----------------------------------------------------------------------
     assembleDocx({ meta:{title}, bodyParts: [xmlString,...], style })
     bodyParts pitää rakentaa kutsujan puolella tämän moduulin paraXml/
     imageXml-funktioilla (käytä style.fonts.heading/body & style.colors.heading
     kutsuissa saadaksesi valitun ulkoasun).
     ----------------------------------------------------------------------- */
  async function assembleDocx({ meta, bodyParts, style, extraMedia }){
    style = style || defaultStyle();
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
      importedNumDefs: [],
      extraDefaultExts: new Set(),
      theme: { xml: null }
    };

    extraMedia.forEach(m => {
      mediaFiles.push({ name: m.name, blob: m.blob });
      relParts.push('<Relationship Id="rId'+m.rId+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/'+m.name+'"/>');
    });

    let logoInfo = null;
    if (style.coverPage && style.coverPage.logoDataUrl && (style.coverPage.enabled || (style.header && style.header.showLogo))){
      try{
        logoInfo = await dataUrlToBlobAndDims(style.coverPage.logoDataUrl);
      }catch(e){ logoInfo = null; }
    }

    const finalBodyParts = [];
    let headerFooterSectPrExtra = "";

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
        '<w:p><w:pPr>' + (coverSectPr || '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417"/></w:sectPr>') + '</w:pPr></w:p>'
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
        pStyle:"Heading1", after:160
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
        pStyle:"Heading1", after:160
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

    // ---- Ylä-/alatunniste ----
    let headerRefXml = "", footerRefXml = "";

    if (style.header && style.header.enabled){
      const rId = importCtx.relCounter.value++;
      let headerText = style.header.text || "";
      if (style.header.showDate){
        const d = new Date();
        const dateStr = d.getDate() + "." + (d.getMonth()+1) + "." + d.getFullYear();
        headerText = headerText ? headerText + " — " + dateStr : dateStr;
      }
      const headerAlign = style.header.align || "left";
      let headerBodyXml = "";
      let headerRelsContent = "";

      if (style.header.showLogo && logoInfo){
        const maxCx = 900000; // pieni logo ylätunnisteessa
        const { cx, cy } = scaledDims(logoInfo.w, logoInfo.h, maxCx);
        mediaFiles.push({ name:"header-logo.jpeg", blob: logoInfo.blob });
        // Ylätunnisteen kuvaviittaukset käyttävät OMAA rels-tiedostoaan (header1.xml.rels),
        // joten rId1 tässä ei törmää dokumentin muihin rId:eihin.
        headerRelsContent = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/header-logo.jpeg"/></Relationships>';
        headerBodyXml += imageXml(1, cx, cy, 900, headerAlign);
      }
      headerBodyXml += paraXml(headerText, {
        font: style.fonts.body, sz: pt2hp(style.header.fontSize || 9), color: (style.header.color || "#7a7566"), align: headerAlign
      });

      const headerXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">' +
        headerBodyXml + '</w:hdr>';
      headerFolderFiles.push({ name:"header1.xml", content: headerXml });
      if (headerRelsContent) headerRelsFiles.push({ name:"header1.xml.rels", content: headerRelsContent });
      relParts.push('<Relationship Id="rId'+rId+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>');
      contentTypeOverrides.push('<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>');
      headerRefXml = '<w:headerReference w:type="default" r:id="rId'+rId+'"/>';
    }
    if (style.footer && style.footer.enabled){
      const rId = importCtx.relCounter.value++;
      const footerAlign = style.footer.align || "center";
      const footerFontOpts = { font: style.fonts.body, sz: pt2hp(style.footer.fontSize || 9), color: (style.footer.color || "#7a7566") };
      let footerXml;
      if (style.footer.showPageNumber){
        footerXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
          pageNumberFieldXml(style.footer.text || "", footerAlign, footerFontOpts) + '</w:ftr>';
      } else {
        footerXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
          paraXml(style.footer.text || "", Object.assign({ align:footerAlign }, footerFontOpts)) + '</w:ftr>';
      }
      headerFolderFiles.push({ name:"footer1.xml", content: footerXml });
      relParts.push('<Relationship Id="rId'+rId+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>');
      contentTypeOverrides.push('<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>');
      footerRefXml = '<w:footerReference w:type="default" r:id="rId'+rId+'"/>';
    }

    const finalSectPr = '<w:sectPr>' + headerRefXml + footerRefXml +
      '<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417"/></w:sectPr>';

    const documentXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
      'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<w:body>' + finalBodyParts.join('') + finalSectPr + '</w:body></w:document>';

    const stylesXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:docDefaults><w:rPrDefault><w:rPr>' + fontRpr(style.fonts.body) + '<w:color w:val="' + (style.colors.body||"#1c2430").replace("#","") + '"/><w:sz w:val="' + pt2hp(style.fonts.bodySize||10.5) + '"/></w:rPr></w:rPrDefault></w:docDefaults>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:qFormat/>' +
      '<w:pPr><w:outlineLvl w:val="0"/></w:pPr>' +
      '<w:rPr>' + fontRpr(style.fonts.heading) + '<w:b/><w:color w:val="' + (style.colors.heading||"#233043").replace("#","") + '"/><w:sz w:val="' + pt2hp(style.fonts.headingSize||14) + '"/></w:rPr>' +
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
    wordFolder.file("numbering.xml", numberingXml(importCtx.importedNumDefs.join('')));
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

  return { defaultStyle, FONT_CHOICES, xmlEsc, paraXml, imageXml, pageBreakXml, tocFieldXml, tableXml, pxToEmu, scaledDims, pt2hp, assembleDocx, normalizePage };
})();
