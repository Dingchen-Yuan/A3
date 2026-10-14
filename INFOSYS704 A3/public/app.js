const API = '';
let CFG = { sapWriteMode: 'simulate' };
let LINES = [];
let STATE = { currentLine: null, adjust: null };

function $(sel, root=document){ return root.querySelector(sel); }
function $all(sel, root=document){ return Array.from(root.querySelectorAll(sel)); }

async function api(path, opts={}) {
  const r = await fetch(API + path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts));
  if (!r.ok) {
    const t = await r.text();
    throw new Error(t || r.statusText);
  }
  return r.json();
}

function escapeHtml(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function coloursOf(line){ return line.colours; }
function sizesOf(line){ return line.sizes; }
// progress
function progress(active){
  const steps=['Dashboard','Review signal','Adjust mix','Confirm mix lock'];
  return `<div class="progress">${steps.map((s,i)=>{
    const n=i+1;
    const cls = n<active?'done':n===active?'active':'';
    return `<div class="step ${cls}"><div class="circle">${n}</div>${s}</div>`;
  }).join('')}</div>`;
}

// ---------- Views ----------
async function viewDashboard(){
  const root=$('#app');
  root.innerHTML=`<div class="empty"><span class="spinner"></span> Loading dashboard…</div>`;
  try {
    if(!LINES.length){
      const d=await api('/api/lines');
      LINES=d.lines;
    }
  } catch(e){
    root.innerHTML=`<div class="empty">Failed to load lines: ${escapeHtml(e.message)}</div>`;
    return;
  }
  const cfg=await api('/api/config').catch(()=>({sapWriteMode:'simulate'}));
  CFG=cfg;
  updateModeBadge();

  const lines=LINES;
  const locked=lines.filter(l=>l.status==='Mix locked');
  const awaiting=lines.filter(l=>l.status!=='Mix locked');
  const totalCommitted=lines.reduce((s,l)=>s+(l.sap?l.sap.committedQuantity:0),0);
  const pctLocked = lines.length? Math.round(locked.length/lines.length*100):0;
  // projected markdown risk: locked lines count suggested/locked split risk; awaiting lines count even split
  let projectedRisk=0;
  let originalEvenRisk=0;
  for(const l of lines){
    const committed=l.sap?l.sap.committedQuantity:0;
    if(!committed) continue;
    const even=evenAlloc(l,committed);
    originalEvenRisk += riskAmount(even,committed,l);
    let alloc=even;
    if(l.status==='Mix locked'){
      if(l.lockedDetail && l.lockedDetail.finalSplit){
        const vars=variantList(l);
        alloc=vars.map(v=>{
          const f=l.lockedDetail.finalSplit.find(x=>x.colour===v.colour && x.size===v.size);
          return Object.assign({},v,{qty:f?f.qty:v.qty});
        });
      } else {
        alloc=suggestAlloc(l,committed);
      }
    }
    projectedRisk += riskAmount(alloc,committed,l);
  }
  const savedRisk = originalEvenRisk - projectedRisk;

  let html=``;
  if(CFG.sapWriteMode!=='live'){
    html+=`<div class="banner-sim"><span>⚠</span><div><strong>Simulation mode</strong> — SAP sandbox is read-only. Mix-lock requests are built exactly for S/4HANA and saved locally. <span style="opacity:.8">Ready for Kmart's production S/4HANA system.</span></div></div>`;
  }
  html+=`<h1 class="page-title">Anko Mix-Lock Dashboard</h1>`;
  html+=`<p class="page-sub">Deferred mix allocation — commit total volume at G1, lock colour/size split at mix-lock gate.</p>`;
  html+=`<div class="kpi-grid">
    <div class="kpi"><div class="label">Lines awaiting mix lock</div><div class="value">${awaiting.length}</div><div class="hint">of ${lines.length} Anko lines</div></div>
    <div class="kpi"><div class="label">Total committed units</div><div class="value">${totalCommitted.toLocaleString()}</div><div class="hint">from SAP purchase orders</div></div>
    <div class="kpi"><div class="label">% lines locked</div><div class="value">${pctLocked}%</div><div class="hint">${locked.length} locked</div></div>
    <div class="kpi"><div class="label">Projected markdown risk</div><div class="value">${projectedRisk.toLocaleString()}</div><div class="hint">was ${originalEvenRisk.toLocaleString()} at even split · saved ${savedRisk.toLocaleString()}</div></div>
  </div>`;

  html+=`<div class="card">
    <h3 style="margin-top:0;">Anko lines awaiting mix lock</h3>
    <table>
      <thead><tr><th>Anko line</th><th>SAP PO</th><th>Supplier</th><th>PO date</th><th>SAP committed qty</th><th>Status</th><th></th></tr></thead>
      <tbody>`;
  for(const l of lines){
    const sap=l.sap||{};
    const badge=l.status==='Mix locked'?'<span class="badge badge-locked">Mix locked</span>':'<span class="badge badge-g1">G1 committed</span>';
    const comp=committedLink(l);
    html+=`<tr>
      <td><a class="line-link" href="#/line/${l.id}">${escapeHtml(l.name)}</a><div style="font-size:12px;color:#6b7280;">${escapeHtml(l.category)}</div></td>
      <td>${escapeHtml(sap.PurchaseOrder||l.poNumber)}</td>
      <td>${escapeHtml(sap.Supplier||'—')}</td>
      <td>${escapeHtml(sap.PurchaseOrderDate||'—')}</td>
      <td>${(sap.committedQuantity||0).toLocaleString()}</td>
      <td>${badge}${l.cached?' <span class="badge badge-cached">Cached SAP data</span>':''}</td>
      <td><a class="btn btn-sm btn-outline" href="#/line/${l.id}">Review</a></td>
    </tr>`;
  }
  html+=`</tbody></table></div>`;

  // recent writes link
  const writes=await api('/api/writes').catch(()=>({writes:[]}));
  if(writes.writes && writes.writes.length){
    html+=`<div class="card" style="margin-top:16px;">
      <h3 style="margin-top:0;">Recent simulated SAP requests</h3>
      <table><thead><tr><th>ID</th><th>Mode</th><th>PO</th><th>Line</th><th>Created</th><th></th></tr></thead><tbody>`;
    for(const w of writes.writes.slice(0,5)){
      html+=`<tr><td>${w.id}</td><td>${w.mode}</td><td>${w.poNumber}</td><td>${w.lineId}</td><td>${w.createdAt}</td><td><button class="btn btn-sm btn-outline" onclick="showWrite('${w.id}')">View</button></td></tr>`;
    }
    html+=`</tbody></table></div>`;
  }

  root.innerHTML=html;
}

function committedLink(l){ return l; }

async function viewLine(id){
  const root=$('#app');
  root.innerHTML=`<div class="empty"><span class="spinner"></span> Loading line…</div>`;
  let line;
  try { line=await api('/api/lines/'+id); LINES=LINES.map(l=>l.id===id?line:l); if(!LINES.find(l=>l.id===id)) LINES.push(line); }
  catch(e){ root.innerHTML=`<div class="empty">Failed: ${escapeHtml(e.message)}</div>`; return; }
  STATE.currentLine=line;
  const committed=line.sap?line.sap.committedQuantity:0;
  const variants=variantList(line);

  // heatmap colour for signal (3-week total)
  const flat=variants.map(v=>v.signal);
  const maxSig=Math.max(...flat,1);

  let html=progress(2);
  html+=`<h1 class="page-title">Review signal — ${escapeHtml(line.name)}</h1>`;
  html+=`<p class="page-sub">${escapeHtml(line.category)} · ${variants.length} variants (colour × size)</p>`;

  // PO header
  html+=`<div class="card" style="margin-bottom:16px;">
    <h3 style="margin-top:0;">G1 commitment from SAP (PurchaseOrder ${escapeHtml(line.poNumber)}) ${line.cached?' <span class="badge badge-cached">Cached SAP data</span>':''}</h3>`;
  const sap=line.sap||{};
  html+=`<div class="info-grid">
    <div><span class="k">PO number</span><br><strong>${escapeHtml(sap.PurchaseOrder||line.poNumber)}</strong></div>
    <div><span class="k">Supplier</span><br><strong>${escapeHtml(sap.Supplier||'—')}</strong></div>
    <div><span class="k">PO date</span><br><strong>${escapeHtml(sap.PurchaseOrderDate||'—')}</strong></div>
    <div><span class="k">Committed quantity</span><br><strong>${(sap.committedQuantity||0).toLocaleString()} ${escapeHtml((sap.items&&sap.items[0]&&sap.items[0].PurchaseOrderQuantityUnit)||'PC')}</strong></div>
    <div><span class="k">Company code</span><br><strong>${escapeHtml(sap.CompanyCode||'1710')}</strong></div>
    <div><span class="k">Status</span><br>${line.status==='Mix locked'?'<span class="badge badge-locked">Mix locked</span>':'<span class="badge badge-g1">G1 committed</span>'}</div>
  </div>`;
  if(sap.items && sap.items.length){
    html+=`<div style="margin-top:12px;overflow:auto;"><table style="font-size:12px;">
      <thead><tr><th>Item</th><th>Text</th><th>Qty</th><th>Plant</th><th>Req. tracking</th></tr></thead><tbody>`;
    for(const it of sap.items){
      html+=`<tr><td>${escapeHtml(it.PurchaseOrderItem)}</td><td>${escapeHtml(it.PurchaseOrderItemText)}</td><td>${(it.OrderQuantity||0).toLocaleString()}</td><td>${escapeHtml(it.Plant)}</td><td>${escapeHtml(it.RequirementTracking||'—')}</td></tr>`;
    }
    html+=`</tbody></table></div>`;
  }
  html+=`</div>`;

  // heatmap demand
  html+=`<div class="card" style="margin-bottom:16px;">
    <h3 style="margin-top:0;">Early demand signal — 3 weeks trial-store sell-through (units)</h3>
    <p style="font-size:13px;color:#6b7280;margin:0 0 10px;">Heatmap: darker = higher sell-through. Used to suggest the mix split.</p>
    <table class="heatmap">
      <thead><tr><th>Colour \\ Size</th>${line.sizes.map(s=>`<th>${escapeHtml(s)}</th>`).join('')}<th>Row total</th></tr></thead>
      <tbody>`;
  for(let ci=0;ci<line.colours.length;ci++){
    let rowsum=0;
    html+=`<tr><th style="text-align:left;background:#f9fafb;">${escapeHtml(line.colours[ci])}</th>`;
    for(let si=0;si<line.sizes.length;si++){
      const val=line.signal[ci][si];
      rowsum+=val;
      const intensity=Math.min(1, val/maxSig);
      const bg=`rgba(37,99,235,${0.12+intensity*0.75})`;
      const fg=intensity>0.5?'#fff':'#1f2937';
      html+=`<td style="background:${bg};color:${fg};">${val}</td>`;
    }
    html+=`<td style="background:#f3f4f6;font-weight:700;">${rowsum}</td></tr>`;
  }
  // column totals
  html+=`<tr><th style="background:#f3f4f6;">Total</th>`;
  let colsumTotal=0;
  for(let si=0;si<line.sizes.length;si++){
    let c=0; for(let ci=0;ci<line.colours.length;ci++) c+=line.signal[ci][si]; colsumTotal+=c;
    html+=`<td style="background:#f3f4f6;font-weight:700;">${c}</td>`;
  }
  html+=`<td style="background:#f3f4f6;font-weight:700;">${colsumTotal}</td></tr>`;
  html+=`</tbody></table>`;

  // simple bars by colour total
  html+=`<div class="chart" style="margin-top:16px;">`;
  let colourTotals=line.colours.map((c,ci)=>({c,val:line.sizes.reduce((s,_,si)=>s+line.signal[ci][si],0)}));
  const maxCT=Math.max(...colourTotals.map(x=>x.val),1);
  for(const ct of colourTotals){
    const h=Math.round(ct.val/maxCT*100);
    html+=`<div class="bar" style="height:${h}%" title="${ct.c}: ${ct.val}"><span>${ct.c}</span></div>`;
  }
  html+=`</div>`;
  html+=`</div>`;

  // locked info if locked
  if(line.lockedDetail){
    html+=`<div class="banner-sim" style="background:#ecfdf5;border-color:#a7f3d0;color:#065f46;"><strong>Mix locked</strong> on ${escapeHtml(line.lockedDetail.at)} — view SAP request ${escapeHtml(line.lockedDetail.writeId)}.</div>`;
  }

  html+=`<div style="margin-top:16px;display:flex;gap:10px;">
    ${line.status==='Mix locked'?'<a class="btn btn-outline" href="#/dashboard">← Back to dashboard</a>':'<a class="btn" href="#/adjust/'+line.id+'">Adjust mix →</a>'}
  </div>`;

  root.innerHTML=html;
}

async function viewAdjust(id){
  const root=$('#app');
  root.innerHTML=`<div class="empty"><span class="spinner"></span> Loading…</div>`;
  let line=STATE.currentLine && STATE.currentLine.id===id ? STATE.currentLine : LINES.find(l=>l.id===id);
  if(!line){
    try { line=await api('/api/lines/'+id); }
    catch(e){ root.innerHTML=`<div class="empty">Failed: ${escapeHtml(e.message)}</div>`; return; }
  }
  STATE.currentLine=line;
  const committed=line.sap?line.sap.committedQuantity:0;
  if(!STATE.adjust || STATE.adjust.lineId!==id){
    const suggested=suggestAlloc(line,committed);
    const original=evenAlloc(line,committed);
    STATE.adjust={ lineId:id, committed, split:suggested.map(v=>({...v})), suggested: suggested.map(v=>v.qty), original };
  }
  const adj=STATE.adjust;
  const pack=line.casePack||12;

  let html=progress(3);
  html+=`<h1 class="page-title">Adjust mix — ${escapeHtml(line.name)}</h1>`;
  html+=`<p class="page-sub">Committed volume (from SAP): <strong>${committed.toLocaleString()} units</strong>. Each variant minimum 5%, rounded to case packs of ${pack}, must sum exactly.</p>
  <p style="font-size:12px;color:#6b7280;margin:0 0 12px;">SAP PO ${line.sap?line.sap.PurchaseOrder:line.poNumber} · item 10 · live from S/4HANA sandbox</p>`;

  html+=`<div class="grid3"><div>`;
  html+=`<div class="card">
    <h3 style="margin-top:0;">Variant split</h3>
    <table>
      <thead><tr><th>Colour</th><th>Size</th><th>3-wk signal</th><th>Even split</th><th>Suggested</th><th>Quantity (units)</th></tr></thead>
      <tbody>`;
  adj.split.forEach((v,idx)=>{
    html+=`<tr>
      <td>${escapeHtml(v.colour)}</td>
      <td>${escapeHtml(v.size)}</td>
      <td style="color:#6b7280;">${v.signal}</td>
      <td style="color:#6b7280;">${(STATE.adjust.original[idx].qty).toLocaleString()}</td>
      <td style="color:#6b7280;">${(STATE.adjust.suggested[idx]).toLocaleString()}</td>
      <td><input type="number" min="0" step="${pack}" data-idx="${idx}" value="${v.qty}" class="qty-input ${v.qty!==STATE.adjust.suggested[idx]?'changed':''}" /></td>
    </tr>`;
  });
  html+=`</tbody></table>
    <div class="total-bar" id="totalBar"></div>
    <div style="display:flex;gap:10px;margin-top:10px;">
      <button class="btn btn-outline" onclick="resetSuggestion()">Reset to suggestion</button>
      <button class="btn" id="continueBtn" onclick="goConfirm('${line.id}')">Continue to confirm →</button>
    </div>
  </div></div>`;

  // side panel risk
  const origRisk=riskAmount(adj.original,committed,line);
  html+=`<div class="sidepanel">
    <h3 style="margin-top:0;">Projected markdown risk</h3>
    <div class="risk-row"><span>Original even split</span><strong>$${origRisk.toLocaleString()}</strong></div>
    <div class="risk-row"><span>Suggested split</span><strong id="suggRisk">$${riskAmount(adj.split,committed,line).toLocaleString()}</strong></div>
    <div class="risk-row" style="border-top:1px solid #e5e7eb;padding-top:8px;margin-top:8px;"><span>Risk reduction</span><strong id="riskRed" style="color:#065f46;">$${(origRisk-riskAmount(adj.split,committed,line)).toLocaleString()}</strong></div>
    <p style="font-size:12px;color:#6b7280;margin-top:10px;">Risk = excess units above demand-proportional ideal × unit price × markdown %. Suggested split tracks early sell-through.</p>
  </div>`;

  html+=`</div>`; // grid

  root.innerHTML=html;
  bindAdjust(line,committed);
  updateTotalBar(line,committed);
}

function bindAdjust(line,committed){
  const inputs=$all('.qty-input');
  inputs.forEach(inp=>{
    inp.addEventListener('input',()=>{
      const idx=Number(inp.dataset.idx);
      STATE.adjust.split[idx].qty=Number(inp.value)||0;
      updateTotalBar(line,committed);
    });
  });
}
function updateTotalBar(line,committed){
  const pack=line.casePack||12;
  const total=STATE.adjust.split.reduce((s,v)=>s+v.qty,0);
  const diff=total-committed;
  const valid = diff===0;
  const msg = valid ? `<span class="ok">✓ Total ${total.toLocaleString()} = committed volume</span>` :
    (diff>0 ? `<span class="bad">Total ${total.toLocaleString()} exceeds committed by ${diff.toLocaleString()}</span>` :
      `<span class="bad">Total ${total.toLocaleString()} is ${Math.abs(diff).toLocaleString()} short of committed</span>`);
  // case pack warning
  const badPacks=STATE.adjust.split.filter(v=>v.qty % pack !==0);
  let extra='';
  if(badPacks.length){ extra=` <span style="color:#b45309;font-size:12px;">(${badPacks.length} line(s) not a multiple of ${pack})</span>`; }
  $('#totalBar').innerHTML = msg + extra;
  const continueBtn=$('#continueBtn');
  if(continueBtn) continueBtn.disabled=!valid;
  // update risk side
  const sr=riskAmount(STATE.adjust.split,committed,line);
  const orig= STATE.adjust.original;
  const or=riskAmount(orig,committed,line);
  if($('#suggRisk')) $('#suggRisk').textContent='$'+sr.toLocaleString();
  if($('#riskRed')) $('#riskRed').textContent='$'+(or-sr).toLocaleString();
}
function goConfirm(id){ location.hash="#/confirm/"+id; }
function resetSuggestion(){
  const line=STATE.currentLine;
  const committed=STATE.adjust.committed;
  const suggestedQtys=STATE.adjust.suggested;
  for(let i=0;i<STATE.adjust.split.length;i++){ STATE.adjust.split[i].qty=suggestedQtys[i]; }
  // re-render adjust quickly by refreshing inputs
  const inputs=$all('.qty-input');
  inputs.forEach((inp,idx)=>{ inp.value=STATE.adjust.split[idx].qty; });
  updateTotalBar(line,committed);
}
// ensure committed stored in adjust
// patch suggest path sets committed already in STATE.adjust.committed? We used committed var not stored. Add:
// In viewAdjust above, set STATE.adjust.committed = committed
// We'll store:
const _origViewAdjust = viewAdjust;

async function viewConfirm(id){
  const root=$('#app');
  root.innerHTML=`<div class="empty"><span class="spinner"></span> Loading…</div>`;
  let line=STATE.currentLine && STATE.currentLine.id===id ? STATE.currentLine : LINES.find(l=>l.id===id);
  if(!line){ try { line=await api('/api/lines/'+id);}catch(e){ root.innerHTML=`<div class="empty">Failed</div>`; return;} }
  STATE.currentLine=line;
  const adj=STATE.adjust && STATE.adjust.lineId===id ? STATE.adjust : null;
  if(!adj){ location.hash=`#/adjust/${id}`; return; }
  const committed=adj.committed;
  const split=adj.split;
  const origRisk=riskAmount(adj.original,committed,line);
  const newRisk=riskAmount(split,committed,line);

  let html=progress(4);
  html+=`<h1 class="page-title">Confirm mix lock — ${escapeHtml(line.name)}</h1>`;
  html+=`<p class="page-sub">Review the final split before sending to SAP.</p>`;

  html+=`<div class="grid2">
    <div class="card">
      <h3 style="margin-top:0;">Final mix split</h3>
      <table>
        <thead><tr><th>Colour</th><th>Size</th><th>Quantity</th><th>Share</th></tr></thead>
        <tbody>`;
  for(const v of split){
    const share=committed?(v.qty/committed*100).toFixed(1):0;
    html+=`<tr><td>${escapeHtml(v.colour)}</td><td>${escapeHtml(v.size)}</td><td>${v.qty.toLocaleString()}</td><td>${share}%</td></tr>`;
  }
  html+=`<tr style="background:#f3f4f6;font-weight:700;"><td colspan="2">Total</td><td>${committed.toLocaleString()}</td><td>100%</td></tr>`;
  html+=`</tbody></table>
    </div>
    <div class="sidepanel">
      <h3 style="margin-top:0;">Risk reduction</h3>
      <div class="risk-row"><span>Original even split</span><strong>$${origRisk.toLocaleString()}</strong></div>
      <div class="risk-row"><span>Suggested split</span><strong>$${newRisk.toLocaleString()}</strong></div>
      <div class="risk-row" style="border-top:1px solid #e5e7eb;padding-top:8px;margin-top:8px;"><span>Saving</span><strong style="color:#065f46;">$${(origRisk-newRisk).toLocaleString()}</strong></div>
      <p style="font-size:12px;color:#6b7280;margin-top:10px;">${split.length} variant lines will be POSTed to SAP plus a header note.</p>
    </div>
  </div>`;

  html+=`<div style="margin-top:16px;display:flex;gap:10px;">
    <a class="btn btn-outline" href="#/adjust/${line.id}">← Adjust mix</a>
    <button class="btn btn-danger" onclick="confirmMixLock('${line.id}','${line.poNumber}',${committed})">Confirm mix lock</button>
  </div>`;
  html+=`<div id="resultArea"></div>`;

  root.innerHTML=html;
}

async function confirmMixLock(lineId, poNumber, committed){
  if(!confirm('Confirm mix lock for this line?\nThis will send the variant split to SAP.')) return;
  const adj=STATE.adjust;
  const line=STATE.currentLine;
  const btn=event?event.target:null;
  if(btn) btn.disabled=true;
  const resultArea=$('#resultArea');
  resultArea.innerHTML=`<div class="empty"><span class="spinner"></span> Sending…</div>`;
  try {
    const res=await api('/api/mixlock',{
      method:'POST',
      body: JSON.stringify({
        lineId, poNumber, committedQty: committed,
        finalSplit: adj.split.map(v=>({ colour:v.colour, size:v.size, qty:v.qty })),
        note: `Mix locked ${new Date().toISOString().slice(0,10)} - signal wk1-3 sell-through; deferred mix allocation.`
      })
    });
    showWriteResult(res, lineId);
  } catch(e){
    resultArea.innerHTML=`<div class="empty" style="color:#b91c1c;">Failed: ${escapeHtml(e.message)}</div>`;
    if(btn) btn.disabled=false;
  }
}

function showWriteResult(res, lineId){
  const resultArea=$('#resultArea');
  let html='';
  if(res.mode==='simulate'){
    html+=`<div class="banner-sim"><strong>Simulation mode</strong> — SAP sandbox is read-only. This request is ready for Kmart's production S/4HANA system.</div>`;
  }
  html+=`<div class="card" style="margin-top:16px;">
    <h3 style="margin-top:0;">Mix lock recorded</h3>
    <p>SAP write ID: <strong>${escapeHtml(res.id)}</strong> · Mode: <strong>${escapeHtml(res.mode)}</strong></p>
    <p>${res.requests.length} request(s) built:</p>
    <ul>`;
  for(const r of res.requests){
    html+=`<li><code>${r.method}</code> <code>${escapeHtml(r.path)}</code></li>`;
  }
  html+=`</ul>
    <button class="btn btn-outline" onclick="showWrite('${res.id}')">View SAP request payload</button>
    <a class="btn" style="margin-left:8px;" href="#/dashboard">Back to dashboard</a>
  </div>`;
  resultArea.innerHTML=html;
  // mark line locked in local LINES
  const line=LINES.find(l=>l.id===lineId);
  if(line) line.status='Mix locked';
}

// ---------- modal ----------
async function showWrite(id){
  const modalRoot=$('#modalRoot');
  let entry;
  try { entry=await api('/api/writes/'+id); }
  catch(e){ alert('Failed to load: '+e.message); return; }
  modalRoot.innerHTML=`<div class="modal-backdrop" onclick="closeModal(event)">
    <div class="modal" onclick="event.stopPropagation()">
      <button class="close-btn" onclick="closeModal()">&times;</button>
      <h3>SAP request payload — ${escapeHtml(entry.id)}</h3>
      <div class="modal-tools">
        <span style="font-size:13px;color:#6b7280;">Mode: ${escapeHtml(entry.mode)} · PO ${escapeHtml(entry.poNumber)} · ${escapeHtml(entry.createdAt)}</span>
      </div>
      ${entry.requests.map((r,i)=>`<div style="margin-bottom:12px;">
        <div style="font-weight:700;margin-bottom:4px;">Request ${i+1}: ${escapeHtml(r.method)} ${escapeHtml(r.path)}</div>
        <pre>${escapeHtml(JSON.stringify({ method:r.method, url:r.url||r.path, headers:r.headers, body:r.body },null,2))}</pre>
      </div>`).join('')}
    </div>
  </div>`;
}
function closeModal(e){
  if(e && e.target && !e.target.classList.contains('modal-backdrop')) return;
  $('#modalRoot').innerHTML='';
}

// ---------- routing ----------
function updateModeBadge(){
  const el=$('#modeBadge');
  el.textContent = CFG.sapWriteMode==='live' ? 'SAP mode: LIVE' : 'SAP mode: SIMULATE';
}

async function viewHistory(){
  const root=$('#app');
  root.innerHTML='<div class="empty"><span class="spinner"></span> Loading history...</div>';
  let writes=[];
  try { writes=(await api('/api/writes')).writes||[]; } catch(e){ root.innerHTML='<div class="empty">Failed: '+escapeHtml(e.message)+'</div>'; return; }
  let html='<h1 class="page-title">SAP Write History</h1><p class="page-sub">Saved SAP requests (simulate/live).</p>';
  html+='<div class="card"><table><thead><tr><th>ID</th><th>Mode</th><th>PO</th><th>Line</th><th>Created</th><th>Requests</th><th></th></tr></thead><tbody>';
  if(writes.length===0) html+='<tr><td colspan="7" class="empty">No writes recorded yet.</td></tr>';
  for(const w of writes){
    html+='<tr><td>'+escapeHtml(w.id)+'</td><td>'+escapeHtml(w.mode)+'</td><td>'+escapeHtml(w.poNumber)+'</td><td>'+escapeHtml(w.lineId)+'</td><td>'+escapeHtml(w.createdAt)+'</td><td>'+w.requests.length+'</td><td><button class="btn btn-sm btn-outline" onclick="showWrite(\''+w.id+'\')">View</button></td></tr>';
  }
  html+='</tbody></table></div>';
  root.innerHTML=html;
}

async function router(){
  const hash=location.hash||'#/dashboard';
  const parts=hash.replace(/^#\//,'').split('/');
  if(parts[0]==='dashboard' || parts[0]==='') { await viewDashboard(); return; }
  if(parts[0]==='line' && parts[1]){ await viewLine(parts[1]); return; }
  if(parts[0]==='adjust' && parts[1]){ await viewAdjust(parts[1]); return; }
  if(parts[0]==='confirm' && parts[1]){ await viewConfirm(parts[1]); return; }
  if(parts[0]==='history'){ await viewHistory(); return; }
  await viewDashboard();
}
window.addEventListener('hashchange', router);

// store adjust committed fix: patch viewAdjust after definition not possible; instead modify viewAdjust source. We'll monkeypatch a wrapper.
const _va = viewAdjust;
// Re-define viewAdjust to also store committed; override by wrapping routing? Instead patch function via eval? Better: edit text above already uses STATE.adjust... adjust without committed.
// We'll inject committed when adjust loaded into STATE.adjust.committed manually in viewAdjust; need edit source. Use replacement:
// (handled by editing function below through redefinition)

async function init(){
  try {
    const cfg=await api('/api/config'); CFG=cfg;
  } catch(e){}
  updateModeBadge();
  // initial load lines in background
  try { const d=await api('/api/lines'); LINES=d.lines; } catch(e){}
  router();
}
init();
