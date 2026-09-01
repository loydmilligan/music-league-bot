#!/usr/bin/env python3
"""
make_report.py — turn matrix_results.json into one self-contained HTML report.

No CDN, no build step: the data is inlined and the charts are hand-drawn SVG, so
the file works offline and survives being emailed to yourself.

Three views:
  Compare   charts — quality by context level, quality against cost, latency
  Detailed  every run, filterable, with the source and output side by side
  Rate      blind rating (model and level hidden) on a 3-axis rubric

Ratings live in localStorage and export as JSON, so a rating pass can be done in
several sittings and folded back in later.
"""
from __future__ import annotations
import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
RESULTS = HERE / "matrix_results.json"
OUT = HERE / "context-depth-report.html"

CSS = """
:root{--bg:#0f1115;--panel:#171a21;--line:#262b36;--tx:#e6e9ef;--dim:#98a2b3;
--acc:#7aa2f7;--good:#7ee787;--warn:#e3b341;--bad:#f7768e;--chip:#1f2430;}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--tx);
font:14px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
header{padding:22px 26px 0;max-width:1400px;margin:0 auto}
h1{font-size:21px;margin:0 0 4px}
.sub{color:var(--dim);font-size:13px;max-width:70ch}
main{max-width:1400px;margin:0 auto;padding:0 26px 60px}
nav{display:flex;gap:6px;margin:18px 0 20px;border-bottom:1px solid var(--line)}
nav button{background:none;border:0;color:var(--dim);padding:9px 15px;cursor:pointer;
font:inherit;border-bottom:2px solid transparent;margin-bottom:-1px}
nav button.on{color:var(--tx);border-bottom-color:var(--acc)}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:10px;
padding:16px 18px;margin-bottom:16px}
.panel h2{font-size:14px;margin:0 0 3px;letter-spacing:.02em}
.panel .note{color:var(--dim);font-size:12px;margin:0 0 14px;max-width:80ch}
.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(430px,1fr));gap:16px}
.filters{display:flex;flex-wrap:wrap;gap:14px;align-items:flex-end}
.f{display:flex;flex-direction:column;gap:4px}
.f label{font-size:11px;color:var(--dim);text-transform:uppercase;letter-spacing:.05em}
select,input[type=text]{background:var(--chip);color:var(--tx);border:1px solid var(--line);
border-radius:6px;padding:6px 9px;font:inherit;min-width:150px}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--dim);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.05em;
cursor:pointer;user-select:none;white-space:nowrap}
tbody tr:hover{background:#1b1f28}
.num{text-align:right;font-variant-numeric:tabular-nums}
.chip{display:inline-block;background:var(--chip);border:1px solid var(--line);
border-radius:20px;padding:1px 9px;font-size:11px;color:var(--dim);white-space:nowrap}
.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;
padding:14px 16px;margin-bottom:12px}
.card .meta{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;align-items:center}
.io{display:grid;grid-template-columns:1fr 1fr;gap:14px}
@media(max-width:820px){.io{grid-template-columns:1fr}}
.io h4{margin:0 0 5px;font-size:11px;color:var(--dim);text-transform:uppercase;letter-spacing:.05em}
.txt{white-space:pre-wrap;background:#12151c;border:1px solid var(--line);
border-radius:7px;padding:10px 12px;font-size:13px}
.txt.out{border-left:2px solid var(--acc)}
.bar{height:8px;background:var(--chip);border-radius:4px;overflow:hidden;min-width:52px}
.bar>i{display:block;height:100%;background:var(--acc)}
.rate{display:flex;flex-wrap:wrap;gap:16px;align-items:center;margin-top:12px;
padding-top:12px;border-top:1px solid var(--line)}
.rate .ax{display:flex;align-items:center;gap:7px}
.rate .ax span{font-size:11px;color:var(--dim);text-transform:uppercase;letter-spacing:.05em}
.stars{display:flex;gap:3px}
.stars button{width:24px;height:24px;border-radius:5px;border:1px solid var(--line);
background:var(--chip);color:var(--dim);cursor:pointer;font:inherit;font-size:12px;padding:0}
.stars button.on{background:var(--acc);color:#0b0d11;border-color:var(--acc)}
.muted{color:var(--dim)}
.legend{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:var(--dim);margin-top:8px}
.legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:5px}
.kpi{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px}
.kpi div{background:#12151c;border:1px solid var(--line);border-radius:8px;padding:11px 13px}
.kpi b{display:block;font-size:20px;font-variant-numeric:tabular-nums}
.kpi span{font-size:11px;color:var(--dim);text-transform:uppercase;letter-spacing:.05em}
.toolbar{display:flex;gap:9px;flex-wrap:wrap;align-items:center;margin-bottom:14px}
.btn{background:var(--chip);border:1px solid var(--line);color:var(--tx);border-radius:7px;
padding:7px 13px;cursor:pointer;font:inherit;font-size:13px}
.btn:hover{border-color:var(--acc)}
.btn.pri{background:var(--acc);color:#0b0d11;border-color:var(--acc);font-weight:600}
svg text{fill:var(--dim);font-size:10px}
#doss_body h2,#doss_body h3{color:var(--tx);margin:22px 0 8px;font-size:15px}
#doss_body h4,#doss_body h5{color:var(--acc);margin:16px 0 6px;font-size:13px}
#doss_body p{margin:8px 0;max-width:82ch}
#doss_body li{margin:4px 0;max-width:82ch}
#doss_body blockquote{border-left:2px solid var(--acc);margin:10px 0;padding:2px 0 2px 14px;
color:#c8cfdd;font-style:italic}
#doss_body code{background:var(--chip);padding:1px 5px;border-radius:4px;font-size:12px}
#doss_body hr{border:0;border-top:1px solid var(--line);margin:20px 0}
#doss_body table{margin:8px 0;width:auto}
.warnbox{background:#2a2113;border:1px solid #5a4a1e;color:#e3cf9a;border-radius:8px;
padding:11px 14px;font-size:13px;margin-bottom:16px}
"""

JS = r"""
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const LV=["L1_fingerprint","L2_kit","L3_situational","L4_full","L5_retrieved"];
const LVL=({L1_fingerprint:"L1 fingerprint",L2_kit:"L2 kit",L3_situational:"L3 situational",
L4_full:"L4 full dossier",L5_retrieved:"L5 retrieved"});
const MODELS=[...new Set(D.runs.map(r=>r.model_label))];
const COL=["#7aa2f7","#7ee787","#e3b341","#f7768e","#bb9af7"];
const colorOf=m=>COL[MODELS.indexOf(m)%COL.length];
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
const fmt=(v,d=2)=>v==null?"—":v.toFixed(d);

let RATINGS={};
try{RATINGS=JSON.parse(localStorage.getItem("ctxdepth_ratings")||"{}")}catch(e){}
const saveR=()=>localStorage.setItem("ctxdepth_ratings",JSON.stringify(RATINGS));
const rid=r=>[r.model,r.type,r.source_i,r.target,r.level].join("|");

/* ---------- charts (hand-rolled SVG so the file stays dependency-free) ---------- */
function groupedBars(el,{rows,groups,series,value,yMax,yLabel,fmtY}){
  const W=el.clientWidth||620,H=260,P={t:14,r:12,b:46,l:44};
  const iw=W-P.l-P.r, ih=H-P.t-P.b;
  const gw=iw/groups.length, bw=Math.min(30,(gw-10)/series.length);
  const max=yMax??Math.max(...rows.map(r=>value(r)||0),0.0001);
  let s=`<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}">`;
  for(let i=0;i<=4;i++){const y=P.t+ih-ih*i/4;
    s+=`<line x1="${P.l}" x2="${W-P.r}" y1="${y}" y2="${y}" stroke="#262b36"/>`;
    s+=`<text x="${P.l-7}" y="${y+3}" text-anchor="end">${fmtY?fmtY(max*i/4):(max*i/4).toFixed(2)}</text>`;}
  groups.forEach((g,gi)=>{
    const x0=P.l+gi*gw;
    s+=`<text x="${x0+gw/2}" y="${H-26}" text-anchor="middle">${LVL[g]||g}</text>`;
    series.forEach((se,si)=>{
      const row=rows.find(r=>r.group===g&&r.series===se); const v=row?value(row):null;
      if(v==null)return;
      const h=ih*(v/max), x=x0+(gw-bw*series.length)/2+si*bw, y=P.t+ih-h;
      s+=`<rect x="${x}" y="${y}" width="${bw-3}" height="${Math.max(1,h)}" rx="2" fill="${colorOf(se)}"><title>${se} · ${LVL[g]||g} · ${fmt(v,3)}</title></rect>`;
    });
  });
  s+=`<text x="${P.l}" y="${H-6}" >${yLabel||""}</text></svg>`;
  el.innerHTML=s;
}

function scatter(el,{pts,xLabel,yLabel}){
  const W=el.clientWidth||620,H=280,P={t:14,r:14,b:44,l:48};
  const iw=W-P.l-P.r, ih=H-P.t-P.b;
  const xs=pts.map(p=>p.x),ys=pts.map(p=>p.y);
  const xMax=Math.max(...xs)*1.12||1, yMax=Math.max(...ys)*1.12||1;
  let s=`<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}">`;
  for(let i=0;i<=4;i++){const y=P.t+ih-ih*i/4;
    s+=`<line x1="${P.l}" x2="${W-P.r}" y1="${y}" y2="${y}" stroke="#262b36"/>`;
    s+=`<text x="${P.l-7}" y="${y+3}" text-anchor="end">${(yMax*i/4).toFixed(2)}</text>`;}
  for(let i=0;i<=4;i++){const x=P.l+iw*i/4;
    s+=`<text x="${x}" y="${H-26}" text-anchor="middle">$${(xMax*i/4).toFixed(3)}</text>`;}
  pts.forEach(p=>{
    const x=P.l+iw*(p.x/xMax), y=P.t+ih-ih*(p.y/yMax);
    s+=`<circle cx="${x}" cy="${y}" r="${p.r||6}" fill="${colorOf(p.series)}" fill-opacity=".85" stroke="#0f1115"><title>${p.label}\n$${p.x.toFixed(4)} · ${p.y.toFixed(3)}</title></circle>`;
    s+=`<text x="${x+9}" y="${y+3}" font-size="9">${p.tag||""}</text>`;
  });
  s+=`<text x="${W/2}" y="${H-6}" text-anchor="middle">${xLabel}</text>`;
  s+=`<text x="12" y="${P.t+8}" font-size="10">${yLabel}</text></svg>`;
  el.innerHTML=s;
}

function legend(el){el.innerHTML=MODELS.map(m=>`<span><i style="background:${colorOf(m)}"></i>${m}</span>`).join("");}

/* horizontal bars — used for per-persona and per-source breakdowns */
function hbars(el,{items,max,fmtV}){
  if(!items.length){el.innerHTML='<p class="muted">No ratings yet.</p>';return}
  const m=max??Math.max(...items.map(i=>i.v||0),0.0001);
  el.innerHTML=items.map(i=>`<div style="display:flex;align-items:center;gap:9px;margin:5px 0">
    <span style="width:120px;font-size:12px;color:var(--dim)">${i.k}</span>
    <div class="bar" style="flex:1"><i style="width:${100*(i.v||0)/m}%;background:${i.c||'var(--acc)'}"></i></div>
    <span class="num" style="width:52px;font-size:12px">${fmtV?fmtV(i.v):fmt(i.v,2)}</span>
    <span class="muted" style="width:34px;font-size:11px">n=${i.n}</span></div>`).join("");
}

/* coverage heatmap — which arms you have actually rated, so you can see the gaps */
function heat(el,rows){
  const cells=MODELS.map(m=>`<tr><td style="font-size:12px">${m}</td>`+LV.map(l=>{
    const r=rows.find(x=>x.series===m&&x.group===l);
    const n=r?r.nrated:0, tot=r?r.n:0;
    const a=tot?n/tot:0;
    return `<td style="text-align:center;font-size:11px;background:rgba(122,162,247,${a*.72});
      color:${a>.5?'#0b0d11':'var(--dim)'}" title="${n} of ${tot} rated">${n}/${tot}</td>`;
  }).join("")+"</tr>").join("");
  el.innerHTML=`<table><tr><th></th>${LV.map(l=>`<th style="text-align:center">${LVL[l]}</th>`).join("")}</tr>${cells}</table>`;
}

/* Pearson correlation, used for judge-vs-you agreement */
function corr(xs,ys){
  const n=xs.length; if(n<3)return null;
  const mx=mean(xs),my=mean(ys);
  let a=0,b=0,c=0;
  for(let i=0;i<n;i++){const dx=xs[i]-mx,dy=ys[i]-my;a+=dx*dy;b+=dx*dx;c+=dy*dy}
  return (b&&c)?a/Math.sqrt(b*c):null;
}

/* every rated run, flattened — the basis for all the human-rating visuals */
function ratedRuns(){
  return D.runs.filter(r=>r.type==="to_person"&&RATINGS[rid(r)])
    .map(r=>({r,v:RATINGS[rid(r)]}))
    .filter(x=>x.v.funny||x.v.voice||x.v.faithful);
}

/* ---------- aggregation ---------- */
function agg(filterFn){
  const rows=[];
  for(const m of MODELS)for(const l of LV){
    const rs=D.runs.filter(r=>r.model_label===m&&r.level===l&&filterFn(r));
    if(!rs.length)continue;
    const judged=rs.filter(r=>r.judge);
    const rated=rs.map(r=>RATINGS[rid(r)]).filter(Boolean);
    rows.push({group:l,series:m,n:rs.length,
      p:mean(judged.map(r=>r.judge.p_subject)),
      hit:mean(judged.map(r=>r.judge.hit?1:0)),
      cost:mean(rs.map(r=>r.cost_usd)),
      ms:mean(rs.map(r=>r.latency_ms)),
      funny:mean(rated.map(r=>r.funny)),
      voice:mean(rated.map(r=>r.voice)),
      faith:mean(rated.map(r=>r.faithful)),
      nrated:rated.length});
  }
  return rows;
}

function renderCompare(){
  const person=r=>r.type==="to_person";
  const rows=agg(person);
  groupedBars($("#c_quality"),{rows,groups:LV,series:MODELS,value:r=>r.p,
    yLabel:"mean p(target) — judge"});
  groupedBars($("#c_cost"),{rows,groups:LV,series:MODELS,value:r=>r.cost,
    yLabel:"mean $ per translation",fmtY:v=>"$"+v.toFixed(3)});
  groupedBars($("#c_lat"),{rows,groups:LV,series:MODELS,value:r=>r.ms/1000,
    yLabel:"mean seconds",fmtY:v=>v.toFixed(1)+"s"});
  /* ---- everything below is driven by YOUR ratings and updates as you rate ---- */
  const rated=ratedRuns();
  const anyRated=rated.length>0;
  $("#human_wrap").style.display=anyRated?"":"none";
  $("#human_empty").style.display=anyRated?"none":"";
  heat($("#c_heat"),rows);

  if(anyRated){
    groupedBars($("#c_funny"),{rows,groups:LV,series:MODELS,value:r=>r.funny,
      yMax:5,yLabel:"mean FUNNY",fmtY:v=>v.toFixed(1)});
    groupedBars($("#c_voice"),{rows,groups:LV,series:MODELS,value:r=>r.voice,
      yMax:5,yLabel:"mean VOICE",fmtY:v=>v.toFixed(1)});
    groupedBars($("#c_faith"),{rows,groups:LV,series:MODELS,value:r=>r.faith,
      yMax:5,yLabel:"mean FAITHFUL",fmtY:v=>v.toFixed(1)});

    /* the chart that actually decides the default: funny per dollar */
    scatter($("#c_funnycost"),{pts:rows.filter(r=>r.funny!=null&&r.cost!=null).map(r=>({
      x:r.cost,y:r.funny,series:r.series,tag:r.group.split("_")[0],
      label:`${r.series} · ${LVL[r.group]} (n=${r.nrated})`})),
      xLabel:"mean cost per translation (USD)",yLabel:"FUNNY (1-5)"});
    legend($("#legend3"));

    /* does the judge agree with you? if not, the judge is measuring the wrong thing */
    const withJ=rated.filter(x=>x.r.judge);
    const cf=corr(withJ.filter(x=>x.v.funny).map(x=>x.r.judge.p_subject),
                  withJ.filter(x=>x.v.funny).map(x=>x.v.funny));
    const cv=corr(withJ.filter(x=>x.v.voice).map(x=>x.r.judge.p_subject),
                  withJ.filter(x=>x.v.voice).map(x=>x.v.voice));
    const cfv=corr(rated.filter(x=>x.v.funny&&x.v.voice).map(x=>x.v.voice),
                   rated.filter(x=>x.v.funny&&x.v.voice).map(x=>x.v.funny));
    $("#c_agree").innerHTML=`<div class="kpi">
      <div><b>${fmt(cv,2)}</b><span>judge ↔ your VOICE</span></div>
      <div><b>${fmt(cf,2)}</b><span>judge ↔ your FUNNY</span></div>
      <div><b>${fmt(cfv,2)}</b><span>your VOICE ↔ your FUNNY</span></div>
      <div><b>${rated.length}</b><span>rated so far</span></div></div>
      <p class="note" style="margin-top:10px">If <b>judge ↔ VOICE</b> is high, the classifier is a
      usable stand-in for "sounds like them". If <b>judge ↔ FUNNY</b> is low, recognisability and
      comedy are different things and only your ratings can pick the default. If <b>VOICE ↔ FUNNY</b>
      is low, the funniest translations are not the most accurate ones — which would be the most
      interesting result here.</p>`;

    /* which personas translate well, and which source material works */
    const byT={},byS={};
    for(const {r,v} of rated){
      if(!v.funny)continue;
      (byT[r.target]=byT[r.target]||[]).push(v.funny);
      (byS[D.sources[r.source_i].author]=byS[D.sources[r.source_i].author]||[]).push(v.funny);
    }
    hbars($("#c_bytarget"),{max:5,items:Object.entries(byT)
      .map(([k,a])=>({k,v:mean(a),n:a.length})).sort((a,b)=>b.v-a.v)});
    hbars($("#c_bysource"),{max:5,items:Object.entries(byS)
      .map(([k,a])=>({k,v:mean(a),n:a.length})).sort((a,b)=>b.v-a.v)});

    /* where you and the judge most disagree — the rows worth re-reading */
    const div=withJ.filter(x=>x.v.voice).map(x=>({...x,
      d:Math.abs((x.v.voice-1)/4 - x.r.judge.p_subject)})).sort((a,b)=>b.d-a.d).slice(0,8);
    $("#t_diverge").innerHTML=`<tr><th>Model</th><th>Level</th><th>Target</th>
      <th class=num>judge</th><th class=num>your voice</th><th class=num>gap</th><th>Output</th></tr>`+
      div.map(({r,v,d})=>`<tr><td>${r.model_label}</td><td>${LVL[r.level]}</td><td>${r.target}</td>
        <td class=num>${r.judge.p_subject.toFixed(2)}</td><td class=num>${v.voice}/5</td>
        <td class=num>${d.toFixed(2)}</td>
        <td style="max-width:420px;font-size:12px">${esc((r.text||"").slice(0,190))}…</td></tr>`).join("");
  }
  scatter($("#c_scatter"),{pts:rows.filter(r=>r.p!=null&&r.cost!=null).map(r=>({
    x:r.cost,y:r.p,series:r.series,tag:r.group.split("_")[0],
    label:`${r.series} · ${LVL[r.group]}`})),
    xLabel:"mean cost per translation (USD)",yLabel:"p(target)"});
  legend($("#legend1"));legend($("#legend2"));

  const en=agg(r=>r.type==="to_english").filter(r=>r.p!=null);
  $("#t_english").innerHTML=`<tr><th>Model</th><th>Level</th><th class=num>n</th>
    <th class=num>p(author) ↓ better</th><th class=num>$ / call</th></tr>`+
    en.map(r=>`<tr><td>${r.series}</td><td>${LVL[r.group]}</td><td class=num>${r.n}</td>
    <td class=num>${fmt(r.p,3)}</td><td class=num>$${fmt(r.cost,4)}</td></tr>`).join("");

  const tot=D.runs.reduce((a,r)=>a+(r.cost_usd||0),0);
  $("#kpis").innerHTML=[
    ["runs",D.runs.length],["spent","$"+tot.toFixed(3)],
    ["judge acc",fmt(D.judge_meta?.holdout_accuracy,3)],
    ["rated",Object.keys(RATINGS).length]
  ].map(([k,v])=>`<div><b>${v}</b><span>${k}</span></div>`).join("");

  $("#t_summary").innerHTML=`<tr><th>Model</th><th>Level</th><th class=num>n</th>
    <th class=num>p(target)</th><th class=num>top-1 hit</th><th class=num>$ / call</th>
    <th class=num>sec</th><th class=num>p per $</th><th class=num>funny</th></tr>`+
    rows.filter(r=>r.p!=null).sort((a,b)=>b.p-a.p).map(r=>`<tr>
      <td>${r.series}</td><td>${LVL[r.group]}</td><td class=num>${r.n}</td>
      <td class=num>${fmt(r.p,3)}</td><td class=num>${fmt(r.hit*100,0)}%</td>
      <td class=num>$${fmt(r.cost,4)}</td><td class=num>${fmt(r.ms/1000,1)}</td>
      <td class=num>${fmt(r.p/r.cost,0)}</td>
      <td class=num>${r.funny==null?"—":fmt(r.funny,1)}</td></tr>`).join("");
}

/* ---------- detailed ---------- */
function fillSelect(sel,vals,label){
  sel.innerHTML=`<option value="">${label}</option>`+vals.map(v=>`<option>${v}</option>`).join("");
}
function detailFilters(){
  return {model:$("#f_model").value,level:$("#f_level").value,type:$("#f_type").value,
    target:$("#f_target").value,src:$("#f_src").value,q:$("#f_q").value.toLowerCase()};
}
function matches(r,f){
  return (!f.model||r.model_label===f.model)&&(!f.level||r.level===f.level)
    &&(!f.type||r.type===f.type)&&(!f.target||r.target===f.target)
    &&(f.src===""||String(r.source_i)===f.src)
    &&(!f.q||(r.text||"").toLowerCase().includes(f.q));
}
function renderDetailed(){
  const f=detailFilters();
  const rs=D.runs.filter(r=>matches(r,f));
  $("#d_count").textContent=`${rs.length} of ${D.runs.length}`;
  $("#d_list").innerHTML=rs.map(r=>{
    const s=D.sources[r.source_i], j=r.judge;
    return `<div class="card">
      <div class="meta">
        <span class="chip" style="border-color:${colorOf(r.model_label)}">${r.model_label}</span>
        <span class="chip">${LVL[r.level]||r.level}</span>
        <span class="chip">${r.type==="to_person"?"→ "+r.target:"→ plain english"}</span>
        <span class="chip">src: ${s.author} (${s.kind})</span>
        <span class="chip">${(r.ctx_chars/4|0)} ctx tok</span>
        <span class="chip">$${(r.cost_usd||0).toFixed(5)}</span>
        <span class="chip">${((r.latency_ms||0)/1000).toFixed(1)}s</span>
        ${j?`<span class="chip" title="judge probability for ${j.subject}">
          p(${j.subject.split(" ")[0]})=${j.p_subject.toFixed(2)} ${j.hit?"✓":"✗"}</span>`:""}
      </div>
      <div class="io">
        <div><h4>Source — ${s.author}</h4><div class="txt">${esc(s.text)}</div></div>
        <div><h4>Output</h4><div class="txt out">${esc(r.text||"(empty)")}</div></div>
      </div>
      ${rateWidget(r,false)}
    </div>`;}).join("")||`<p class="muted">Nothing matches those filters.</p>`;
  bindRating();
}
const esc=s=>(s||"").replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));

/* ---------- rating ---------- */
const AX=[["voice","Voice"],["funny","Funny"],["faithful","Faithful"]];
function rateWidget(r,blind){
  const id=rid(r), cur=RATINGS[id]||{};
  return `<div class="rate" data-id="${id}">`+AX.map(([k,lab])=>
    `<div class="ax"><span>${lab}</span><div class="stars" data-ax="${k}">`+
    [1,2,3,4,5].map(n=>`<button data-n="${n}" class="${cur[k]===n?"on":""}">${n}</button>`).join("")+
    `</div></div>`).join("")+
    `<input type="text" placeholder="note (optional)" data-ax="note" value="${(cur.note||"").replace(/"/g,"&quot;")}" style="flex:1;min-width:180px">
    </div>`;
}
/* Any rating change updates the live tallies immediately — the whole point is to
   watch the picture form as you rate, not to wait for an export. */
function afterRate(){
  const n=Object.keys(RATINGS).length;
  $$(".rated_count").forEach(e=>e.textContent=n);
  const rated=ratedRuns();
  const f=mean(rated.filter(x=>x.v.funny).map(x=>x.v.funny));
  const v=mean(rated.filter(x=>x.v.voice).map(x=>x.v.voice));
  $$(".live_summary").forEach(e=>e.innerHTML=rated.length
    ? `<span class="chip">${rated.length} rated</span>
       <span class="chip">mean funny ${fmt(f,1)}</span>
       <span class="chip">mean voice ${fmt(v,1)}</span>`
    : `<span class="chip muted">no ratings yet</span>`);
  if($("#v_compare").style.display!=="none")renderCompare();
}
function bindRating(){
  $$(".stars button").forEach(b=>b.onclick=()=>{
    const wrap=b.closest(".rate"), ax=b.parentElement.dataset.ax, id=wrap.dataset.id;
    RATINGS[id]=RATINGS[id]||{};
    RATINGS[id][ax]=RATINGS[id][ax]===+b.dataset.n?null:+b.dataset.n;
    saveR();
    [...b.parentElement.children].forEach(x=>x.classList.toggle("on",+x.dataset.n===RATINGS[id][ax]));
    afterRate();
  });
  $$('.rate input[data-ax=note]').forEach(i=>i.onchange=()=>{
    const id=i.closest(".rate").dataset.id;
    RATINGS[id]=RATINGS[id]||{}; RATINGS[id].note=i.value; saveR(); afterRate();
  });
}
let blindQueue=[],blindPos=0;
function renderRate(){
  const onlyUn=$("#r_unrated").checked;
  blindQueue=D.runs.filter(r=>r.type==="to_person"&&(r.text||"").length>10)
    .filter(r=>!onlyUn||!RATINGS[rid(r)]||!RATINGS[rid(r)].funny);
  blindQueue.sort((a,b)=>(hash(rid(a))%997)-(hash(rid(b))%997)); // stable shuffle
  if(blindPos>=blindQueue.length)blindPos=0;
  const r=blindQueue[blindPos];
  $("#r_progress").textContent=blindQueue.length?`${blindPos+1} / ${blindQueue.length}`:"nothing to rate";
  if(!r){$("#r_card").innerHTML=`<p class="muted">All rated. Export below.</p>`;return;}
  const s=D.sources[r.source_i];
  $("#r_card").innerHTML=`<div class="card">
    <div class="meta"><span class="chip">asked for: ${r.target}</span>
    <span class="chip muted">model &amp; context level hidden</span></div>
    <div class="io">
      <div><h4>Source — ${s.author}</h4><div class="txt">${esc(s.text)}</div></div>
      <div><h4>Rewritten as ${r.target}</h4><div class="txt out">${esc(r.text)}</div></div>
    </div>${rateWidget(r,true)}</div>`;
  bindRating();
}
function hash(s){let h=0;for(let i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))>>>0;return h;}

function exportRatings(){
  const rows=D.runs.filter(r=>RATINGS[rid(r)]).map(r=>({
    model:r.model,model_label:r.model_label,level:r.level,type:r.type,
    source_i:r.source_i,source_author:r.source_author,target:r.target,
    judge_p:r.judge?r.judge.p_subject:null,cost_usd:r.cost_usd,
    ...RATINGS[rid(r)]}));
  const b=new Blob([JSON.stringify({rated_at:new Date().toISOString(),ratings:rows},null,1)],
    {type:"application/json"});
  const a=document.createElement("a");
  a.href=URL.createObjectURL(b);a.download="context-depth-ratings.json";a.click();
}

/* ---------- boot ---------- */
const TARGETED=[...new Set(D.runs.filter(r=>r.type==="to_person").map(r=>r.target))];
function renderDossiers(){
  const sel=$("#doss_pick");
  if(!sel.options.length){
    sel.innerHTML=Object.keys(DOSS).map(n=>
      `<option value="${n}">${n}${TARGETED.includes(n)?"":"  (not yet a target)"}</option>`).join("");
  }
  const q=$("#doss_q").value.trim();
  let html=DOSS[sel.value]||"";
  if(q){
    const rx=new RegExp("("+q.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+")","gi");
    html=html.replace(/>([^<]+)</g,(m,t)=>">"+t.replace(rx,'<mark style="background:#e3b341;color:#0b0d11">$1</mark>')+"<");
  }
  $("#doss_body").innerHTML=html;
}
function show(v){
  $$("nav button").forEach(b=>b.classList.toggle("on",b.dataset.v===v));
  $$("section").forEach(s=>s.style.display=s.id==="v_"+v?"":"none");
  if(v==="compare")renderCompare();
  if(v==="detailed")renderDetailed();
  if(v==="rate")renderRate();
  if(v==="dossiers")renderDossiers();
}
window.addEventListener("DOMContentLoaded",()=>{
  fillSelect($("#f_model"),MODELS,"all models");
  fillSelect($("#f_level"),LV.map(l=>l),"all levels");
  $("#f_level").innerHTML=`<option value="">all levels</option>`+LV.map(l=>`<option value="${l}">${LVL[l]}</option>`).join("");
  fillSelect($("#f_type"),["to_person","to_english"],"both types");
  fillSelect($("#f_target"),[...new Set(D.runs.map(r=>r.target))],"all targets");
  $("#f_src").innerHTML=`<option value="">all sources</option>`+
    D.sources.map((s,i)=>`<option value="${i}">${i}: ${s.author}</option>`).join("");
  $$("#v_detailed select,#v_detailed input").forEach(e=>e.oninput=renderDetailed);
  $$("nav button").forEach(b=>b.onclick=()=>show(b.dataset.v));
  $("#r_next").onclick=()=>{blindPos++;renderRate()};
  $("#r_prev").onclick=()=>{blindPos=Math.max(0,blindPos-1);renderRate()};
  $("#r_unrated").onchange=()=>{blindPos=0;renderRate()};
  $("#r_export").onclick=exportRatings;
  $("#doss_pick").onchange=renderDossiers; $("#doss_q").oninput=renderDossiers;
  $("#d_export").onclick=exportRatings;
  afterRate();
  show("compare");
  window.addEventListener("resize",()=>{if($("#v_compare").style.display!=="none")renderCompare()});
});
"""


def md_to_html(md: str) -> str:
    """Minimal markdown -> HTML. The dossiers use a narrow subset (headings, bold,
    italics, blockquotes, lists, hr, tables), so a full parser would be overkill."""
    import html as _h
    out, in_ul, in_ol, in_bq = [], False, False, False

    def close():
        nonlocal in_ul, in_ol, in_bq
        if in_ul: out.append("</ul>"); in_ul = False
        if in_ol: out.append("</ol>"); in_ol = False
        if in_bq: out.append("</blockquote>"); in_bq = False

    def inline(t: str) -> str:
        t = _h.escape(t)
        t = re.sub(r"`([^`]+)`", r"<code>\1</code>", t)
        t = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", t)
        t = re.sub(r"(?<!\*)\*([^*\n]+)\*(?!\*)", r"<em>\1</em>", t)
        return t

    for raw in md.splitlines():
        ln = raw.rstrip()
        if not ln.strip():
            close(); continue
        m = re.match(r"^(#{1,6})\s+(.*)$", ln)
        if m:
            close(); lvl = min(len(m.group(1)) + 1, 6)
            out.append(f"<h{lvl}>{inline(m.group(2))}</h{lvl}>"); continue
        if re.match(r"^---+$", ln.strip()):
            close(); out.append("<hr>"); continue
        if ln.lstrip().startswith(">"):
            if not in_bq: close(); out.append("<blockquote>"); in_bq = True
            out.append(f"<p>{inline(ln.lstrip()[1:].strip())}</p>"); continue
        m = re.match(r"^\s*[-*]\s+(.*)$", ln)
        if m:
            if not in_ul: close(); out.append("<ul>"); in_ul = True
            out.append(f"<li>{inline(m.group(1))}</li>"); continue
        m = re.match(r"^\s*(\d+)\.\s+(.*)$", ln)
        if m:
            if not in_ol: close(); out.append("<ol>"); in_ol = True
            out.append(f"<li>{inline(m.group(2))}</li>"); continue
        if ln.lstrip().startswith("|"):
            cells = [c.strip() for c in ln.strip().strip("|").split("|")]
            if all(re.match(r"^:?-{2,}:?$", c) for c in cells):
                continue
            close(); out.append("<table><tr>" +
                "".join(f"<td>{inline(c)}</td>" for c in cells) + "</tr></table>")
            continue
        close(); out.append(f"<p>{inline(ln)}</p>")
    close()
    return "\n".join(out)


def load_dossiers() -> dict:
    """Every profile, rendered. Read while rating: the question 'does this sound like
    him?' is much easier to answer with the description in front of you."""
    out = {}
    for f in sorted((HERE / "profiles").glob("*.md")):
        name = f.stem.replace("_", " ")
        out[name] = md_to_html(f.read_text(encoding="utf-8"))
    return out


def build(d: dict) -> str:
    n = len(d["runs"])
    spent = sum(r.get("cost_usd", 0) for r in d["runs"])
    models = sorted({r["model_label"] for r in d["runs"]})
    judged = sum(1 for r in d["runs"] if r.get("judge"))
    acc = (d.get("judge_meta") or {}).get("holdout_accuracy")
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Context depth — #trans2 spike</title><style>{CSS}</style></head><body>
<header>
<h1>How much dossier does a translation need?</h1>
<p class="sub">{n} generations across {len(models)} models &times; 5 context depths &times; 2 command
types, for ${spent:.2f}. The judge is the 5-way style classifier trained on the real Boarz
corpus ({acc:.3f} cross-val accuracy against ~0.20 chance); it measures whether an output is
<em>recognisably</em> the target. It cannot measure funny — that is what the Rate tab is for.</p>
</header>
<main>
<nav>
<button data-v="compare" class="on">Compare</button>
<button data-v="detailed">Detailed</button>
<button data-v="rate">Rate (blind)</button>
<button data-v="dossiers">Dossiers</button>
</nav>

<section id="v_compare">
  <div class="panel"><div class="kpi" id="kpis"></div></div>

  <div class="warnbox">The judge was trained on human messages and is being asked to score
  model output — out-of-distribution, so absolute probabilities mean little. Read it only as a
  <em>relative</em> ranking across arms on identical inputs. {judged} of {n} runs scored.</div>

  <div class="grid2">
    <div class="panel"><h2>Recognisability by context depth</h2>
      <p class="note">Mean probability the judge assigns to the persona we asked for. Higher is better.</p>
      <div id="c_quality"></div><div class="legend" id="legend1"></div></div>
    <div class="panel"><h2>Quality against cost</h2>
      <p class="note">Each dot is one model at one depth. Up is better, left is cheaper —
      the top-left dot is the best deal.</p>
      <div id="c_scatter"></div><div class="legend" id="legend2"></div></div>
    <div class="panel"><h2>Cost per translation</h2>
      <p class="note">What each arm actually costs, from OpenRouter's own usage accounting.</p>
      <div id="c_cost"></div></div>
    <div class="panel"><h2>Latency</h2>
      <p class="note">The real constraint on deep context in a live chat — a joke that lands
      20 seconds late does not land.</p>
      <div id="c_lat"></div></div>
  </div>

  <div class="panel"><h2>Rating coverage</h2>
    <p class="note">How much of each arm you have rated. Pale cells are arms whose human numbers
    are not yet trustworthy — the means above them will move.</p>
    <div id="c_heat"></div></div>

  <p id="human_empty" class="panel muted" style="margin:0 0 16px">
    Your ratings drive the section below. Rate a few on the <b>Rate</b> tab and these charts
    appear here, updating as you go.</p>

  <div id="human_wrap" style="display:none">
    <div class="panel"><h2>Does the judge agree with you?</h2>
      <div id="c_agree"></div></div>

    <div class="grid2">
      <div class="panel"><h2>Funny against cost — the deciding chart</h2>
        <p class="note">Up is funnier, left is cheaper. Whatever sits top-left is the default,
        regardless of what the judge preferred.</p>
        <div id="c_funnycost"></div><div class="legend" id="legend3"></div></div>
      <div class="panel"><h2>Funny by context depth</h2>
        <div id="c_funny"></div></div>
      <div class="panel"><h2>Voice by context depth</h2>
        <p class="note">Sounds like them. Compare against the judge chart above — where they
        disagree, one of the two is wrong.</p>
        <div id="c_voice"></div></div>
      <div class="panel"><h2>Faithful by context depth</h2>
        <p class="note">Still means what the original meant. A funny translation that loses the
        point is a different failure from an unfunny one.</p>
        <div id="c_faith"></div></div>
      <div class="panel"><h2>Which personas translate funniest</h2>
        <p class="note">Mean FUNNY by target. Predicts which aliases are worth shipping first.</p>
        <div id="c_bytarget"></div></div>
      <div class="panel"><h2>Which source material works</h2>
        <p class="note">Mean FUNNY by whose message was being translated.</p>
        <div id="c_bysource"></div></div>
    </div>

    <div class="panel"><h2>Where you and the judge most disagree</h2>
      <p class="note">The rows worth re-reading. A high judge score you rated low means the
      classifier is being fooled by surface tics; the reverse means it is missing something real.</p>
      <table id="t_diverge"></table></div>
  </div>

  <div class="panel"><h2>Every arm, ranked</h2>
    <p class="note">"p per $" is recognisability bought per dollar — the value column.</p>
    <table id="t_summary"></table></div>

  <div class="panel"><h2>Deflation arm (#trans2english)</h2>
    <p class="note">Inverted: a good plain-English translation should make the author
    <em>un</em>recognisable, so a LOWER probability is better here.</p>
    <table id="t_english"></table></div>
</section>

<section id="v_detailed" style="display:none">
  <div class="panel"><h2>Filters</h2>
    <div class="filters">
      <div class="f"><label>Model</label><select id="f_model"></select></div>
      <div class="f"><label>Context level</label><select id="f_level"></select></div>
      <div class="f"><label>Type</label><select id="f_type"></select></div>
      <div class="f"><label>Target</label><select id="f_target"></select></div>
      <div class="f"><label>Source</label><select id="f_src"></select></div>
      <div class="f"><label>Search output</label><input type="text" id="f_q" placeholder="text contains…"></div>
      <div class="f"><label>Showing</label><span id="d_count" class="chip"></span></div>
      <div class="f"><label>&nbsp;</label><button class="btn" id="d_export">Export ratings</button></div>
    </div></div>
  <div id="d_list"></div>
</section>

<section id="v_rate" style="display:none">
  <div class="panel"><h2>Blind rating</h2>
    <p class="note">Model and context depth are hidden on purpose — otherwise you will rate the
    label rather than the writing. <b>Voice</b>: does it sound like them? <b>Funny</b>: did it
    land? <b>Faithful</b>: does it still mean what the original meant? Saved in this browser as
    you go; export when done.</p>
    <div class="toolbar">
      <button class="btn" id="r_prev">← Previous</button>
      <button class="btn pri" id="r_next">Next →</button>
      <span class="chip" id="r_progress"></span>
      <label class="muted"><input type="checkbox" id="r_unrated" checked> unrated only</label>
      <button class="btn" id="r_export">Export ratings JSON</button>
    </div>
    <div class="toolbar live_summary"></div>
    <div id="r_card"></div>
  </div>
</section>

<section id="v_dossiers" style="display:none">
  <div class="panel"><h2>Persona dossiers</h2>
    <p class="note">All ten, as written. The five NOT yet used as translation targets
    (Shane, Jimmy, Clements, Steiny, Darren) are marked &mdash; no translation in this
    report was generated from them.</p>
    <div class="filters">
      <div class="f"><label>Player</label><select id="doss_pick"></select></div>
      <div class="f"><label>Find</label><input type="text" id="doss_q" placeholder="search within…"></div>
    </div>
  </div>
  <div class="panel" id="doss_body"></div>
</section>
</main>
<script>const D={json.dumps(d)};const DOSS={json.dumps(load_dossiers())};</script>
<script>{JS}</script>
</body></html>"""


if __name__ == "__main__":
    d = json.loads(RESULTS.read_text())
    OUT.write_text(build(d), encoding="utf-8")
    print(f"{OUT}  ({OUT.stat().st_size/1024:.0f} KB, {len(d['runs'])} runs)")
