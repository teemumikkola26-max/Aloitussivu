/* =========================================================================
   LUKULAITE-OCR — mittalaitteen näytön luku kameralla taulukkokenttään
   -------------------------------------------------------------------------
   Käyttöönotto menetelmäeditorissa: taulukkokentän asetus
   f.ocr = { enabled:true, device:"vaisala", map:{ T, RH, a, date } }
   jossa map-arvot ovat taulukon sarakkeiden id:itä.

   Jokainen kuva tuottaa uuden rivin heti. Tunnistus ajetaan taustalla
   jonossa, ja arvot kirjoitetaan riville valmistuttuaan. Rivin tila
   tallentuu rivin kenttään _ocr (ei näy raportissa):
     { state:"reading"|"done"|"error", photoId, crop:{x,y,w,h},
       flags:{T,RH,a}, alt, read:{T,RH,a}, edited:{...}, reviewed }
   read = tunnistuksen alkuperäiset arvot, edited = käsin muutetut.
   ========================================================================= */
(function(){
"use strict";

var TESSERACT_URL="https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
var DEC={T:1,RH:1,Td:1,Tw:1,a:2};
var KEYS=["T","RH","a"];

/* ---------- Näytön tekstin jäsennys ja fysikaalinen ristiintarkistus ----------
   Vaisala HM40 -sarjan näkymä "RH Td Tw a x h": rivit T, RH, Td, Tw, a, x, h. */
var CONFUSE={"5":"63","6":"58","3":"8","8":"3609","1":"7","7":"1","0":"8","9":"8"};
function es(t){return 6.112*Math.exp(17.62*t/(243.12+t));}
function rhFromTd(t,td){return 100*es(td)/es(t);}
function rhFromA(t,a){return 100*(a*(273.15+t)/216.7)/es(t);}

function normalize(tok,dec){
  var neg=tok.charAt(0)==="-", s=tok.replace(/[^\d.,]/g,"").replace(",",".");
  if(!s)return null;
  var v;
  if(s.indexOf(".")>=0){var p=s.split(".");if(!p[0])return null;v=parseFloat(p[0]+"."+(p[1]||"0").slice(0,dec));}
  else{if(s.length<=dec)return null;v=parseFloat(s.slice(0,s.length-dec)+"."+s.slice(s.length-dec));}
  if(isNaN(v))return null;
  return neg?-v:v;
}
function firstNumber(line){
  var m=line.match(/-?\d[\d.,]*/g);if(!m)return null;
  for(var i=0;i<m.length;i++)if(m[i].replace(/\D/g,"").length>=2)return m[i];
  return null;
}
function parseText(text){
  var lines=text.split(/\r?\n/).map(function(l){return l.trim();}).filter(Boolean),nums=[];
  lines.forEach(function(l){var t=firstNumber(l);if(t)nums.push({line:l,tok:t});});
  var out={},rhIdx=-1,i;
  for(i=0;i<nums.length;i++){if(/R\s?H/i.test(nums[i].line.split(nums[i].tok)[0])){rhIdx=i;break;}}
  function put(k,it){if(!it)return;var v=normalize(it.tok,DEC[k]);if(v!==null)out[k]=v;}
  if(rhIdx>=0){put("T",nums[rhIdx-1]);put("RH",nums[rhIdx]);put("Td",nums[rhIdx+1]);put("Tw",nums[rhIdx+2]);put("a",nums[rhIdx+3]);}
  else if(nums.length>=5){put("T",nums[0]);put("RH",nums[1]);put("Td",nums[2]);put("Tw",nums[3]);put("a",nums[4]);}
  nums.forEach(function(n){
    var after=n.line.slice(n.line.indexOf(n.tok)+n.tok.length);
    if(/g\s*[i\/l|]?\s*[mn]/i.test(after)&&!/k/i.test(after))put("a",n);
  });
  return out;
}
function plausible(k,v){
  if(v===undefined||v===null)return false;
  if(k==="RH")return v>=0&&v<=100;
  if(k==="a")return v>=0&&v<=80;
  return v>=-30&&v<=50;
}
function alternatives(v,dec){
  var s=v.toFixed(dec),res=[];
  for(var i=0;i<s.length;i++){var al=CONFUSE[s.charAt(i)];if(!al)continue;
    for(var j=0;j<al.length;j++)res.push(parseFloat(s.slice(0,i)+al.charAt(j)+s.slice(i+1)));}
  return res;
}
function combine(parses){
  var keys=["T","RH","Td","a"],n=parses.length,cand={},votes={};
  keys.forEach(function(k){
    votes[k]={};
    parses.forEach(function(p){if(plausible(k,p[k])){var s=p[k].toFixed(DEC[k]);votes[k][s]=(votes[k][s]||0)+1;}});
    var set={};
    Object.keys(votes[k]).forEach(function(s){set[s]=true;
      alternatives(parseFloat(s),DEC[k]).forEach(function(a){if(plausible(k,a))set[a.toFixed(DEC[k])]=true;});});
    cand[k]=Object.keys(set).map(parseFloat);if(!cand[k].length)cand[k]=[null];
  });
  function cost(k,v){if(v===null)return 6;var c=votes[k][v.toFixed(DEC[k])]||0;return -Math.log((c+0.3)/(n+1));}
  var best=null,all=[];
  cand.T.forEach(function(T){cand.RH.forEach(function(RH){cand.Td.forEach(function(Td){cand.a.forEach(function(a){
    var c=cost("T",T)+cost("RH",RH)+cost("Td",Td)+cost("a",a);
    if(T!==null&&RH!==null){
      if(Td!==null)c+=0.5*Math.pow(RH-rhFromTd(T,Td),2);
      if(a!==null)c+=0.5*Math.pow(RH-rhFromA(T,a),2);
    }
    var o={cost:c,T:T,RH:RH,Td:Td,a:a};all.push(o);if(!best||c<best.cost)best=o;
  });});});});
  var alt=null;
  all.forEach(function(c){
    if(c.T===null||c.RH===null||best.T===null||best.RH===null)return;
    if(Math.abs(c.T-best.T)<0.5&&Math.abs(c.RH-best.RH)<1.0)return;
    if(!alt||c.cost<alt.cost)alt=c;
  });
  var r={values:{},status:{}};
  if(alt&&alt.cost-best.cost<2.5)r.alternative={T:alt.T,RH:alt.RH,a:alt.a};
  keys.forEach(function(k){
    var v=best[k];r.values[k]=v;
    if(v===null){r.status[k]="puuttuu";return;}
    var c=votes[k][v.toFixed(DEC[k])]||0;
    var top=Math.max.apply(null,Object.keys(votes[k]).map(function(s){return votes[k][s];}).concat([0]));
    r.status[k]=c===0?"korjattu":(c<top?"valittu":"ok");
  });
  var V=r.values,devs=[];
  if(V.T!==null&&V.RH!==null){
    if(V.Td!==null)devs.push(Math.abs(V.RH-rhFromTd(V.T,V.Td)));
    if(V.a!==null)devs.push(Math.abs(V.RH-rhFromA(V.T,V.a)));
  }
  r.consistent=devs.length>0&&Math.max.apply(null,devs)<=1.5;
  return r;
}

/* ---------- Kuvan esikäsittely ---------- */
var VARIANTS=[{r:2,o:-20},{r:2,o:-30},{r:1,o:-20},{r:3,o:-20},{r:2,o:-10},{r:3,o:-30}];
function gray(c){
  var d=c.getContext("2d").getImageData(0,0,c.width,c.height).data,g=new Float32Array(c.width*c.height),j;
  for(var i=0,k=0;i<d.length;i+=4,k++)g[k]=0.299*d[i]+0.587*d[i+1]+0.114*d[i+2];
  var h=new Uint32Array(256);for(j=0;j<g.length;j++)h[g[j]|0]++;
  var cut=g.length*0.02,lo,hi,acc=0;
  for(lo=0;lo<255&&(acc+=h[lo])<cut;lo++);acc=0;for(hi=255;hi>0&&(acc+=h[hi])<cut;hi--);
  var s=255/Math.max(1,hi-lo);for(j=0;j<g.length;j++)g[j]=Math.min(255,Math.max(0,(g[j]-lo)*s));
  return g;
}
function box(src,w,h,r){
  var t=new Float32Array(src.length),o=new Float32Array(src.length),x,y,a,n=2*r+1;
  for(y=0;y<h;y++){var rw=y*w;a=0;for(x=-r;x<=r;x++)a+=src[rw+Math.min(w-1,Math.max(0,x))];
    for(x=0;x<w;x++){t[rw+x]=a/n;a+=src[rw+Math.min(w-1,x+r+1)]-src[rw+Math.max(0,x-r)];}}
  for(x=0;x<w;x++){a=0;for(y=-r;y<=r;y++)a+=t[Math.min(h-1,Math.max(0,y))*w+x];
    for(y=0;y<h;y++){o[y*w+x]=a/n;a+=t[Math.min(h-1,y+r+1)*w+x]-t[Math.max(0,y-r)*w+x];}}
  return o;
}
function binarize(g,w,h,off){
  var s=0,j;for(j=0;j<g.length;j++)s+=g[j];
  var t=s/g.length+off,c=document.createElement("canvas");c.width=w;c.height=h;
  var x=c.getContext("2d"),im=x.createImageData(w,h);
  for(j=0;j<g.length;j++){var v=g[j]>t?255:0;im.data[j*4]=im.data[j*4+1]=im.data[j*4+2]=v;im.data[j*4+3]=255;}
  x.putImageData(im,0,0);return c;
}
// Rajaus 5 %:n marginaalilla, normalisoitu 1000 px leveäksi
function cropCanvas(src,sw,sh,r){
  var mx=r.w*0.05,my=r.h*0.05,x=Math.max(0,r.x-mx),y=Math.max(0,r.y-my),
      w=Math.min(sw-x,r.w+2*mx),h=Math.min(sh-y,r.h+2*my);
  var c=document.createElement("canvas"),sc=1000/w;c.width=1000;c.height=Math.max(1,Math.round(h*sc));
  c.getContext("2d").drawImage(src,x,y,w,h,0,0,c.width,c.height);return c;
}

/* Tarkkuus: Laplace-varianssi 250 px leveästä, kontrastivenytetystä kuvasta.
   Kalibrointi: terävä näyttökuva > 1000, selvästi epätarkka < 200. */
var SHARP_MIN=400;
function smallGray(c,w){
  var h=Math.max(8,Math.round(c.height*w/c.width)),t=document.createElement("canvas");t.width=w;t.height=h;
  var x=t.getContext("2d");x.drawImage(c,0,0,w,h);
  var d=x.getImageData(0,0,w,h).data,g=new Float32Array(w*h),i,k;
  for(i=0,k=0;i<d.length;i+=4,k++)g[k]=0.299*d[i]+0.587*d[i+1]+0.114*d[i+2];
  var s=Array.prototype.slice.call(g).sort(function(a,b){return a-b;}),lo=s[Math.floor(s.length*0.02)],hi=s[Math.floor(s.length*0.98)],sc=255/Math.max(1,hi-lo);
  for(k=0;k<g.length;k++)g[k]=Math.min(255,Math.max(0,(g[k]-lo)*sc));
  return {g:g,w:w,h:h};
}
function sharpness(c){
  var o=smallGray(c,250),g=o.g,w=o.w,h=o.h,sum=0,sum2=0,n=0;
  for(var y=1;y<h-1;y++)for(var x=1;x<w-1;x++){
    var i=y*w+x,l=g[i-w]+g[i+w]+g[i-1]+g[i+1]-4*g[i];sum+=l;sum2+=l*l;n++;
  }
  return n?sum2/n-(sum/n)*(sum/n):0;
}
// Normalisoitu korrelaatio kahden saman alueen kuvan välillä (onko rajaus osunut samaan kohtaan)
function similarity(a,b){
  var A=smallGray(a,64),B=smallGray(b,64);if(A.h!==B.h)return 0;
  var n=A.g.length,ma=0,mb=0,i;for(i=0;i<n;i++){ma+=A.g[i];mb+=B.g[i];}ma/=n;mb/=n;
  var sab=0,saa=0,sbb=0;for(i=0;i<n;i++){var da=A.g[i]-ma,db=B.g[i]-mb;sab+=da*db;saa+=da*da;sbb+=db*db;}
  return saa&&sbb?sab/Math.sqrt(saa*sbb):0;
}

/* ---------- Tekstintunnistus (ladataan taustalla ennakkoon) ---------- */
var workerP=null,scriptP=null;
function loadScript(){
  if(window.Tesseract)return Promise.resolve();
  if(!scriptP)scriptP=new Promise(function(res,rej){
    var s=document.createElement("script");s.src=TESSERACT_URL;s.async=true;
    s.onload=function(){res();};s.onerror=function(){scriptP=null;rej(new Error("Tekstintunnistusta ei voitu ladata. Tarkista verkkoyhteys."));};
    document.head.appendChild(s);
  });
  return scriptP;
}
function getWorker(){
  if(!workerP)workerP=loadScript().then(function(){return window.Tesseract.createWorker("eng",1);})
    .then(function(w){return w.setParameters({tessedit_pageseg_mode:"6"}).then(function(){return w;});})
    .catch(function(e){workerP=null;throw e;});
  return workerP;
}
function recognize(canvas){
  var w=canvas.width,h=canvas.height,g=gray(canvas),parses=[],raws=[];
  return getWorker().then(function(wk){
    var i=0;
    function next(){
      if(i>=VARIANTS.length)return Promise.resolve();
      var v=VARIANTS[i++];
      return wk.recognize(binarize(box(box(box(g,w,h,v.r),w,h,v.r),w,h,v.r),w,h,v.o)).then(function(r){
        parses.push(parseText(r.data.text));raws.push(r.data.text);
        if(parses.length>=3){
          var c=combine(parses);
          if(c.consistent&&!c.alternative&&KEYS.every(function(k){return c.status[k]==="ok";}))return;
        }
        return next();
      });
    }
    return next();
  }).then(function(){var c=combine(parses);c.raw=raws.join("\n----\n");return c;});
}

/* ---------- Jono ---------- */
var queue=[],busy=false,active=new Set(),controllers={};
function enqueue(job){active.add(job.row);job.ver=job.row._ocr.ver=(job.row._ocr.ver||0)+1;queue.push(job);pump();}
function pump(){
  if(busy||!queue.length)return;
  busy=true;var job=queue.shift();
  recognize(job.canvas).then(function(res){
    if(job.ver!==job.row._ocr.ver)return;
    applyResult(job,res);
  }).catch(function(err){
    if(job.ver!==job.row._ocr.ver)return;
    job.row._ocr.state="error";job.row._ocr.error=err&&err.message?err.message:String(err);
  }).then(function(){
    if(job.ver===job.row._ocr.ver)active.delete(job.row);
    busy=false;
    var ctl=controllers[job.field.id];
    if(ctl)ctl.refreshRow(job.row);
    updateStrip(job.row);
    if(job.onDone)job.onDone();
    pump();
  });
}
function applyResult(job,r){
  var row=job.row,o=row._ocr,map=job.field.ocr.map||{},V=r.values;
  o.alt=r.alternative||null;
  o.read={T:V.T,RH:V.RH,a:V.a};
  o.flags={
    T:r.status.T!=="ok"||!!o.alt,
    RH:r.status.RH!=="ok"||!r.consistent||!!o.alt,
    a:r.status.a!=="ok"
  };
  o.edited={};o.reviewed=false;o.state="done";
  Object.defineProperty(o,"_raw",{value:r.raw||"",enumerable:false,writable:true,configurable:true});
  KEYS.forEach(function(k){
    if(!map[k])return;
    row[map[k]]=V[k]===null?"":V[k].toFixed(DEC[k]);
    if(V[k]===null)o.flags[k]=true;
  });
}

/* ---------- Apufunktiot ---------- */
function num(s){var v=parseFloat(String(s===undefined||s===null?"":s).replace(",",".").trim());return isNaN(v)?null:v;}
function fiNum(v,d){return (v===null||v===undefined||isNaN(v))?"":Number(v).toFixed(d).replace(".",",");}
function todayIso(){var d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");}
function fiDate(iso){var m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso||""));return m?(+m[3])+"."+(+m[2])+"."+m[1]:String(iso||"");}
function el(html){var t=document.createElement("template");t.innerHTML=html.trim();return t.content.firstElementChild;}
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c];});}
function rowFlagged(row){var f=row._ocr&&row._ocr.flags;return !!(f&&(f.T||f.RH||f.a));}
function rowDeviation(field,row){
  var m=field.ocr.map||{},T=num(row[m.T]),RH=num(row[m.RH]),a=num(row[m.a]);
  if(!m.T||!m.RH||!m.a||T===null||RH===null||a===null)return null;
  return Math.abs(RH-rhFromA(T,a));
}
function rowState(field,row){
  var o=row&&row._ocr;if(!o)return null;
  if(o.state==="reading")return active.has(row)?"reading":"interrupted";
  if(o.state==="error")return "error";
  var dev=rowDeviation(field,row);
  if(rowFlagged(row)||(dev!==null&&dev>1.5))return "flagged";
  return "ok";
}

/* ---------- Tyylit ---------- */
function injectCss(){
  if(document.getElementById("ocr-css"))return;
  var s=document.createElement("style");s.id="ocr-css";
  s.textContent=[
    ".ocr-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:4px}",
    ".ocr-actions .btn svg{width:18px;height:18px}",
    ".table-field-table input.ocr-flag{border-color:var(--warn,#b7791f)!important;background:#fbf1de!important}",
    ".table-field-table input.ocr-reading{background:repeating-linear-gradient(90deg,#fff 0 40%,#f2f0e8 50%,#fff 60% 100%);background-size:300% 100%;animation:ocrShimmer 1.2s linear infinite}",
    "@keyframes ocrShimmer{from{background-position:100% 0}to{background-position:0 0}}",
    "tr.ocr-status-row td{padding:4px 0 8px!important;border-bottom:1px solid var(--line)}",
    ".tl-cards .table-field-table tr.ocr-status-row{display:block;margin:-6px 0 12px;padding:0;border:0;background:none;grid-template-columns:none}",
    ".tl-cards .table-field-table tr.ocr-status-row td{border:0}",
    ".ocr-status{display:flex;align-items:center;gap:10px;font-size:13px;color:var(--muted,#6b6656)}",
    ".ocr-status.warn{color:var(--warn,#b7791f)}.ocr-status.err{color:var(--error,#a3271b)}",
    ".ocr-thumb{flex:none;width:64px;height:48px;border-radius:6px;border:1.5px solid var(--line);background:#222;padding:0;overflow:hidden;cursor:pointer}",
    ".ocr-thumb canvas{width:100%;height:100%;display:block}",
    ".ocr-status .txt{flex:1;min-width:0}",
    ".ocr-alt{display:block;margin-top:4px}",
    ".ocr-alt button,.ocr-status .lnk{border:1.5px solid var(--warn,#b7791f);background:#fbf1de;color:var(--ink);border-radius:99px;padding:5px 11px;font:inherit;font-weight:600;cursor:pointer}",
    ".ocr-status .lnk{border-color:var(--line);background:#fff}",
    ".ocr-cam{position:fixed;inset:0;z-index:1000;background:#000;color:#fff;display:flex;flex-direction:column}",
    ".ocr-cam-top{display:flex;align-items:center;gap:10px;padding:calc(env(safe-area-inset-top,0px) + 10px) 12px 10px}",
    ".ocr-cam-top .cnt{flex:1;font-size:15px}",
    ".ocr-cb{background:rgba(255,255,255,.16);border:0;color:#fff;border-radius:12px;min-height:46px;min-width:46px;padding:0 14px;font:inherit;font-weight:600;cursor:pointer}",
    ".ocr-cb[aria-pressed=true]{background:#fff;color:#000}",
    ".ocr-stage{position:relative;flex:1;overflow:hidden;touch-action:none}",
    ".ocr-stage video,.ocr-stage canvas{position:absolute;inset:0;width:100%;height:100%}",
    ".ocr-stage video{object-fit:cover}",
    ".ocr-frame{position:absolute;left:14%;top:16%;width:72%;height:54%;border:3px solid #fff;border-radius:10px;box-shadow:0 0 0 100vmax rgba(0,0,0,.5);pointer-events:none}",
    ".ocr-frame::after{content:'Koko näyttö kehykseen';position:absolute;top:calc(100% + 10px);left:0;right:0;text-align:center;font-size:14px}",
    ".ocr-hint{position:absolute;left:0;right:0;top:12px;text-align:center;font-size:14px;text-shadow:0 1px 2px #000;pointer-events:none}",
    ".ocr-focus{position:absolute;width:64px;height:64px;margin:-32px 0 0 -32px;border:2px solid #ffd54a;border-radius:50%;opacity:0;pointer-events:none}",
    ".ocr-focus.on{animation:ocrFocus 1s ease-out}",
    "@keyframes ocrFocus{0%{opacity:1;transform:scale(1.4)}60%{opacity:1;transform:scale(1)}100%{opacity:0}}",
    ".ocr-cmp details{margin-top:12px;font-size:12px;color:var(--muted,#6b6656)}",
    ".ocr-cmp pre{white-space:pre-wrap;background:#f2f0e8;padding:8px;border-radius:6px;max-height:180px;overflow:auto}",
    ".ocr-flash{position:absolute;inset:0;background:#fff;opacity:0;pointer-events:none;transition:opacity .25s}",
    ".ocr-flash.on{opacity:.7;transition:none}",
    ".ocr-strip{display:flex;gap:8px;overflow-x:auto;padding:8px 12px;min-height:72px}",
    ".ocr-strip .t{flex:none;width:56px;height:56px;border-radius:8px;background:#222 center/cover;position:relative;border:2px solid transparent}",
    ".ocr-strip .t.ok{border-color:#7fbf8a}.ocr-strip .t.warn{border-color:#e5b450}.ocr-strip .t.busy{opacity:.6}",
    ".ocr-strip .t i{position:absolute;right:-4px;top:-4px;width:20px;height:20px;border-radius:50%;font-style:normal;font-size:12px;display:flex;align-items:center;justify-content:center;background:#333}",
    ".ocr-strip .t.ok i{background:#2f6b3a}.ocr-strip .t.warn i{background:#b7791f}",
    ".ocr-cam-bottom{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;padding:6px 16px calc(16px + env(safe-area-inset-bottom,0px))}",
    ".ocr-cam-bottom .l{justify-self:start}.ocr-cam-bottom .r{justify-self:end}",
    ".ocr-shutter{width:78px;height:78px;border-radius:50%;border:5px solid #fff;background:var(--safety,#c2410c);cursor:pointer}",
    ".ocr-shutter:active{transform:scale(.94)}.ocr-shutter:disabled{opacity:.4}",
    ".ocr-toast{position:absolute;left:50%;bottom:180px;transform:translateX(-50%);background:rgba(0,0,0,.8);padding:10px 14px;border-radius:10px;font-size:14px;max-width:90vw;text-align:center}",
    ".ocr-cmp{position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:12px}",
    ".ocr-cmp .box{background:#fff;color:var(--ink);border-radius:14px;width:min(560px,100%);max-height:94vh;overflow:auto}",
    ".ocr-cmp canvas{width:100%;display:block;background:#000;max-height:46vh;object-fit:contain}",
    ".ocr-cmp .body{padding:14px}",
    ".ocr-cmp .big{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px}",
    ".ocr-cmp .big label{display:block;font-family:var(--mono);font-size:10.5px;text-transform:uppercase;letter-spacing:.04em;color:#66604f;margin-bottom:2px}",
    ".ocr-cmp .big input{width:100%;font-size:22px;font-weight:700;text-align:center;padding:8px 4px;border:1.5px solid var(--line);border-radius:8px}",
    ".ocr-cmp .big input.ocr-flag{border-color:var(--warn,#b7791f);background:#fbf1de}",
    ".ocr-cmp .chk{font-size:13px;color:var(--muted,#6b6656);margin-bottom:12px}.ocr-cmp .chk.bad{color:var(--warn,#b7791f)}",
    ".ocr-cmp .acts{display:flex;gap:8px}.ocr-cmp .acts .btn{flex:1;min-height:48px}",
    "@media (prefers-reduced-motion:reduce){.table-field-table input.ocr-reading{animation:none}}"
  ].join("\n");
  document.head.appendChild(s);
}

/* ---------- Android-takaisinpainike sulkee ensin kameran / tarkistusnäkymän ----------
   Kuuntelija rekisteröidään ennen sovelluksen omaa popstate-käsittelijää. */
var overlay=null,swallowPop=false;
window.addEventListener("popstate",function(e){
  if(swallowPop){swallowPop=false;e.stopImmediatePropagation();return;}
  if(overlay){e.stopImmediatePropagation();var o=overlay;overlay=null;o.close(true);}
});
function pushOverlay(o){overlay=o;try{history.pushState({ocrOverlay:1},"");}catch(e){}}
function popOverlay(fromPop){
  overlay=null;
  if(!fromPop){swallowPop=true;try{history.back();}catch(e){swallowPop=false;}}
}

/* ---------- Kameranäkymä ---------- */
var cam=null;
function buildCam(){
  var c=el(
    '<section class="ocr-cam" role="dialog" aria-modal="true" aria-label="Lukulaitteen kuvaus">'+
      '<div class="ocr-cam-top"><button class="ocr-cb" data-a="close" aria-label="Sulje kamera">✕</button>'+
      '<div class="cnt"></div><button class="ocr-cb" data-a="torch" aria-pressed="false" aria-label="Taskulamppu" hidden>💡</button></div>'+
      '<div class="ocr-stage"><video playsinline muted></video><canvas hidden></canvas>'+
      '<div class="ocr-frame"></div><div class="ocr-hint" hidden>Vedä rajaus näytön ympärille</div>'+
      '<div class="ocr-focus"></div><div class="ocr-flash"></div><div class="ocr-toast" hidden></div></div>'+
      '<div class="ocr-strip" aria-live="polite"></div>'+
      '<div class="ocr-cam-bottom"><button class="ocr-cb l" data-a="gallery">Galleria</button>'+
      '<button class="ocr-shutter" data-a="shoot" aria-label="Ota kuva ja lue lukemat" disabled></button>'+
      '<button class="ocr-cb r" data-a="close">Valmis</button></div>'+
      '<input type="file" accept="image/*" hidden></section>');
  return c;
}
function openCamera(ctl,retakeRow){
  injectCss();
  getWorker().catch(function(e){camToast(e.message);});
  var C=cam={ctl:ctl,retake:retakeRow||null,count:0,mode:"live",stream:null,track:null,img:null,crop:null,node:buildCam()};
  var n=C.node,q=function(s){return n.querySelector(s);};
  C.video=q("video");C.canvas=q("canvas");C.frame=q(".ocr-frame");C.shutter=q(".ocr-shutter");C.strip=q(".ocr-strip");
  q(".cnt").textContent=retakeRow?"Kuvaa näyttö uudelleen":"Kuvaa ensimmäinen mittauspiste";
  document.body.appendChild(n);document.body.style.overflow="hidden";
  n.addEventListener("click",function(e){
    var a=e.target.closest("[data-a]");if(!a)return;
    var act=a.getAttribute("data-a");
    if(act==="close")C.close(false);
    else if(act==="shoot")shoot(C);
    else if(act==="gallery")openGallery(C);
    else if(act==="torch")toggleTorch(C,a);
  });
  n.addEventListener("keydown",function(e){if(e.key==="Escape")C.close(false);});
  var fileInp=q("input[type=file]");
  fileInp.onchange=function(e){var f=e.target.files[0];e.target.value="";if(f)loadGallery(C,f);else{C.pickerOpen=false;startLive(C);}};
  fileInp.addEventListener("cancel",function(){C.pickerOpen=false;startLive(C);});
  // Varmistus: jos valinnasta palattiin ilman kuvaa eikä cancel-tapahtumaa tullut
  C.onVis=function(){
    if(document.visibilityState!=="visible"||C.closed)return;
    setTimeout(function(){if(!C.closed&&C.pickerOpen&&C.mode==="picking"){C.pickerOpen=false;startLive(C);}},1200);
  };
  document.addEventListener("visibilitychange",C.onVis);
  q(".ocr-stage").addEventListener("click",function(e){tapFocus(C,e);});
  setupCropDrag(C);
  C.close=function(fromPop){
    if(C.closed)return;C.closed=true;
    if(C.stream)C.stream.getTracks().forEach(function(t){t.stop();});
    document.removeEventListener("visibilitychange",C.onVis);
    n.remove();document.body.style.overflow="";cam=null;
    popOverlay(fromPop);
    if(C.count&&!C.retake&&ctl.opts.toast)ctl.opts.toast(C.count+(C.count===1?" rivi lisätty":" riviä lisätty"));
  };
  pushOverlay(C);
  startLive(C);
  setTimeout(function(){C.shutter.focus();},50);
}
function camToast(msg){
  if(!cam)return;var t=cam.node.querySelector(".ocr-toast");t.textContent=msg;t.hidden=false;
  clearTimeout(camToast.t);camToast.t=setTimeout(function(){t.hidden=true;},3000);
}
function startLive(C){
  C.mode="live";C.canvas.hidden=true;C.node.querySelector(".ocr-hint").hidden=true;C.video.hidden=false;C.frame.hidden=false;
  if(C.stream){C.shutter.disabled=false;return;}
  if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){camToast("Kamera ei ole käytettävissä. Valitse kuva galleriasta.");return;}
  if(C.starting)return;
  C.starting=true;var token=C.liveToken=(C.liveToken||0)+1;
  navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"},width:{ideal:1920},height:{ideal:1440}},audio:false})
    .then(function(s){
      C.starting=false;
      // Kamera ehdittiin sulkea (galleria tai sulkeminen) ennen kuin se käynnistyi
      if(C.closed||token!==C.liveToken||C.mode!=="live"){s.getTracks().forEach(function(t){t.stop();});return;}
      C.stream=s;C.track=s.getVideoTracks()[0];C.video.srcObject=s;
      var caps=C.track.getCapabilities?C.track.getCapabilities():{};
      C.caps=caps;
      C.node.querySelector('[data-a=torch]').hidden=!caps.torch;
      if(caps.focusMode&&caps.focusMode.indexOf("continuous")>=0){
        C.track.applyConstraints({advanced:[{focusMode:"continuous"}]}).catch(function(){});
      }
      // Valokuva tarkennettuna ja täydellä resoluutiolla, jos selain tukee (Chrome/Android)
      try{C.capture=window.ImageCapture?new window.ImageCapture(C.track):null;}catch(e){C.capture=null;}
      return C.video.play();
    })
    .then(function(){if(!C.closed)C.shutter.disabled=false;})
    .catch(function(){C.starting=false;camToast("Kameran käyttö estettiin. Salli kamera selaimen asetuksista tai valitse kuva galleriasta.");});
}
function stopLive(C){
  C.liveToken=(C.liveToken||0)+1;C.starting=false;
  if(C.stream)C.stream.getTracks().forEach(function(t){t.stop();});
  C.stream=null;C.track=null;C.capture=null;C.video.srcObject=null;
}
// Napautus esikatseluun tarkentaa siihen kohtaan
function tapFocus(C,e){
  if(C.mode!=="live"||!C.track||!C.caps)return;
  var r=C.node.querySelector(".ocr-stage").getBoundingClientRect();
  var x=(e.clientX-r.left)/r.width,y=(e.clientY-r.top)/r.height;
  var ring=C.node.querySelector(".ocr-focus");
  ring.style.left=(e.clientX-r.left)+"px";ring.style.top=(e.clientY-r.top)+"px";
  ring.classList.remove("on");void ring.offsetWidth;ring.classList.add("on");
  var adv={};
  if(C.caps.pointsOfInterest!==undefined)adv.pointsOfInterest=[{x:x,y:y}];
  if(C.caps.focusMode&&C.caps.focusMode.indexOf("single-shot")>=0)adv.focusMode="single-shot";
  if(!Object.keys(adv).length)return;
  C.track.applyConstraints({advanced:[adv]}).catch(function(){});
  clearTimeout(C.focusT);
  C.focusT=setTimeout(function(){
    if(C.track&&C.caps.focusMode&&C.caps.focusMode.indexOf("continuous")>=0)
      C.track.applyConstraints({advanced:[{focusMode:"continuous"}]}).catch(function(){});
  },2500);
}
function toggleTorch(C,b){
  if(!C.track)return;var on=b.getAttribute("aria-pressed")!=="true";
  C.track.applyConstraints({advanced:[{torch:on}]}).then(function(){b.setAttribute("aria-pressed",String(on));}).catch(function(){});
}
function frameRegion(C){
  var v=C.video,vw=v.videoWidth,vh=v.videoHeight,cr=C.node.querySelector(".ocr-stage").getBoundingClientRect(),fr=C.frame.getBoundingClientRect();
  var s=Math.max(cr.width/vw,cr.height/vh),ox=(cr.width-vw*s)/2,oy=(cr.height-vh*s)/2;
  return {x:(fr.left-cr.left-ox)/s,y:(fr.top-cr.top-oy)/s,w:fr.width/s,h:fr.height/s};
}
function openGallery(C){
  var inp=C.node.querySelector("input[type=file]");
  // Kamera suljetaan valinnan ajaksi: vähentää muistinkäyttöä, ettei selain lataa sivua uudelleen
  stopLive(C);C.mode="picking";C.shutter.disabled=true;
  C.pickerOpen=true;
  inp.click();
}
function loadGallery(C,file){
  C.pickerOpen=false;
  camToast("Avataan kuvaa…");
  function ready(img,w,h){
    // Suuri kuva pienennetään 3000 px:iin: riittää lukemiseen ja säästää muistia
    var s=Math.min(1,3000/Math.max(w,h)),c=document.createElement("canvas");
    c.width=Math.round(w*s);c.height=Math.round(h*s);c.getContext("2d").drawImage(img,0,0,c.width,c.height);
    if(img.close)img.close();
    C.img=c;C.mode="gallery";C.crop={x:.2,y:.25,w:.6,h:.5};
    C.video.hidden=true;C.frame.hidden=true;C.canvas.hidden=false;
    var hint=C.node.querySelector(".ocr-hint");hint.hidden=false;hint.textContent="Rajaa lukulaitteen näyttö sormella ja paina punaista painiketta";
    var r=C.node.querySelector(".ocr-stage").getBoundingClientRect(),d=window.devicePixelRatio||1;
    C.canvas.width=r.width*d;C.canvas.height=r.height*d;drawCrop(C);C.shutter.disabled=false;
    var t=C.node.querySelector(".ocr-toast");t.hidden=true;
  }
  function fail(){camToast("Kuvaa ei voitu avata. Valitse toinen kuva tai kuvaa kameralla.");startLive(C);}
  if(window.createImageBitmap){
    createImageBitmap(file,{imageOrientation:"from-image"}).then(function(b){ready(b,b.width,b.height);})
      .catch(function(){viaImage();});
  }else viaImage();
  function viaImage(){
    var im=new Image(),url=URL.createObjectURL(file);
    im.onload=function(){ready(im,im.naturalWidth,im.naturalHeight);URL.revokeObjectURL(url);};
    im.onerror=function(){URL.revokeObjectURL(url);fail();};
    im.src=url;
  }
}
function cropLayout(C){var c=C.canvas,im=C.img,s=Math.min(c.width/im.width,c.height/im.height);
  return {ox:(c.width-im.width*s)/2,oy:(c.height-im.height*s)/2,w:im.width*s,h:im.height*s};}
function drawCrop(C){
  var c=C.canvas,x=c.getContext("2d"),L=cropLayout(C),k=C.crop;
  x.fillStyle="#000";x.fillRect(0,0,c.width,c.height);x.drawImage(C.img,L.ox,L.oy,L.w,L.h);
  var rx=L.ox+k.x*L.w,ry=L.oy+k.y*L.h,rw=k.w*L.w,rh=k.h*L.h;
  x.fillStyle="rgba(0,0,0,.5)";x.fillRect(0,0,c.width,ry);x.fillRect(0,ry+rh,c.width,c.height-ry-rh);x.fillRect(0,ry,rx,rh);x.fillRect(rx+rw,ry,c.width-rx-rw,rh);
  x.strokeStyle="#fff";x.lineWidth=3*(window.devicePixelRatio||1);x.strokeRect(rx,ry,rw,rh);
}
function setupCropDrag(C){
  var c=C.canvas,start=null;
  function rel(e){var r=c.getBoundingClientRect(),L=cropLayout(C),d=c.width/r.width;
    return {x:Math.min(1,Math.max(0,((e.clientX-r.left)*d-L.ox)/L.w)),y:Math.min(1,Math.max(0,((e.clientY-r.top)*d-L.oy)/L.h))};}
  c.addEventListener("pointerdown",function(e){if(C.mode!=="gallery")return;start=rel(e);c.setPointerCapture(e.pointerId);});
  c.addEventListener("pointermove",function(e){if(!start)return;var p=rel(e);
    C.crop={x:Math.min(start.x,p.x),y:Math.min(start.y,p.y),w:Math.abs(p.x-start.x),h:Math.abs(p.y-start.y)};drawCrop(C);});
  c.addEventListener("pointerup",function(){start=null;if(C.crop.w<.05||C.crop.h<.05){C.crop={x:.2,y:.25,w:.6,h:.5};drawCrop(C);}});
}
function videoCanvas(v){
  var c=document.createElement("canvas");c.width=v.videoWidth;c.height=v.videoHeight;
  c.getContext("2d").drawImage(v,0,0);return c;
}
// Valokuva (ImageCapture) piirretään kankaalle esikatselun suuntaan
function photoCanvas(C){
  if(!C.capture||!C.capture.takePhoto)return Promise.resolve(null);
  var timeout=new Promise(function(res){setTimeout(function(){res(null);},6000);});
  var shot=C.capture.takePhoto().then(function(blob){
    return window.createImageBitmap?createImageBitmap(blob,{imageOrientation:"from-image"}):null;
  }).then(function(bmp){
    if(!bmp)return null;
    var vw=C.video.videoWidth,vh=C.video.videoHeight,rot=(vw>vh)!==(bmp.width>bmp.height);
    var c=document.createElement("canvas");c.width=rot?bmp.height:bmp.width;c.height=rot?bmp.width:bmp.height;
    var x=c.getContext("2d");
    if(rot){x.translate(c.width,0);x.rotate(Math.PI/2);}
    x.drawImage(bmp,0,0);if(bmp.close)bmp.close();
    return c;
  }).catch(function(){return null;});
  return Promise.race([shot,timeout]);
}
// Esikatselun alue valokuvan koordinaatteihin (esikatselu voi olla rajattu valokuvasta)
function mapToPhoto(reg,vw,vh,pw,ph){
  var A=vw/vh,sc,ox=0,oy=0;
  if(pw/ph>A){sc=ph/vh;ox=(pw-ph*A)/2;}else{sc=pw/vw;oy=(ph-pw/A)/2;}
  return {x:ox+reg.x*sc,y:oy+reg.y*sc,w:reg.w*sc,h:reg.h*sc};
}
function shoot(C){
  if(C.busy)return;
  var src,sw,sh,reg;
  if(C.mode==="live"){if(!C.video.videoWidth)return;reg=frameRegion(C);}
  else{src=C.img;sw=src.width;sh=src.height;reg={x:C.crop.x*sw,y:C.crop.y*sh,w:C.crop.w*sw,h:C.crop.h*sh};}
  C.busy=true;C.shutter.disabled=true;
  var f=C.node.querySelector(".ocr-flash");f.classList.add("on");
  requestAnimationFrame(function(){requestAnimationFrame(function(){f.classList.remove("on");});});
  if(navigator.vibrate)navigator.vibrate(30);

  var frameP;
  if(C.mode==="live"){
    var vc=videoCanvas(C.video),vw=vc.width,vh=vc.height,vcrop=cropCanvas(vc,vw,vh,reg);
    camToast("Kuvataan…");
    frameP=photoCanvas(C).then(function(pc){
      if(pc){
        var pr=mapToPhoto(reg,vw,vh,pc.width,pc.height),pcrop=cropCanvas(pc,pc.width,pc.height,pr);
        // Käytetään valokuvaa vain, jos rajaus osui samaan kohtaan kuin esikatselussa
        if(similarity(vcrop,pcrop)>0.5)return {src:pc,sw:pc.width,sh:pc.height,reg:pr,crop:pcrop,how:"valokuva"};
      }
      return {src:vc,sw:vw,sh:vh,reg:reg,crop:vcrop,how:"esikatselu"};
    });
  }else frameP=Promise.resolve({src:src,sw:sw,sh:sh,reg:reg,crop:cropCanvas(src,sw,sh,reg),how:"galleria"});

  frameP.then(function(F){
    if(C.closed)return;
    var t=C.node.querySelector(".ocr-toast");t.hidden=true;
    var sharp=sharpness(F.crop);
    // Epätarkka kuva: pyydetään uusi heti (kahden hylkäyksen jälkeen hyväksytään, ettei käyttäjä jumiudu)
    if(sharp<SHARP_MIN&&(C.blurRejects||0)<2){
      C.blurRejects=(C.blurRejects||0)+1;
      camToast(C.mode==="live"
        ?"Kuva on epätarkka. Napauta näyttöä tarkentaaksesi, pidä puhelin vakaana ja kuvaa uudelleen."
        :"Rajattu alue on epätarkka tai liian pieni. Rajaa tarkemmin tai valitse toinen kuva.");
      return;
    }
    C.blurRejects=0;
    var crop={x:Math.max(0,F.reg.x/F.sw),y:Math.max(0,F.reg.y/F.sh),w:Math.min(1,F.reg.w/F.sw),h:Math.min(1,F.reg.h/F.sh)};
    var s=Math.min(1,1600/Math.max(F.sw,F.sh)),full=document.createElement("canvas");
    full.width=Math.round(F.sw*s);full.height=Math.round(F.sh*s);full.getContext("2d").drawImage(F.src,0,0,full.width,full.height);
    var thumbUrl=thumbFrom(F.crop,112);
    var row=C.ctl.capture({cropCanvas:F.crop,fullCanvas:full,crop:crop,retakeRow:C.retake,thumbUrl:thumbUrl,sharp:Math.round(sharp),how:F.how});
    C.count++;
    addStripThumb(C,row,thumbUrl);
    if(C.retake){C.close(false);return;}
    C.node.querySelector(".cnt").textContent=C.count+" luettu · kuvaa seuraava";
    if(C.mode==="gallery")startLive(C);
  }).catch(function(err){
    camToast("Kuvaaminen epäonnistui: "+(err&&err.message?err.message:err));
  }).then(function(){
    C.busy=false;if(!C.closed&&(C.mode==="gallery"||C.stream))C.shutter.disabled=false;
  });
}
function thumbFrom(c,w){var t=document.createElement("canvas"),s=w/c.width;t.width=w;t.height=Math.round(c.height*s);
  t.getContext("2d").drawImage(c,0,0,t.width,t.height);return t.toDataURL("image/jpeg",0.7);}
function addStripThumb(C,row,url){
  var t=document.createElement("div");t.className="t busy";t.style.backgroundImage="url("+url+")";t.innerHTML="<i>…</i>";
  t._row=row;C.strip.appendChild(t);C.strip.scrollLeft=1e6;
}
function updateStrip(row){
  if(!cam)return;
  Array.prototype.forEach.call(cam.strip.children,function(t){
    if(t._row!==row)return;
    var bad=row._ocr.state==="error"||rowFlagged(row);
    t.className="t "+(bad?"warn":"ok");t.querySelector("i").textContent=bad?"!":"✓";
  });
}

/* ---------- Tarkistusnäkymä ---------- */
function openReview(ctl,row){
  injectCss();
  var f=ctl.field,m=f.ocr.map||{},o=row._ocr||{};
  var cols={};(f.columns||[]).forEach(function(c){cols[c.id]=c;});
  var defs=KEYS.filter(function(k){return m[k]&&cols[m[k]];});
  var node=el('<div class="ocr-cmp" role="dialog" aria-modal="true" aria-label="Tarkista lukemat"><div class="box">'+
    '<canvas></canvas><div class="body"><div class="big">'+
    defs.map(function(k){return '<div><label for="ocrc_'+k+'">'+esc(cols[m[k]].label)+'</label><input id="ocrc_'+k+'" data-k="'+k+'" inputmode="decimal" value="'+esc(fiNum(num(row[m[k]]),DEC[k]))+'"'+(o.flags&&o.flags[k]?' class="ocr-flag"':'')+'></div>';}).join("")+
    '</div><div class="chk"></div><div class="acts">'+
    '<button type="button" class="btn btn-outline" data-a="retake">Kuvaa uudelleen</button>'+
    '<button type="button" class="btn btn-primary" data-a="ok">Arvot oikein</button></div>'+
    '<details><summary>Tunnistuksen tiedot</summary><pre></pre></details></div></div></div>');
  node.querySelector("pre").textContent=
    "Kuvaustapa: "+(o.how||"–")+"\nTarkkuus: "+(o.sharp!==undefined?o.sharp:"–")+" (raja "+SHARP_MIN+")\n"+
    (o.read?"Tunnistettu: T "+o.read.T+", RH "+o.read.RH+", a "+o.read.a+"\n":"")+
    (o._raw?"\nTunnistettu teksti:\n"+o._raw:"\nTunnistettu teksti ei ole enää muistissa.");
  var R={close:function(fromPop){if(R.closed)return;R.closed=true;node.remove();popOverlay(fromPop);}};
  function check(){
    var get=function(k){var i=node.querySelector('[data-k="'+k+'"]');return i?num(i.value):null;};
    var T=get("T"),RH=get("RH"),a=get("a"),chk=node.querySelector(".chk");
    if(T===null||RH===null||a===null){chk.textContent="";chk.className="chk";return;}
    var calc=rhFromA(T,a),dev=Math.abs(RH-calc);
    chk.className="chk"+(dev>1.5?" bad":"");
    chk.textContent="Lämpötilasta ja abs. kosteudesta laskettu RH "+fiNum(calc,1)+" %"+(dev>1.5?" – ei täsmää luettuun RH:hon. Tarkista kuvasta.":" – täsmää.");
  }
  node.addEventListener("input",function(e){if(e.target.dataset.k){e.target.classList.remove("ocr-flag");check();}});
  node.addEventListener("click",function(e){
    if(e.target===node){R.close(false);return;}
    var a=e.target.closest("[data-a]");if(!a)return;
    if(a.dataset.a==="ok"){
      defs.forEach(function(k){
        var v=num(node.querySelector('[data-k="'+k+'"]').value),nv=v===null?"":v.toFixed(DEC[k]);
        if(String(row[m[k]]||"")!==nv){row[m[k]]=nv;o.edited=o.edited||{};o.edited[k]=true;}
      });
      o.flags={};o.alt=null;o.reviewed=true;
      R.close(false);ctl.changed(row);ctl.refreshRow(row);
    }else if(a.dataset.a==="retake"){R.close(false);setTimeout(function(){openCamera(ctl,row);},60);}
  });
  node.addEventListener("keydown",function(e){if(e.key==="Escape")R.close(false);});
  document.body.appendChild(node);pushOverlay(R);
  drawPhotoCrop(ctl,row,node.querySelector("canvas"),900);
  check();
  setTimeout(function(){var b=node.querySelector('[data-a=ok]');if(b)b.focus();},30);
}
// Piirtää rivin kuvasta näytön rajauksen; käyttää muistissa olevaa pikkukuvaa, jos kuvaa ei ole laitteella
function drawPhotoCrop(ctl,row,canvas,width){
  var o=row._ocr||{},p=ctl.opts.findPhoto(o.photoId),src=null;
  if(p&&p.url)src=p.url;else if(p&&p.blob instanceof Blob){try{p.url=URL.createObjectURL(p.blob);src=p.url;}catch(e){}}
  var useThumb=!src&&o._thumb;
  if(!src&&!useThumb){canvas.width=width;canvas.height=Math.round(width*0.5);var x=canvas.getContext("2d");
    x.fillStyle="#333";x.fillRect(0,0,canvas.width,canvas.height);x.fillStyle="#ccc";x.font=Math.round(width/22)+"px sans-serif";
    x.textAlign="center";x.fillText("Kuva ei ole tällä laitteella",canvas.width/2,canvas.height/2);return;}
  var im=new Image();
  im.onload=function(){
    var k=useThumb?{x:0,y:0,w:1,h:1}:(o.crop||{x:0,y:0,w:1,h:1});
    var sx=k.x*im.width,sy=k.y*im.height,sw=k.w*im.width,sh=k.h*im.height;
    canvas.width=width;canvas.height=Math.max(1,Math.round(width*sh/sw));
    canvas.getContext("2d").drawImage(im,sx,sy,sw,sh,0,0,canvas.width,canvas.height);
  };
  im.src=useThumb?o._thumb:src;
}

/* ---------- Taulukkokentän ohjain ----------
   opts: field, rows, readOnly, addRow(init)->row, inputFor(row,colId), statusAnchor(row)->tr,
         changed(row), addPhoto(blob,caption)->Promise<photo>, removePhoto(id), findPhoto(id),
         setCaption(id,text), toast(msg) */
function attach(opts){
  injectCss();
  var f=opts.field,map=(f.ocr&&f.ocr.map)||{};
  var ctl={field:f,opts:opts};
  controllers[f.id]=ctl;
  setTimeout(function(){getWorker().catch(function(){});},400);

  ctl.button=function(){
    var b=el('<button type="button" class="btn btn-primary" style="white-space:nowrap"><svg width="20" height="20" style="flex:none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>Lue mittarista</button>');
    b.onclick=function(){openCamera(ctl,null);};
    return b;
  };

  ctl.capture=function(c){
    var row=c.retakeRow,o;
    if(row){
      o=row._ocr=row._ocr||{};
      if(o.photoId)opts.removePhoto(o.photoId);
      o.photoId=null;
    }else{
      var init={};if(map.date)init[map.date]=todayIso();
      row=opts.addRow(init);
      o=row._ocr={};
    }
    o.state="reading";o.crop=c.crop;o.flags={};o.alt=null;o.edited={};o.reviewed=false;o.time=Date.now();
    o.sharp=c.sharp;o.how=c.how;
    Object.defineProperty(o,"_thumb",{value:c.thumbUrl,enumerable:false,writable:true,configurable:true});
    KEYS.forEach(function(k){if(map[k])row[map[k]]="";});
    ctl.refreshRow(row);
    c.fullCanvas.toBlob(function(blob){
      if(!blob)return;
      opts.addPhoto(blob,caption(row)).then(function(p){if(p){o.photoId=p.id;ctl.changed(row);ctl.decorate(row);}}).catch(function(){});
    },"image/jpeg",0.88);
    enqueue({row:row,field:f,canvas:c.cropCanvas,onDone:function(){ctl.changed(row);}});
    opts.changed(row);
    return row;
  };

  // Keskeytynyt tai epäonnistunut luku ajetaan uudelleen tallennetusta kuvasta
  ctl.rerun=function(row){
    var o=row._ocr,p=opts.findPhoto(o.photoId),src=p&&(p.url||(p.blob instanceof Blob?URL.createObjectURL(p.blob):null));
    if(!src){opts.toast&&opts.toast("Kuvaa ei löydy tältä laitteelta. Kuvaa näyttö uudelleen.");openCamera(ctl,row);return;}
    var im=new Image();
    im.onload=function(){
      var k=o.crop||{x:0,y:0,w:1,h:1};
      var cc=cropCanvas(im,im.width,im.height,{x:k.x*im.width,y:k.y*im.height,w:k.w*im.width,h:k.h*im.height});
      o.state="reading";ctl.refreshRow(row);
      enqueue({row:row,field:f,canvas:cc,onDone:function(){ctl.changed(row);}});
    };
    im.src=src;
  };

  function caption(row){
    var parts=(f.columns||[]).map(function(c){
      var v=row[c.id];if(v===undefined||v===null||String(v).trim()==="")return null;
      if(c.type==="date")v=fiDate(v);else if(c.type==="number"||c.type==="calc")v=String(v).replace(".",",");
      return c.label+" "+v;
    }).filter(Boolean);
    return (f.label||"Mittaus")+(parts.length?": "+parts.join(", "):" (lukulaitteen näyttö)");
  }
  ctl.changed=function(row){
    if(row&&row._ocr&&row._ocr.photoId)opts.setCaption(row._ocr.photoId,caption(row));
    opts.changed(row);
  };

  ctl.cellEdited=function(row,colId){
    var o=row._ocr;if(!o)return;
    KEYS.forEach(function(k){
      if(map[k]===colId){o.flags=o.flags||{};o.flags[k]=false;o.edited=o.edited||{};o.edited[k]=true;if(k!=="a")o.alt=null;}
    });
    ctl.decorate(row);
    if(o.photoId)opts.setCaption(o.photoId,caption(row));
  };

  ctl.refreshRow=function(row){
    if(opts.rows.indexOf(row)<0)return;
    KEYS.concat(["date"]).forEach(function(k){
      var id=map[k];if(!id)return;
      var inp=opts.inputFor(row,id);
      if(inp&&document.activeElement!==inp)inp.value=row[id]===undefined||row[id]===null?"":row[id];
    });
    ctl.decorate(row);
  };

  // Rivin merkinnät: epävarmat kentät, tila, pikkukuva ja vaihtoehtoinen tulkinta
  ctl.decorate=function(row){
    var tr=opts.statusAnchor(row);if(!tr)return;
    var o=row._ocr,st=rowState(f,row);
    KEYS.forEach(function(k){
      var inp=map[k]&&opts.inputFor(row,map[k]);if(!inp)return;
      inp.classList.toggle("ocr-reading",st==="reading");
      inp.classList.toggle("ocr-flag",!!(o&&o.state==="done"&&o.flags&&o.flags[k]));
      inp.placeholder=st==="reading"?"luetaan…":"";
    });
    var sr=tr.nextElementSibling&&tr.nextElementSibling.classList.contains("ocr-status-row")?tr.nextElementSibling:null;
    if(!o){if(sr)sr.remove();return;}
    if(!sr){
      sr=document.createElement("tr");sr.className="ocr-status-row";
      sr.innerHTML='<td colspan="'+((f.columns||[]).length+1)+'"></td>';
      tr.after(sr);
    }
    var td=sr.firstChild,dev=rowDeviation(f,row),txt,cls="ocr-status",extra="";
    if(st==="reading")txt="Luetaan lukemia…";
    else if(st==="interrupted"){cls+=" warn";txt="Lukeminen keskeytyi.";extra='<button type="button" class="lnk" data-a="rerun">Lue uudelleen</button>';}
    else if(st==="error"){cls+=" err";txt="Lukeminen epäonnistui"+(o.error?": "+o.error:"")+". Täytä arvot tai kuvaa uudelleen.";extra='<button type="button" class="lnk" data-a="rerun">Yritä uudelleen</button>';}
    else if(dev!==null&&dev>1.5){cls+=" warn";txt="RH ei täsmää lämpötilan ja abs. kosteuden kanssa (ero "+fiNum(dev,1)+" %-yks.)";}
    else if(rowFlagged(row)){cls+=" warn";txt=(o.sharp!==undefined&&o.sharp<800)?"Kuva oli osin epätarkka – tarkista merkityt arvot kuvasta":"Tarkista merkityt arvot kuvasta";}
    else txt=o.reviewed?"Tarkistettu kuvasta":"Luettu kuvasta";
    var altHtml="";
    if(o.alt&&st==="flagged")altHtml='<span class="ocr-alt">Kuvasta voi lukea myös: <button type="button" data-a="alt">RH '+fiNum(o.alt.RH,1)+' % / T '+fiNum(o.alt.T,1)+' °C</button></span>';
    td.innerHTML='<div class="'+cls+'"><button type="button" class="ocr-thumb" data-a="review" aria-label="Avaa kuva ja tarkista arvot"><canvas></canvas></button>'+
      '<div class="txt">'+esc(txt)+altHtml+'</div>'+extra+'</div>';
    drawPhotoCrop(ctl,row,td.querySelector(".ocr-thumb canvas"),128);
    td.onclick=function(e){
      var a=e.target.closest("[data-a]");if(!a)return;
      if(a.dataset.a==="review")openReview(ctl,row);
      else if(a.dataset.a==="rerun")ctl.rerun(row);
      else if(a.dataset.a==="alt"){
        if(map.RH)row[map.RH]=o.alt.RH.toFixed(1);
        if(map.T)row[map.T]=o.alt.T.toFixed(1);
        if(map.a&&o.alt.a!==null)row[map.a]=o.alt.a.toFixed(2);
        o.alt=null;o.flags.T=o.flags.RH=false;o.edited=o.edited||{};o.edited.T=o.edited.RH=true;
        ctl.refreshRow(row);ctl.changed(row);
      }
    };
  };
  return ctl;
}

/* ---------- Tallennusta edeltävä tarkistus ---------- */
function checkBeforeSave(fields,values){
  var res={pending:0,flagged:[]};
  (fields||[]).forEach(function(f){
    if(f.type!=="table"||!f.ocr||!f.ocr.enabled)return;
    (Array.isArray(values[f.id])?values[f.id]:[]).forEach(function(row,i){
      var st=rowState(f,row);
      if(st==="reading")res.pending++;
      else if(st==="flagged"||st==="interrupted"||st==="error")res.flagged.push({field:f,row:row,index:i});
    });
  });
  return res;
}
function reviewRow(item){
  var ctl=controllers[item.field.id];if(!ctl)return;
  var tr=ctl.opts.statusAnchor(item.row);
  if(tr)tr.scrollIntoView({block:"center",behavior:"smooth"});
  var st=rowState(item.field,item.row);
  if(st==="flagged")setTimeout(function(){openReview(ctl,item.row);},350);
}

window.LukulaiteOcr={attach:attach,checkBeforeSave:checkBeforeSave,reviewRow:reviewRow,preload:function(){getWorker().catch(function(){});},
  _test:{parseText:parseText,combine:combine,rhFromA:rhFromA,rowState:rowState}};
})();
