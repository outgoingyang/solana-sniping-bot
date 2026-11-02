export const dashboardHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Solana Sniper — Dashboard</title>
<style>
:root{
  --bg:#0b0b0f; --panel:#141419; --panel2:#1b1b23; --line:#26262f;
  --purple:#ab9ff2; --purple2:#7c5cff; --green:#3ddc84; --red:#ff5c7a;
  --text:#eaeaf0; --muted:#8b8b98;
}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--text);font-family:'Segoe UI',Inter,system-ui,sans-serif;min-height:100vh}
.top{display:flex;align-items:center;gap:14px;padding:14px 24px;border-bottom:1px solid var(--line);position:sticky;top:0;background:rgba(11,11,15,.94);backdrop-filter:blur(10px);z-index:10}
.logo{display:flex;align-items:center;gap:10px;font-weight:700;font-size:17px}
.logo .dot{width:30px;height:30px;border-radius:9px;background:linear-gradient(135deg,var(--purple2),var(--purple));display:flex;align-items:center;justify-content:center;font-size:15px}
.chip{background:var(--panel2);border:1px solid var(--line);border-radius:12px;padding:8px 14px;font-size:13px;display:flex;gap:8px;align-items:center}
.chip b{color:var(--purple)}
.spacer{flex:1}
.btn{border:none;color:#fff;border-radius:12px;padding:10px 20px;font-weight:700;cursor:pointer;font-size:13px;transition:.15s;letter-spacing:.3px}
.btn:hover{filter:brightness(1.12)}
.btn.start{background:#123a24;color:var(--green);border:1px solid #1e5a37}
.btn.stop{background:#3a1622;color:var(--red);border:1px solid #4d1f2f}
.btn.ghost{background:var(--panel2);border:1px solid var(--line);color:var(--text)}
.btn.pri{background:var(--purple2)}
.btn:disabled{opacity:.5;cursor:default}
.wrap{display:grid;grid-template-columns:minmax(0,1fr) 420px;gap:18px;padding:18px 24px;max-width:1500px;margin:0 auto}
@media(max-width:1150px){.wrap{grid-template-columns:1fr}}
.col{min-width:0}
.card{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:18px;margin-bottom:18px}
.card h3{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:1.2px;margin-bottom:12px;font-weight:700}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:18px}
.stat{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:16px}
.stat .v{font-size:22px;font-weight:700;margin-top:6px}
.stat .lbl{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:1px}
.pos{color:var(--green)} .neg{color:var(--red)}
table{width:100%;border-collapse:collapse;font-size:13px}
th{color:var(--muted);text-align:left;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.6px;padding:8px 10px;border-bottom:1px solid var(--line)}
td{padding:9px 10px;border-bottom:1px solid #1e1e26;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
tr:hover td{background:var(--panel2)}
.mono{font-family:'Cascadia Code',Consolas,monospace;font-size:12px}
.tag{padding:3px 9px;border-radius:8px;font-size:11px;font-weight:700}
.tag.buy,.tag.dip{background:#12331f;color:var(--green)}
.tag.sell{background:#241640;color:var(--purple)}
.tag.rug{background:#3a1622;color:var(--red)}
.tag.error{background:#2b2b33;color:var(--muted)}
.field{margin-bottom:12px}
.field label{display:block;font-size:10.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.9px;margin-bottom:6px;font-weight:600}
.field input,.field select{width:100%;background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:9px 12px;color:var(--text);font-size:13px;outline:none}
.field input:focus,.field select:focus{border-color:var(--purple2)}
.row{display:flex;gap:10px}
.row .field{flex:1;min-width:0}
.sw{display:flex;align-items:center;justify-content:space-between;background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:9px 12px;margin-bottom:12px}
.sw .lbl2{font-size:13px}
.tgl{width:42px;height:24px;background:#2b2b33;border-radius:99px;position:relative;cursor:pointer;transition:.2s;flex:none}
.tgl.on{background:var(--purple2)}
.tgl::after{content:'';position:absolute;width:18px;height:18px;border-radius:50%;background:#fff;top:3px;left:3px;transition:.2s}
.tgl.on::after{left:21px}
.group{border:1px solid var(--line);border-radius:12px;padding:12px;margin-bottom:12px}
.group h4{font-size:10.5px;color:var(--purple);text-transform:uppercase;letter-spacing:1.1px;margin-bottom:10px;font-weight:700}
.status{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--muted)}
.status .pulse{width:8px;height:8px;border-radius:50%;background:var(--green);animation:p 1.6s infinite}
@keyframes p{50%{opacity:.3}}
.empty{color:var(--muted);font-size:12px;padding:14px;text-align:center}
/* logs: aligned columns, fixed, nothing runs away */
.logs-card{background:var(--panel);border:1px solid var(--line);border-radius:16px;overflow:hidden}
.logs-head{display:flex;justify-content:space-between;align-items:center;padding:14px 16px 10px}
.logs-head .clr{font-size:11px;color:var(--muted);cursor:pointer;letter-spacing:.5px;text-transform:uppercase}
.logs-head .clr:hover{color:var(--text)}
.logs{background:#08080c;height:560px;overflow-y:auto;padding:6px 0}
.lrow{display:grid;grid-template-columns:86px 52px minmax(0,1fr);gap:8px;padding:3px 14px;font-family:'Cascadia Code',Consolas,monospace;font-size:11.5px;line-height:1.55}
.lrow:hover{background:#12121a}
.lrow .t{color:#55555f}
.lrow .lv{font-weight:700}
.lrow .msg{color:#c9c9d4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lrow.open .msg{white-space:pre-wrap;word-break:break-all;overflow:visible;text-overflow:clip;cursor:pointer}
.lv.INFO{color:var(--purple)} .lv.WARN{color:#f2c94c} .lv.ERROR{color:var(--red)} .lv.FATAL{color:var(--red)} .lv.DEBUG{color:#6f6f80} .lv.TRACE{color:#55555f}
::-webkit-scrollbar{width:8px;height:8px}::-webkit-scrollbar-thumb{background:#2b2b33;border-radius:8px}
.note{font-size:11px;color:var(--muted);line-height:1.5;margin-top:8px}
.ok{color:var(--green);font-size:12px;margin-top:8px;display:block}
.err{color:var(--red);font-size:12px;margin-top:8px;display:block}
</style>
</head>
<body>
<div class="top">
  <div class="logo"><div class="dot">◎</div>Solana Sniper</div>
  <div class="chip">wallet <b id="wallet">…</b></div>
  <div class="chip">SOL <b id="sol">…</b></div>
  <div class="chip">WSOL <b id="wsol">…</b></div>
  <div class="spacer"></div>
  <div class="status"><div class="pulse" id="pulse"></div><span id="stateLbl">LIVE</span></div>
  <button class="btn start" id="startBtn" onclick="setRunning(true)">START</button>
  <button class="btn stop" id="stopBtn" onclick="setRunning(false)">STOP</button>
</div>

<div class="wrap">
  <div class="col">
    <div class="stats">
      <div class="stat"><div class="lbl">Realized PnL</div><div class="v" id="pnl">—</div></div>
      <div class="stat"><div class="lbl">Win rate</div><div class="v" id="winrate">—</div></div>
      <div class="stat"><div class="lbl">Trades</div><div class="v" id="trades">—</div></div>
      <div class="stat"><div class="lbl">Deployed</div><div class="v" id="deployed">—</div></div>
    </div>

    <div class="card">
      <h3>Open positions</h3>
      <table><thead><tr><th>Token</th><th>Entry (quote)</th><th>Est. tokens</th><th>Dips</th><th>Monitor</th></tr></thead>
      <tbody id="positions"><tr><td colspan="5" class="empty">no open positions</td></tr></tbody></table>
    </div>

    <div class="card">
      <h3>Trade history (journal)</h3>
      <table><thead><tr><th>Time</th><th>Side</th><th>Token</th><th>Quote</th><th>PnL</th></tr></thead>
      <tbody id="history"><tr><td colspan="5" class="empty">no trades yet</td></tr></tbody></table>
    </div>

    <div class="card">
      <h3>Add wallet</h3>
      <div class="field">
        <label>Private key (base58)</label>
        <input id="pk" type="password" placeholder="Paste private key of the new wallet" autocomplete="off"/>
      </div>
      <button class="btn pri" style="width:100%" onclick="addWallet()">Add wallet</button>
      <span id="walletMsg"></span>
      <div class="note">The bot hot-swaps to the pasted key instantly: WSOL account is prepared automatically, sells for tokens of the old wallet keep running. The key is persisted to .env (PRIVATE_KEY).</div>
    </div>

    <div class="card">
      <h3>Sniping mode</h3>
      <div class="row">
        <button class="btn ghost modeBtn" id="modeAll" style="flex:1" onclick="setSnipeMode(false)">All new tokens</button>
        <button class="btn ghost modeBtn" id="modeList" style="flex:1" onclick="setSnipeMode(true)">Only my list</button>
      </div>
      <div class="field" style="margin-top:12px">
        <label>My tokens (one mint per line, saved to snipe-list.txt)</label>
        <textarea id="snipeList" rows="5" class="mono" style="width:100%;background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:9px 12px;color:var(--text);font-size:12px;outline:none;resize:vertical" placeholder="So11111111111111111111111111111111111111112"></textarea>
      </div>
      <button class="btn pri" style="width:100%" onclick="saveSnipeList()">Save list</button>
      <span id="snipeMsg"></span>
      <div class="note"><b>All new tokens</b> — real-time sniping of every new listing (fresh Raydium pools, pump.fun launches, momentum scanner).<br/><b>Only my list</b> — bot buys the tokens from your list above: new launches of listed tokens are sniped in real time, and pressing <b>START</b> buys already-listed tokens right now. Every purchased token then goes through the same lifecycle: take-profit / stop-loss / trailing stop / rug-pull protection / buy-the-dip.</div>
    </div>

    <div class="card">
      <h3>All configs (.env)</h3>
      <div class="group">
        <h4>Buy sizing</h4>
        <div class="row">
          <div class="field"><label>Quote amount mode</label>
            <select id="c_quoteAmountMode"><option value="fixed">fixed</option><option value="percent">percent</option></select>
          </div>
          <div class="field"><label>Quote amount (fixed)</label><input id="c_quoteAmount" type="text"/></div>
        </div>
        <div class="row">
          <div class="field"><label>Percent %</label><input id="c_quoteAmountPercent" type="number"/></div>
          <div class="field"><label>Min SOL buffer</label><input id="c_minSolBuffer" type="number" step="0.001"/></div>
        </div>
      </div>
      <div class="group">
        <h4>Sell / scalping</h4>
        <div class="row">
          <div class="field"><label>Take profit %</label><input id="c_takeProfit" type="number" step="0.5"/></div>
          <div class="field"><label>Stop loss %</label><input id="c_stopLoss" type="number" step="1"/></div>
        </div>
        <div class="sw"><div class="lbl2">Trailing stop loss</div><div class="tgl" id="sw_trailingStopLoss" onclick="flip('trailingStopLoss')"></div></div>
        <div class="row">
          <div class="field"><label>Skip sell if lost > %</label><input id="c_skipSellingIfLostMoreThan" type="number" step="1"/></div>
          <div class="field"><label>Sell slippage %</label><input id="c_sellSlippage" type="number" step="1"/></div>
        </div>
        <div class="row">
          <div class="field"><label>Check interval ms</label><input id="c_priceCheckInterval" type="number" step="250"/></div>
          <div class="field"><label>Check duration ms</label><input id="c_priceCheckDuration" type="number" step="5000"/></div>
        </div>
        <div class="field"><label>Max tokens at a time</label><input id="c_maxTokensAtTheTime" type="number" step="1"/></div>
      </div>
      <div class="group">
        <h4>Rug protection & deep analysis</h4>
        <div class="row">
          <div class="field"><label>Liquidity drop % (rug exit)</label><input id="c_liquidityDropPct" type="number" step="1"/></div>
          <div class="field"><label>Rug exit slippage %</label><input id="c_rugSlippage" type="number" step="1"/></div>
        </div>
        <div class="row">
          <div class="field"><label>RugCheck max score</label><input id="c_rugcheckMaxScore" type="number" step="100"/></div>
          <div class="field"><label>Min LP locked %</label><input id="c_rugcheckMinLpLocked" type="number" step="1"/></div>
        </div>
        <div class="sw"><div class="lbl2">Fail on critical risks</div><div class="tgl" id="sw_rugcheckFailOnCritical" onclick="flip('rugcheckFailOnCritical')"></div></div>
      </div>
      <button class="btn pri" style="width:100%" onclick="saveConfig()">Apply configs</button>
      <span id="cfgMsg"></span>
      <div class="note">Changes apply live (no restart) and are written to the .env file, so they survive restarts.</div>
    </div>
  </div>

  <div class="col">
    <div class="logs-card">
      <div class="logs-head"><h3 style="margin:0">Live logs</h3><span class="clr" onclick="document.getElementById('logs').innerHTML=''">clear</span></div>
      <div class="logs" id="logs"></div>
    </div>
  </div>
</div>

<script>
let cfgApplied=false, running=true, bools={};
const esc=s=>String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const short=m=>m?m.slice(0,6)+'…'+m.slice(-4):'';
const FIELDS=['quoteAmountMode','quoteAmount','quoteAmountPercent','minSolBuffer','takeProfit','stopLoss','skipSellingIfLostMoreThan','sellSlippage','priceCheckInterval','priceCheckDuration','maxTokensAtTheTime','liquidityDropPct','rugSlippage','rugcheckMaxScore','rugcheckMinLpLocked'];

async function refreshState(){
  try{
    const r=await fetch('/api/state');const s=await r.json();
    document.getElementById('wallet').textContent=short(s.wallet);
    document.getElementById('sol').textContent=(s.solBalance??0).toFixed(4);
    document.getElementById('wsol').textContent=(s.wsolBalance??0).toFixed(4);
    document.getElementById('pnl').textContent=(s.stats.totalPnl??0).toFixed(6);
    document.getElementById('pnl').className='v '+(s.stats.totalPnl>0?'pos':s.stats.totalPnl<0?'neg':'');
    document.getElementById('winrate').textContent=(s.stats.winRate??0)+'%';
    document.getElementById('trades').textContent=(s.stats.sells??0)+' / '+(s.stats.wins??0)+'W';
    document.getElementById('deployed').textContent=(s.stats.deployed??0).toFixed(4);
    running=!s.paused;
    paintRunState();
    if(!cfgApplied){
      try{
        const c=await (await fetch('/api/config')).json();
        for(const f of FIELDS){const el=document.getElementById('c_'+f);if(el)el.value=c[f];}
        bools.trailingStopLoss=!!c.trailingStopLoss;bools.rugcheckFailOnCritical=!!c.rugcheckFailOnCritical;
        paintToggles();cfgApplied=true;
      }catch(e){}
    }
    const tb=document.getElementById('positions');
    if(!s.positions||!s.positions.length){tb.innerHTML='<tr><td colspan="5" class="empty">no open positions</td></tr>';}
    else{tb.innerHTML=s.positions.map(p=>'<tr><td class="mono" title="'+p.mint+'">'+short(p.mint)+'</td><td>'+(p.quoteSpent??0).toFixed(6)+'</td><td>'+(p.tokensAtEntry??0).toLocaleString(undefined,{maximumFractionDigits:2})+'</td><td>'+p.dipsUsed+'</td><td>'+(p.monitoring?'<span class="tag sell">running</span>':'<span class="tag error">idle</span>')+'</td></tr>').join('');}
  }catch(e){}
}
function paintRunState(){
  document.getElementById('startBtn').disabled=running;
  document.getElementById('stopBtn').disabled=!running;
  document.getElementById('stateLbl').textContent=running?'LIVE':'STOPPED';
  document.getElementById('pulse').style.background=running?'#3ddc84':'#f2c94c';
}
function paintToggles(){for(const k of ['trailingStopLoss','rugcheckFailOnCritical']){const el=document.getElementById('sw_'+k);if(el)el.classList.toggle('on',!!bools[k]);}}
async function refreshLogs(){
  try{
    const r=await fetch('/api/logs');const d=await r.json();
    const el=document.getElementById('logs');
    const stick=el.scrollTop+el.clientHeight>=el.scrollHeight-30;
    el.innerHTML=d.logs.map(l=>{
      const m=l.match(/^\\[([^\\]]+)\\] (\\w+): (.*)$/s);
      if(!m)return '<div class="lrow"><span class="t"></span><span class="lv"></span><span class="msg">'+esc(l)+'</span></div>';
      return '<div class="lrow"><span class="t">'+m[1]+'</span><span class="lv '+m[2]+'">'+m[2]+'</span><span class="msg" title="'+esc(m[3])+'" onclick="this.parentNode.classList.toggle(\\'open\\')">'+esc(m[3])+'</span></div>';
    }).join('');
    if(stick)el.scrollTop=el.scrollHeight;
  }catch(e){}
}
async function refreshTrades(){
  try{
    const r=await fetch('/api/trades');const d=await r.json();
    const tb=document.getElementById('history');
    if(!d.trades.length){tb.innerHTML='<tr><td colspan="5" class="empty">no trades yet</td></tr>';return;}
    tb.innerHTML=d.trades.map(t=>'<tr><td class="mono">'+(t.time||'').replace('T',' ').slice(0,19)+'</td><td><span class="tag '+t.side+'">'+t.side+'</span></td><td class="mono" title="'+(t.mint||'')+'">'+short(t.mint)+'</td><td>'+(t.quoteAmount!=null?t.quoteAmount.toFixed(6):'—')+'</td><td class="'+((t.pnl??0)>0?'pos':(t.pnl??0)<0?'neg':'')+'">'+(t.pnl!=null?t.pnl.toFixed(6):'—')+'</td></tr>').join('');
  }catch(e){}
}
async function setRunning(run){
  await fetch('/api/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({paused:!run})});
  running=run;paintRunState();refreshState();
}
function paintSnipeMode(onList){
  document.getElementById('modeAll').style.borderColor=onList?'var(--line)':'var(--purple2)';
  document.getElementById('modeAll').style.color=onList?'var(--muted)':'var(--purple)';
  document.getElementById('modeList').style.borderColor=onList?'var(--purple2)':'var(--line)';
  document.getElementById('modeList').style.color=onList?'var(--purple)':'var(--muted)';
}
async function loadSnipe(){
  try{
    const r=await fetch('/api/snipe');const d=await r.json();
    paintSnipeMode(!!d.useSnipeList);
    const ta=document.getElementById('snipeList');
    if(document.activeElement!==ta)ta.value=(d.list||[]).join('\\n');
  }catch(e){}
}
async function setSnipeMode(onList){
  try{
    const r=await fetch('/api/snipe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({useSnipeList:onList})});
    const d=await r.json();
    paintSnipeMode(!!d.useSnipeList);
    const m=document.getElementById('snipeMsg');
    m.className='ok';m.textContent='Mode: '+(d.useSnipeList?'only my list':'all new tokens');
    setTimeout(()=>{m.textContent='';},3000);
  }catch(e){}
}
async function saveSnipeList(){
  const m=document.getElementById('snipeMsg');
  const list=document.getElementById('snipeList').value.split('\\n');
  try{
    const r=await fetch('/api/snipe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({list})});
    const d=await r.json();
    if(d.ok){m.className='ok';m.textContent='List saved: '+(d.list||[]).length+' tokens';document.getElementById('snipeList').value=(d.list||[]).join('\\n');}
    else{m.className='err';m.textContent=d.error||'Failed';}
  }catch(e){m.className='err';m.textContent='Failed to save';}
  setTimeout(()=>{m.textContent='';},4000);
}
function flip(k){bools[k]=!bools[k];document.getElementById('sw_'+k).classList.toggle('on',bools[k]);}
async function saveConfig(){
  const b={};for(const f of FIELDS){b[f]=document.getElementById('c_'+f).value;}
  b.trailingStopLoss=!!bools.trailingStopLoss;b.rugcheckFailOnCritical=!!bools.rugcheckFailOnCritical;
  const r=await fetch('/api/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});
  const m=document.getElementById('cfgMsg');
  if(r.ok){m.className='ok';m.textContent='Configs applied live and saved to .env';cfgApplied=false;}else{m.className='err';m.textContent='Failed to apply';}
  setTimeout(()=>{m.textContent='';},4000);refreshState();
}
async function addWallet(){
  const pk=document.getElementById('pk').value.trim();
  const m=document.getElementById('walletMsg');
  if(!pk){m.className='err';m.textContent='Paste a private key first';return;}
  const r=await fetch('/api/wallet',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({privateKey:pk})});
  const d=await r.json();
  if(d.ok){m.className='ok';m.textContent='Wallet added: '+d.wallet+' ('+(d.solBalance??0).toFixed(4)+' SOL)';document.getElementById('pk').value='';cfgApplied=false;}
  else{m.className='err';m.textContent=d.error||'Failed';}
  refreshState();
}
refreshState();refreshLogs();refreshTrades();loadSnipe();
setInterval(refreshState,2000);setInterval(refreshLogs,1500);setInterval(refreshTrades,4000);setInterval(loadSnipe,10000);
</script>
</body>
</html>`;
