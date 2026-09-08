"use strict";
/* =========================================================================
   DOCX-STYLE-ENGINE.JS
   Jaettu OOXML-generointimoottori .docx-vientiin. Käytetään kaikista
   lomakkeista (kuntotarkastus.html, kuntoarvio.html, form-runtime.js).
   Vaatii JSZipin ladatuksi ennen tätä tiedostoa.

   TYYLIOBJEKTIN MUOTO (tallennetaan Supabasen doc_styles-tauluun):
   {
     coverPage: { enabled, title, subtitle, logoDataUrl, accentColor, companyInfo },
     header: { enabled, text, showDate, align, showLogo },
     footer: { enabled, text, showPageNumber, align },
     fonts: { heading, body, headingSize, bodySize },
     colors: { heading, body },
     toc: { enabled, variant: "classic"|"simple" },
     pagesBefore: [ { id, title, content } ],   // vakiotekstisivut ennen lomakkeen sisältöä
     pagesAfter:  [ { id, title, content } ]    // vakiotekstisivut lomakkeen sisällön jälkeen
   }
   ========================================================================= */
window.DocxStyleEngine = (function(){

  function defaultStyle(){
    return {
      coverPage: { enabled:false, title:"", subtitle:"", logoDataUrl:"", accentColor:"#8fb79c", companyInfo:"" },
      header: { enabled:false, text:"", showDate:false, align:"left", showLogo:false },
      footer: { enabled:false, text:"", showPageNumber:true, align:"center" },
      fonts: { heading:"Calibri", body:"Calibri", headingSize:14, bodySize:10.5 },
      colors: { heading:"#233043", body:"#1c2430" },
      toc: { enabled:false, variant:"classic" },
      pagesBefore: [],
      pagesAfter: []
    };
  }

  const FONT_CHOICES = ["Calibri","Arial","Georgia","Times New Roman","Verdana","Cambria","Tahoma"];

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
  function paraXml(text, opts){
    opts = opts || {};
    const rPr = [];
    if (opts.font) rPr.push(fontRpr(opts.font));
    if (opts.bold) rPr.push("<w:b/>");
    if (opts.italic) rPr.push("<w:i/>");
    if (opts.color) rPr.push('<w:color w:val="' + opts.color.replace("#","") + '"/>');
    if (opts.sz) rPr.push('<w:sz w:val="' + opts.sz + '"/><w:szCs w:val="' + opts.sz + '"/>');
    // OOXML-skeeman mukainen pPr-lasten järjestys: pStyle, pBdr, spacing, jc
    const pPr = [];
    if (opts.pStyle) pPr.push('<w:pStyle w:val="' + xmlEsc(opts.pStyle) + '"/>');
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

  function imageXml(rId, cx, cy, docPrId, align){
    const pPr = align ? '<w:pPr><w:jc w:val="' + align + '"/></w:pPr>' : "";
    return '<w:p>' + pPr + '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="'+cx+'" cy="'+cy+'"/><wp:docPr id="'+docPrId+'" name="Kuva'+docPrId+'"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="'+docPrId+'" name="Kuva'+docPrId+'"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId'+rId+'"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="'+cx+'" cy="'+cy+'"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
  }

  function pageNumberFieldXml(prefixText, align){
    return '<w:p><w:pPr><w:jc w:val="' + (align||"center") + '"/></w:pPr>' +
      (prefixText ? '<w:r><w:t xml:space="preserve">' + xmlEsc(prefixText) + ' — Sivu </w:t></w:r>' : '<w:r><w:t xml:space="preserve">Sivu </w:t></w:r>') +
      '<w:fldSimple w:instr="PAGE"><w:r><w:t>1</w:t></w:r></w:fldSimple>' +
      '<w:r><w:t xml:space="preserve"> / </w:t></w:r>' +
      '<w:fldSimple w:instr="NUMPAGES"><w:r><w:t>1</w:t></w:r></w:fldSimple>' +
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
    const colWidth = colCount ? Math.floor(9026 / colCount) : 9026;

    const gridCols = Array.from({length:colCount}, () => '<w:gridCol w:w="'+colWidth+'"/>').join('');

    const trXml = rows.map((row, rIdx) => {
      const isHeaderRow = rIdx < headerRowCount;
      const tcXml = row.map((cellText, cIdx) => {
        const isHeaderCol = cIdx < headerColCount;
        const bold = isHeaderRow || isHeaderCol;
        const p = paraXml(cellText || "", {
          bold, font: opts.font, sz: opts.sz, color: opts.color
        });
        return '<w:tc><w:tcPr><w:tcW w:w="'+colWidth+'" w:type="dxa"/>' +
          (bold ? '<w:shd w:val="clear" w:color="auto" w:fill="F2EFE6"/>' : '') +
          '</w:tcPr>' + p + '</w:tc>';
      }).join('');
      return '<w:tr>' + tcXml + '</w:tr>';
    }).join('');

    return '<w:tbl>' +
      '<w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>' +
      '<w:top w:val="single" w:sz="4" w:color="B9B2A0"/><w:left w:val="single" w:sz="4" w:color="B9B2A0"/>' +
      '<w:bottom w:val="single" w:sz="4" w:color="B9B2A0"/><w:right w:val="single" w:sz="4" w:color="B9B2A0"/>' +
      '<w:insideH w:val="single" w:sz="4" w:color="B9B2A0"/><w:insideV w:val="single" w:sz="4" w:color="B9B2A0"/>' +
      '</w:tblBorders></w:tblPr>' +
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
    let relCounter = 10; // pieni marginaali kiinteille rel-id:eille alla
    let docPrCounter = 100;

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

    // ---- Kansilehti (oma sectio, ei ylä/alatunnistetta) ----
    if (style.coverPage && style.coverPage.enabled){
      const coverParts = [];
      coverParts.push(paraXml("", { after:1200 }));
      if (logoInfo){
        const maxCx = 3200000;
        const { cx, cy } = scaledDims(logoInfo.w, logoInfo.h, maxCx);
        const rId = relCounter++;
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
      finalBodyParts.push(...coverParts);

      // Sectionin päätös ilman header/footer-viittausta (kansilehti pysyy puhtaana)
      finalBodyParts.push(
        '<w:p><w:pPr><w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417"/></w:sectPr></w:pPr></w:p>'
      );
    }

    // ---- Pääsisältö (kansilehden jälkeen: TOC, ennen-sivut, itse lomake, jälkeen-sivut) ----
    if (style.toc && style.toc.enabled){
      finalBodyParts.push(tocFieldXml(style.toc.variant));
      finalBodyParts.push(pageBreakXml());
    }
    (style.pagesBefore || []).forEach(page => {
      finalBodyParts.push(paraXml(page.title || "Sivu", {
        bold:true, sz: pt2hp(style.fonts.headingSize), font: style.fonts.heading, color: style.colors.heading,
        pStyle:"Heading1", after:160
      }));
      if (page.content){
        finalBodyParts.push(paraXml(page.content, { font: style.fonts.body, sz: pt2hp(style.fonts.bodySize), color: style.colors.body }));
      }
      finalBodyParts.push(pageBreakXml());
    });

    finalBodyParts.push(...bodyParts);

    (style.pagesAfter || []).forEach(page => {
      finalBodyParts.push(pageBreakXml());
      finalBodyParts.push(paraXml(page.title || "Sivu", {
        bold:true, sz: pt2hp(style.fonts.headingSize), font: style.fonts.heading, color: style.colors.heading,
        pStyle:"Heading1", after:160
      }));
      if (page.content){
        finalBodyParts.push(paraXml(page.content, { font: style.fonts.body, sz: pt2hp(style.fonts.bodySize), color: style.colors.body }));
      }
    });

    // ---- Ylä-/alatunniste ----
    let headerRefXml = "", footerRefXml = "";
    const headerFolderFiles = [];
    const headerRelsFiles = []; // [{ name:"header1.xml.rels", content }]

    if (style.header && style.header.enabled){
      const rId = relCounter++;
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
      headerBodyXml += paraXml(headerText, { font: style.fonts.body, sz:18, color:"7A7566", align: headerAlign });

      const headerXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">' +
        headerBodyXml + '</w:hdr>';
      headerFolderFiles.push({ name:"header1.xml", content: headerXml });
      if (headerRelsContent) headerRelsFiles.push({ name:"header1.xml.rels", content: headerRelsContent });
      relParts.push('<Relationship Id="rId'+rId+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>');
      contentTypeOverrides.push('<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>');
      headerRefXml = '<w:headerReference w:type="default" r:id="rId'+rId+'"/>';
    }
    if (style.footer && style.footer.enabled){
      const rId = relCounter++;
      const footerAlign = style.footer.align || "center";
      let footerXml;
      if (style.footer.showPageNumber){
        footerXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
          pageNumberFieldXml(style.footer.text || "", footerAlign) + '</w:ftr>';
      } else {
        footerXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
          paraXml(style.footer.text || "", { align:footerAlign, font: style.fonts.body, sz:18, color:"7A7566" }) + '</w:ftr>';
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
      '</w:styles>';

    const contentTypesXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Default Extension="jpeg" ContentType="image/jpeg"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
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
    zip.folder("docProps").file("core.xml", coreXml);
    zip.folder("docProps").file("app.xml", appXml);

    return zip.generateAsync({ type:"blob", mimeType:"application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  }

  return { defaultStyle, FONT_CHOICES, xmlEsc, paraXml, imageXml, pageBreakXml, tocFieldXml, tableXml, pxToEmu, scaledDims, pt2hp, assembleDocx };
})();
