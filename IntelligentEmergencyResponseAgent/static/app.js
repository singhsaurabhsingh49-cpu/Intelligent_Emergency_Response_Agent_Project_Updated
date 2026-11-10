/* Intelligent Emergency Response & Rescue Agent - dashboard script.
   All data (nodes, roads, costs, paths, explored nodes) comes from the Flask backend. */

const COLORS = {
  start:'#2e9e5b', goal:'#d32f2f', explored:'#8e44ad', route:'#f57c00',
  normal:'#2f80ed', road:'#9aa5b1', blocked:'#d32f2f', ink:'#1b2a41',
  traffic:{Low:'#2e9e5b', Medium:'#e0a800', High:'#a63d2f'}
};
const ROAD_WIDTH = {Low:3, Medium:5, High:7};
const ROAD_WIDTH_COMPACT = {Low:2, Medium:3, High:4.5};
const VIEW = {w:820, h:560, padX:80, padY:72};

let cityData = null;          // raw /api/city data
let graphData = null;         // /api/graph snapshot (includes per-road cost for current mode)
let view = {result:null, explored:null, current:null}; // what the main graph is showing
let hasCalculated = false;
let animTimer = null;
let changedRoad = null;       // road key highlighted briefly after an event
let changedTimer = null;
let svgCounter = 0;

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ekey = (a, b) => [a, b].sort().join('|');
const fmt = n => (n === null || n === undefined) ? '–' : (Number.isInteger(n) ? String(n) : String(+Number(n).toFixed(2)));

async function getJSON(url){
  const res = await fetch(url);
  if(!res.ok) throw new Error(url + ' returned ' + res.status);
  return res.json();
}
async function postJSON(url, body){
  const res = await fetch(url, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
  return {ok:res.ok, status:res.status, data: await res.json()};
}

function getAlgorithm(){ const r = document.querySelector('input[name="algorithm"]:checked'); return r ? r.value : 'A*'; }
function setAlgorithm(name){
  document.querySelectorAll('input[name="algorithm"]').forEach(r => { r.checked = (r.value === name); });
  syncAlgoCards();
}
function syncAlgoCards(){
  document.querySelectorAll('.algo-card').forEach(l => l.classList.toggle('selected', l.querySelector('input').checked));
}
function getPayload(){
  return {start:$('start').value, goal:$('goal').value, vehicle:$('vehicle').value,
          priority:$('priority').value, algorithm:getAlgorithm(), mode:$('mode').value};
}

/* ---------------------------------------------------------------- init */
async function init(){
  try{
    cityData = await getJSON('/api/city');
    const opts = cityData.nodes.map(n => `<option value="${esc(n.id)}">${esc(n.id)} - ${esc(n.name)}</option>`).join('');
    ['start','goal','roadFrom','roadTo'].forEach(id => $(id).innerHTML = opts);
    $('start').value = 'A'; $('goal').value = 'H';
    $('roadFrom').value = 'B'; $('roadTo').value = 'D';
    const agents = await getJSON('/api/agents');
    $('agents').innerHTML = agents.map(a => `<span class="agent"><b>${esc(a.id)}</b> · ${esc(a.vehicle)} · ${esc(a.priority)} · ${esc(a.status)}</span>`).join('');
    ['vehicle','start','goal','priority','mode'].forEach(id => $(id).addEventListener('change', onInputChange));
    document.querySelectorAll('input[name="algorithm"]').forEach(r => r.addEventListener('change', onInputChange));
    $('graph').addEventListener('click', onGraphClick);
    $('roadTable').addEventListener('click', onTableClick);
    await refreshGraph();
    redraw();
  }catch(err){
    console.error(err);
    $('result').textContent = 'Could not load city data: ' + err.message;
  }
}

async function onInputChange(){
  syncAlgoCards();
  if(hasCalculated){ await calculate(); }
  else { await refreshGraph(); view = {result:null, explored:null, current:null}; redraw(); }
}

async function refreshGraph(){
  graphData = await getJSON('/api/graph?mode=' + encodeURIComponent($('mode').value));
  renderStats();
  renderRoadTable();
}

/* ------------------------------------------------------- graph drawing */
function nodePositions(graph, r){
  const xs = graph.nodes.map(n => n.x), ys = graph.nodes.map(n => n.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const sx = (VIEW.w - 2*VIEW.padX) / ((maxX - minX) || 1);
  const sy = (VIEW.h - 2*VIEW.padY) / ((maxY - minY) || 1);
  const pos = {};
  graph.nodes.forEach(n => { pos[n.id] = {x: VIEW.padX + (n.x - minX)*sx, y: VIEW.padY + (n.y - minY)*sy}; });
  return pos;
}

/* Text with a white outline drawn as a separate element underneath (renderer-independent) */
function haloText(x, y, txt, size, weight, fill){
  const common = `x="${x}" y="${y}" text-anchor="middle" font-size="${size}" font-weight="${weight}"`;
  return `<text ${common} fill="#fff" stroke="#fff" stroke-width="4" stroke-linejoin="round">${txt}</text>`
       + `<text ${common} fill="${fill}">${txt}</text>`;
}

/* Returns an SVG string. o = {start, goal, explored[], path[]|null, compact, changed} */
function graphSVG(graph, o){
  const compact = !!o.compact, R = compact ? 19 : 26;
  const pos = nodePositions(graph, R);
  const uid = 'g' + (++svgCounter);
  const explored = o.explored || [];
  const order = new Map(explored.map((n, i) => [n, i + 1]));
  const path = o.path || null;
  const pathNodes = new Set(path || []);
  const pathEdges = new Set();
  (path || []).forEach((n, i, a) => { if(i) pathEdges.add(ekey(a[i-1], n)); });
  const widths = compact ? ROAD_WIDTH_COMPACT : ROAD_WIDTH;
  let base = '', halo = '', overlay = '', hit = '', labels = '', nodes = '';

  graph.edges.forEach(e => {
    const a = pos[e.from], b = pos[e.to];
    if(!a || !b) return;
    const k = ekey(e.from, e.to), blocked = !!e.blocked, tr = e.traffic || 'Medium';
    const mx = (a.x + b.x)/2, my = (a.y + b.y)/2;
    if(o.changed === k){
      halo += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#ffe082" stroke-width="${compact?10:18}" stroke-linecap="round" opacity="0.85"/>`;
    }
    if(blocked){
      base += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${COLORS.blocked}" stroke-width="${compact?2.5:4}" stroke-dasharray="${compact?'6 5':'10 7'}" stroke-linecap="butt"/>`;
      if(!compact){
        base += `<g stroke="${COLORS.blocked}" stroke-width="3" stroke-linecap="round"><line x1="${mx-7}" y1="${my-7}" x2="${mx+7}" y2="${my+7}"/><line x1="${mx-7}" y1="${my+7}" x2="${mx+7}" y2="${my-7}"/></g>`;
      }
    }else{
      base += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${COLORS.road}" stroke-width="${widths[tr] || widths.Medium}" stroke-linecap="round"/>`;
    }
    if(!compact){
      hit += `<line class="edge-hit" data-from="${esc(e.from)}" data-to="${esc(e.to)}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="transparent" stroke-width="22"><title>Road ${esc(e.from)}–${esc(e.to)} (click to select in simulator)</title></line>`;
      const l1 = blocked ? `Dist ${fmt(e.distance)} · BLOCKED` : `Dist ${fmt(e.distance)} · Cost ${fmt(e.cost)}`;
      const l2 = `Traffic ${tr}${e.accident ? ' ⚠' : ''}`;
      const w = Math.max(l1.length, l2.length + 2) * 6.3 + 22, h = 34;
      const stroke = blocked ? COLORS.blocked : '#c5cfdb';
      labels += `<g class="edge-label" data-from="${esc(e.from)}" data-to="${esc(e.to)}">`
        + `<rect x="${mx - w/2}" y="${my - h/2}" width="${w}" height="${h}" rx="7" fill="#fff" stroke="${stroke}" stroke-width="${blocked?1.6:1}" opacity="0.96"/>`
        + `<text x="${mx}" y="${my - 3}" text-anchor="middle" font-size="11" font-weight="700" fill="${blocked ? COLORS.blocked : COLORS.ink}">${esc(l1)}</text>`
        + `<circle cx="${mx - w/2 + 11}" cy="${my + 9}" r="4" fill="${COLORS.traffic[tr] || '#999'}"/>`
        + `<text x="${mx + 5}" y="${my + 13}" text-anchor="middle" font-size="10.5" fill="#44546a">${esc(l2)}</text></g>`;
    }
  });

  // final route drawn on top of grey roads, with direction arrows (full view only)
  if(path && path.length > 1){
    const mk = `${uid}-arrow`;
    if(!compact){
      overlay += `<defs><marker id="${mk}" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="2.4" markerHeight="2.4" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="${COLORS.route}"/></marker></defs>`;
    }
    for(let i = 1; i < path.length; i++){
      const a = pos[path[i-1]], b = pos[path[i]]; if(!a || !b) continue;
      if(compact){
        overlay += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${COLORS.route}" stroke-width="6" stroke-linecap="round"/>`;
      }else{
        const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1, ux = dx/len, uy = dy/len;
        const x1 = a.x + ux*R, y1 = a.y + uy*R, x2 = b.x - ux*(R + 2), y2 = b.y - uy*(R + 2);
        overlay += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${COLORS.route}" stroke-width="9" stroke-linecap="butt" marker-end="url(#${mk})"/>`;
      }
    }
  }

  graph.nodes.forEach(n => {
    const p = pos[n.id], isStart = n.id === o.start, isGoal = n.id === o.goal;
    let fill = COLORS.normal;
    if(isStart) fill = COLORS.start;
    else if(isGoal) fill = COLORS.goal;
    else if(pathNodes.has(n.id)) fill = COLORS.route;
    else if(order.has(n.id)) fill = COLORS.explored;
    let stroke = COLORS.ink, sw = 2;
    if(isStart && isGoal){ stroke = COLORS.goal; sw = 5; }
    const status = isStart && isGoal ? 'start = destination' : isStart ? 'starting city' : isGoal ? 'destination' : pathNodes.has(n.id) ? 'on final route' : order.has(n.id) ? 'explored' : 'not explored';
    nodes += `<g class="node-g"><title>${esc(n.id)} – ${esc(n.name)} (${status}${order.has(n.id) ? ', explored #' + order.get(n.id) : ''})</title>`
      + `<circle cx="${p.x}" cy="${p.y}" r="${R}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`
      + `<text x="${p.x}" y="${p.y + (compact?5:6)}" text-anchor="middle" font-size="${compact?15:19}" font-weight="700" fill="#fff">${esc(n.id)}</text>`;
    if(!compact){
      nodes += haloText(p.x, p.y + R + 17, esc(n.name), 12, 600, COLORS.ink);
      if(isStart || isGoal){
        const tag = (isStart && isGoal) ? 'START = DEST.' : isStart ? 'START' : 'DESTINATION';
        nodes += haloText(p.x, p.y - R - 9, tag, 11.5, 800, isStart ? COLORS.start : COLORS.goal);
      }
      if(order.has(n.id)){
        nodes += `<circle cx="${p.x + R*0.78}" cy="${p.y - R*0.78}" r="10" fill="#fff" stroke="${COLORS.explored}" stroke-width="2"/>`
          + `<text x="${p.x + R*0.78}" y="${p.y - R*0.78 + 4}" text-anchor="middle" font-size="11" font-weight="800" fill="${COLORS.explored}">${order.get(n.id)}</text>`;
      }
    }
    nodes += '</g>';
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW.w} ${VIEW.h}" role="img" font-family="Arial, sans-serif" preserveAspectRatio="xMidYMid meet">`
    + `${halo}${base}${hit}${overlay}${labels}${nodes}</svg>`;
}

/* Draw the main graph from the current view state */
function redraw(){
  if(!graphData) return;
  const r = view.result;
  const explored = view.explored !== null ? view.explored : (r ? (r.explored || []) : []);
  const path = (view.explored === null && r && r.status === 'success') ? r.path : null;
  $('graph').innerHTML = graphSVG(graphData, {start:$('start').value, goal:$('goal').value, explored, path, changed:changedRoad});
  $('graphCaption').textContent = 'Road costs shown for: ' + graphData.mode;
  $('roadCostMode').textContent = '(' + graphData.mode + ')';
  const canReplay = !!(r && (r.explored || []).length);
  $('replayBtn').disabled = !canReplay;
}

function renderStats(){
  const s = graphData.summary, t = s.traffic;
  $('graphStats').innerHTML =
    `<span class="chip">Cities: <b>${graphData.nodes.length}</b></span>`
    + `<span class="chip">Roads: <b>${s.roads}</b></span>`
    + `<span class="chip ${s.blocked ? 'bad' : ''}">Blocked: <b>${s.blocked}</b></span>`
    + `<span class="chip">Traffic Low/Med/High: <b>${t.Low}/${t.Medium}/${t.High}</b></span>`
    + `<span class="chip ${s.accidents ? 'bad' : ''}">Accidents: <b>${s.accidents}</b></span>`
    + `<span class="chip env">Environment: <b>${esc(graphData.environment)}</b></span>`;
}

function renderRoadTable(){
  const inPath = new Set();
  const r = view.result;
  if(r && r.status === 'success') r.path.forEach((n, i, a) => { if(i) inPath.add(ekey(a[i-1], n)); });
  $('roadTable').querySelector('tbody').innerHTML = graphData.edges.map(e => {
    const k = ekey(e.from, e.to);
    const status = e.blocked ? '<span class="tag bad">Blocked</span>' : (e.accident ? '<span class="tag warn">Accident</span>' : '<span class="tag ok">Open</span>');
    return `<tr data-from="${esc(e.from)}" data-to="${esc(e.to)}" class="${inPath.has(k) ? 'on-route' : ''}">`
      + `<td><b>${esc(e.from)} – ${esc(e.to)}</b>${inPath.has(k) ? ' <span class="tag route">route</span>' : ''}</td><td>${fmt(e.distance)}</td><td>${fmt(e.base_time)}</td>`
      + `<td><span class="tdot" style="background:${COLORS.traffic[e.traffic] || '#999'}"></span>${esc(e.traffic)}</td><td>${status}</td><td>${e.blocked ? '∞' : fmt(e.cost)}</td></tr>`;
  }).join('');
}

function selectRoad(from, to){
  $('roadFrom').value = from; $('roadTo').value = to;
  $('eventMessage').textContent = `Selected road ${from} – ${to} in the simulator below.`;
}
function onGraphClick(ev){
  const el = ev.target.closest('.edge-hit'); if(el) selectRoad(el.dataset.from, el.dataset.to);
}
function onTableClick(ev){
  const tr = ev.target.closest('tr[data-from]'); if(tr) selectRoad(tr.dataset.from, tr.dataset.to);
}

/* --------------------------------------------------- route calculation */
async function calculate(){
  hasCalculated = true;
  stopAnimation();
  const payload = getPayload();
  $('findBtn').disabled = true;
  try{
    await refreshGraph();                           // fresh roads + costs for this mode
    const {data} = await postJSON('/api/plan', payload);
    view = {result:data, explored:null, current:null};
    showResult(data);
    redraw();
    renderRoadTable();
    await runComparison(true);
  }catch(err){
    console.error(err);
    $('result').textContent = 'Error while calculating route: ' + err.message;
  }finally{
    $('findBtn').disabled = false;
  }
}

function findEdge(a, b){ return graphData.edges.find(e => ekey(e.from, e.to) === ekey(a, b)); }

function showResult(data){
  const banner = $('algoBanner'), box = $('result'), map = $('map'), seg = $('segments');
  seg.innerHTML = '';
  if(data.status === 'error'){
    banner.className = 'banner bad'; banner.textContent = data.message;
    box.textContent = data.message; map.innerHTML = ''; return;
  }
  if(data.status !== 'success'){
    banner.className = 'banner bad';
    banner.innerHTML = `<b>${esc(data.algorithm || getAlgorithm())}</b> found <b>no route</b> from ${esc($('start').value)} to ${esc($('goal').value)}. Purple nodes show what it explored before giving up.`;
    box.innerHTML = `<b>Status:</b> ${esc(data.message || 'No route found')}`
      + (data.explored ? `<br><b>Algorithm:</b> ${esc(data.algorithm)}<br><b>Explored nodes:</b> ${data.explored.join(', ') || 'none'} (${data.explored.length})` : '')
      + (data.environment ? `<br><b>Environment:</b> ${esc(data.environment)}` : '');
    map.innerHTML = '';
    return;
  }
  banner.className = 'banner ok';
  banner.innerHTML = `Route generated by <b class="algo-pill">${esc(data.algorithm)}</b> &nbsp; ${data.path.map(esc).join(' → ')} &nbsp; <span class="muted-b">cost ${fmt(data.cost)} · ${data.explored_count} nodes explored</span>`;
  box.innerHTML = `<b>Status:</b> ${esc(data.message)}<br><b>Vehicle / Priority:</b> ${esc(data.vehicle)} / ${esc(data.priority)}`
    + `<br><b>Algorithm:</b> ${esc(data.algorithm)}<br><b>Optimization:</b> ${esc(data.mode)}`
    + `<br><b>Route:</b> ${data.path.join(' → ')}<br><b>Total cost:</b> ${fmt(data.cost)}`
    + `<br><b>Roads on route:</b> ${data.hops}`
    + `<br><b>Explored nodes:</b> ${data.explored.join(', ')} (${data.explored_count})`
    + `<br><b>Execution time:</b> ${Number(data.execution_time_ms).toFixed(3)} ms`
    + `<br><b>Environment:</b> ${esc(data.environment)}`;
  map.innerHTML = data.path.map((n, i) => `${i ? '<span class="arrow">➜</span>' : ''}<span class="node">${esc(n)}</span>`).join('');
  // road-by-road breakdown taken from the backend graph snapshot
  let rows = '', sum = 0;
  for(let i = 1; i < data.path.length; i++){
    const e = findEdge(data.path[i-1], data.path[i]); if(!e) continue;
    sum += e.cost || 0;
    rows += `<tr><td><b>${esc(data.path[i-1])} → ${esc(data.path[i])}</b></td><td>${fmt(e.distance)}</td><td>${esc(e.traffic)}</td><td>${e.accident ? 'Yes' : 'No'}</td><td>${fmt(e.cost)}</td></tr>`;
  }
  if(rows){
    seg.innerHTML = `<h3 class="subhead">Road-by-road breakdown</h3><div class="table-scroll"><table class="data"><thead><tr><th>Road</th><th>Distance</th><th>Traffic</th><th>Accident</th><th>Cost</th></tr></thead><tbody>${rows}</tbody>`
      + `<tfoot><tr><td colspan="4"><b>Total cost</b></td><td><b>${fmt(Math.round(sum*100)/100)}</b></td></tr></tfoot></table></div>`;
  }
}

/* ------------------------------------------------- exploration replay */
function stopAnimation(){ if(animTimer){ clearTimeout(animTimer); animTimer = null; } view.explored = null; }

function replayExploration(){
  const r = view.result; if(!r || !(r.explored || []).length) return;
  if(animTimer){ clearTimeout(animTimer); animTimer = null; }
  const seq = r.explored; let i = 0;
  $('replayBtn').disabled = true;
  const step = () => {
    i++;
    view.explored = seq.slice(0, i);
    redraw(); $('replayBtn').disabled = true;
    $('graphCaption').textContent = `Step ${i} of ${seq.length}: exploring node ${seq[i-1]}`;
    if(i < seq.length){ animTimer = setTimeout(step, 800); }
    else { animTimer = setTimeout(() => { animTimer = null; view.explored = null; redraw(); }, 900); }
  };
  step();
}

/* --------------------------------------------------------- comparison */
async function runComparison(silent){
  const out = $('compareOut');
  try{
    if(!silent) await refreshGraph();
    const p = getPayload();
    const {data} = await postJSON('/api/compare', {start:p.start, goal:p.goal, mode:p.mode, vehicle:p.vehicle, priority:p.priority});
    if(data.status !== 'success'){ out.innerHTML = `<p class="muted">${esc(data.message || 'Comparison failed')}</p>`; return; }
    renderComparison(data);
  }catch(err){
    console.error(err);
    if(!silent) out.innerHTML = `<p class="muted">Comparison failed: ${esc(err.message)}</p>`;
  }
}

function renderComparison(data){
  const found = data.results.filter(r => r.found);
  const best = found.length ? Math.min(...found.map(r => r.cost)) : null;
  const selected = getAlgorithm();
  const rows = data.results.map(r => {
    const isBest = r.found && Math.abs(r.cost - best) < 1e-9;
    return `<tr class="${r.algorithm === selected ? 'sel' : ''}">`
      + `<td><b>${esc(r.algorithm)}</b>${r.algorithm === selected ? ' <span class="tag route">selected</span>' : ''}</td>`
      + `<td>${r.found ? '<span class="tag ok">Yes</span>' : '<span class="tag bad">No route</span>'}</td>`
      + `<td>${r.found ? r.path.map(esc).join(' → ') : '–'}</td>`
      + `<td>${r.found ? fmt(r.cost) : '–'}${isBest ? ' <span class="tag best">lowest</span>' : ''}</td>`
      + `<td>${r.found ? r.hops : '–'}</td><td>${r.explored_count}</td><td>${Number(r.execution_time_ms).toFixed(3)} ms</td></tr>`;
  }).join('');
  const cards = data.results.map(r => {
    const isBest = r.found && Math.abs(r.cost - best) < 1e-9;
    return `<div class="cmp-card ${r.algorithm === selected ? 'sel' : ''}">`
      + `<div class="cmp-head"><b>${esc(r.algorithm)}</b>${r.found ? '<span class="tag ok">valid route</span>' : '<span class="tag bad">no route</span>'}${isBest ? '<span class="tag best">lowest cost</span>' : ''}</div>`
      + `<div class="mini">${graphSVG(graphData, {start:data.start, goal:data.goal, explored:r.explored, path:r.found ? r.path : null, compact:true})}</div>`
      + `<div class="cmp-meta">Path: <b>${r.found ? r.path.map(esc).join(' → ') : 'none'}</b><br>Cost: <b>${r.found ? fmt(r.cost) : '–'}</b> · Explored: <b>${r.explored_count}</b><br><span class="muted">Order: ${r.explored.join(', ') || '–'}</span></div>`
      + `<button class="ghost small" onclick="showOnMainGraph('${esc(r.algorithm)}')">Show on main graph</button></div>`;
  }).join('');
  $('compareOut').innerHTML =
    `<div class="table-scroll"><table class="data cmp"><thead><tr><th>Algorithm</th><th>Valid route</th><th>Generated path</th><th>Total cost</th><th>Roads</th><th>Explored nodes</th><th>Exec. time</th></tr></thead><tbody>${rows}</tbody></table></div>`
    + `<h3 class="subhead">Why the results differ</h3><ul class="insights">${data.insights.map(t => `<li>${esc(t)}</li>`).join('')}</ul>`
    + `<div class="cmp-grid">${cards}</div>`
    + `<p class="muted small-note">Mini graphs: green = start, red = destination, purple = explored, orange = final route. Costs use the "${esc(data.mode)}" optimization mode. Execution times are tiny on this small graph and vary slightly between runs.</p>`;
}

function showOnMainGraph(name){
  setAlgorithm(name);
  calculate().then(() => $('graphSection').scrollIntoView({behavior:'smooth', block:'start'}));
}

/* ------------------------------------------------ dynamic environment */
async function updateEvent(){
  let ev = $('event').value, value = $('traffic').value;
  if(ev === 'accident_on'){ ev = 'accident'; value = true; }
  else if(ev === 'accident_off'){ ev = 'accident'; value = false; }
  const from = $('roadFrom').value, to = $('roadTo').value;
  try{
    const {ok, data} = await postJSON('/api/event', {from, to, event:ev, value});
    $('eventMessage').textContent = ok ? `${data.message} (road ${from} – ${to})` : `${data.message}: there is no direct road ${from} – ${to}. Pick two connected cities (click a road on the graph).`;
    if(ok){
      changedRoad = ekey(from, to);
      clearTimeout(changedTimer);
      changedTimer = setTimeout(() => { changedRoad = null; redraw(); }, 4000);
      await calculate();
    }
  }catch(err){
    console.error(err);
    $('eventMessage').textContent = 'Error: ' + err.message;
  }
}

async function resetCity(){
  try{
    const {ok, data} = await postJSON('/api/reset', {});
    $('eventMessage').textContent = data.message;
    if(ok){ changedRoad = null; await calculate(); }
  }catch(err){
    console.error(err);
    $('eventMessage').textContent = 'Error: ' + err.message;
  }
}

init();
