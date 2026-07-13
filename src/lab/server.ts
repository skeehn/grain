import { createServer, type Server } from 'http';
import { randomBytes } from 'crypto';
import { readRunEvents, listRuns, RunEngine, RunJournal } from '../kernel/index.js';
import { projectRun } from '../tui/projector.js';
import { loadConfig, saveConfig } from '../config.js';
import { THEMES, type GrainThemeName } from '../tui/theme.js';

const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c]!);
const names = ['field', 'studio', 'arcade', 'system'] as const;
const MAX_BODY_BYTES = 1024 * 1024;
const SAFE_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

/** Escapes JSON values placed inside an inline script element. */
function scriptValue(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function validRunId(runId: string | undefined): runId is string { return Boolean(runId && SAFE_RUN_ID.test(runId)); }

function readBody(request: import('http').IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let value = ''; let bytes = 0;
    request.setEncoding('utf8');
    request.on('data', chunk => { bytes += Buffer.byteLength(chunk); if (bytes > MAX_BODY_BYTES) { reject(new Error('Request body exceeds 1 MiB')); request.destroy(); return; } value += chunk; });
    request.on('end', () => resolve(value)); request.on('error', reject);
  });
}

function card(title: string, body: string, kind = ''): string { return `<section class="card ${kind}"><h2>${escapeHtml(title)}</h2>${body}</section>`; }
function renderLab(runId?: string): string {
  const resolved = runId || listRuns().at(-1);
  if (!resolved) return card('No run yet', '<p>Start Grain, then open the Lab to inspect a living run.</p>');
  if (!validRunId(resolved)) throw new Error('Invalid run ID');
  const view = projectRun(readRunEvents(resolved));
  const status = view.run.status;
  const timeline = view.timeline.slice(-8).map(event => `<li><b>#${event.sequence}</b> ${escapeHtml(event.label)} <span>${escapeHtml(event.detail)}</span></li>`).join('');
  const files = view.workspace.length ? view.workspace.slice(-8).map(file => `<li>${escapeHtml(file.path)}</li>`).join('') : '<li>Nothing changed yet.</li>';
  const verify = `${view.diagnostics.passed} passed · ${view.diagnostics.failed} failed`;
  return [
    card('Rice report', `<div class="hero"><div class="rice" aria-label="Grain companion">(•ᴗ•)</div><div><strong>${escapeHtml(status)}</strong><p>${escapeHtml(view.run.task)}</p><small>${escapeHtml(view.run.provider)}/${escapeHtml(view.run.model)}</small></div></div>`, 'hero-card'),
    card('Work trace', `<ol>${timeline}</ol>`),
    card('Files', `<ul>${files}</ul>`),
    card('Verification', `<p class="metric">${escapeHtml(verify)}</p>${['running', 'paused', 'waiting_approval'].includes(status) ? `<button data-action="pause">${status === 'paused' ? 'Resume work' : 'Pause work'}</button>` : '<p class="muted">Viewing evidence only</p>'}`),
    card('Experiment', '<p>Generated artifacts are isolated from Grain controls.</p><iframe sandbox="allow-scripts" title="Grain experiment" srcdoc="&lt;style&gt;body{margin:0;background:#131530;color:#e8f1ff;font:14px system-ui;padding:16px}b{color:#f6e25b}&lt;/style&gt;&lt;b&gt;Safe sandbox&lt;/b&gt;&lt;p&gt;Artifacts can visualize work, but cannot access files, network, or controls.&lt;/p&gt;"></iframe>', 'experiment'),
  ].join('');
}

function shell(token: string, runId?: string): string {
  const theme = loadConfig().tui?.theme || 'field';
  return `<!doctype html><html data-theme="${escapeHtml(theme)}"><meta name="viewport" content="width=device-width"><title>Grain Lab</title>
<style>
:root{--bg:#161713;--panel:#1d1f1a;--raised:#25271f;--ink:#e7e0d2;--muted:#929084;--accent:#d6a85f;--line:#393a31;--good:#88a678}html[data-theme="studio"]{--bg:#fff8ed;--panel:#fffdf8;--raised:#f6e5c7;--ink:#30291f;--muted:#796f63;--accent:#c87337;--line:#d9c7a9;--good:#4e8b72}html[data-theme="arcade"]{--bg:#0a0b1c;--panel:#131530;--raised:#20234a;--ink:#e8f1ff;--muted:#919bc2;--accent:#f6e25b;--line:#3d4176;--good:#71e6a1}html[data-theme="system"]{--bg:#000;--panel:#000;--raised:#000;--ink:#fff;--muted:#aaa;--accent:#fff;--line:#777;--good:#fff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px ui-monospace,SFMono-Regular,Menlo,monospace}header{position:sticky;top:0;display:flex;align-items:center;justify-content:space-between;padding:14px max(18px,calc((100vw - 1200px)/2));background:color-mix(in srgb,var(--bg) 88%,transparent);border-bottom:1px solid var(--line);backdrop-filter:blur(12px)}.brand{font-weight:800;color:var(--accent);letter-spacing:.12em}.brand b{display:inline-block;animation:bob 1.4s steps(2) infinite}main{max-width:1200px;margin:0 auto;padding:26px 18px;display:grid;grid-template-columns:repeat(12,1fr);gap:14px}.card{grid-column:span 4;background:var(--panel);border:1px solid var(--line);padding:16px;min-height:160px}.hero-card{grid-column:span 8;background:var(--raised)}.experiment{grid-column:span 12}h2{font-size:11px;letter-spacing:.13em;text-transform:uppercase;color:var(--accent);margin:0 0 14px}.hero{display:flex;gap:18px;align-items:center}.rice{font-size:45px;line-height:1;color:var(--accent);text-shadow:3px 3px 0 var(--line)}strong{font-size:20px;color:var(--good)}p{line-height:1.5}small,span{color:var(--muted)}ol,ul{padding-left:20px;margin:0}li{padding:5px 0;border-bottom:1px solid color-mix(in srgb,var(--line) 60%,transparent)}button,select{font:inherit;background:var(--raised);color:var(--ink);border:1px solid var(--line);padding:8px 11px;cursor:pointer}button:hover{border-color:var(--accent)}iframe{width:100%;height:130px;border:1px solid var(--line);background:#131530}@keyframes bob{50%{transform:translateY(-2px)}}@media(prefers-reduced-motion:reduce){*{animation:none!important}}@media(max-width:760px){.card,.hero-card{grid-column:span 12}}
</style><header><div class="brand">GRAIN <b>(•ᴗ•)</b> LAB</div><label>Theme <select id="theme">${names.map(name => `<option ${name === theme ? 'selected' : ''}>${name}</option>`).join('')}</select></label></header><main id="cards">${renderLab(runId)}</main>
<script>const token=${scriptValue(token)},run=${scriptValue(runId||'')};async function api(path,body){return fetch(path,{method:body?'POST':'GET',headers:{'x-grain-lab-token':token,'content-type':'application/json'},body:body?JSON.stringify(body):undefined})}document.addEventListener('click',async e=>{const b=e.target.closest('[data-action]');if(!b)return;try{await api('/api/action',{action:b.dataset.action,runId:run});refresh()}catch{}});document.querySelector('#theme').onchange=async e=>{try{await api('/api/theme',{theme:e.target.value});document.documentElement.dataset.theme=e.target.value}catch{}};async function refresh(){try{const r=await api('/api/cards?run='+encodeURIComponent(run));if(r.ok)document.querySelector('#cards').innerHTML=await r.text()}catch{}}setInterval(refresh,1000)</script>`;
}

export function startLabServer(port = 7332, host = '127.0.0.1', initialRunId?: string): Server {
  if (host !== '127.0.0.1' && host !== 'localhost') throw new Error('Grain Lab only binds to localhost');
  const token = randomBytes(18).toString('base64url');
  return createServer(async (request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    const authorized = request.headers['x-grain-lab-token'] === token;
    const send = (code: number, body: string, type = 'text/html; charset=utf-8') => response.writeHead(code, { 'content-type': type, 'content-security-policy': "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'" }).end(body);
    const requestedRunId = url.searchParams.get('run') || initialRunId || undefined;
    if (requestedRunId && !validRunId(requestedRunId)) return send(400, 'Invalid run ID', 'text/plain');
    if (url.pathname === '/') return send(200, shell(token, requestedRunId));
    if (!authorized) return send(403, 'Grain Lab token required', 'text/plain');
    if (url.pathname === '/api/cards') {
      try { return send(200, renderLab(requestedRunId)); }
      catch (error: any) { return send(400, error.message || 'Invalid run ID', 'text/plain'); }
    }
    let body: any = {}; try { body = JSON.parse(await readBody(request)); }
    catch (error: any) { return send(400, error.message || 'Invalid JSON body', 'text/plain'); }
    if (url.pathname === '/api/theme' && names.includes(body.theme)) { const config = loadConfig(); saveConfig({ ...config, tui: { ...config.tui!, theme: body.theme, schemaVersion: 2 } }); return send(204, ''); }
    if (url.pathname === '/api/action' && body.action === 'pause') {
      const id = body.runId || initialRunId || listRuns().at(-1); if (!id) return send(404, 'No run', 'text/plain'); if (!validRunId(id)) return send(400, 'Invalid run ID', 'text/plain');
      try { const engine = new RunEngine(RunJournal.open(id)); const state = engine.state(); engine.dispatch({ type: state.status === 'paused' ? 'resume' : 'pause' }); return send(204, ''); }
      catch (error: any) { return send(409, error.message || 'Action unavailable', 'text/plain'); }
    }
    if (url.pathname === '/api/action' && body.action === 'answer') {
      const id = body.runId || initialRunId || listRuns().at(-1); if (!id) return send(404, 'No run', 'text/plain'); if (!validRunId(id)) return send(400, 'Invalid run ID', 'text/plain');
      if (typeof body.questionId !== 'string' || typeof body.answer !== 'string') return send(400, 'questionId and answer are required', 'text/plain');
      try { new RunEngine(RunJournal.open(id)).dispatch({ type: 'answer', questionId: body.questionId, answer: body.answer }); return send(204, ''); }
      catch (error: any) { return send(409, error.message || 'Action unavailable', 'text/plain'); }
    }
    return send(404, 'Not found', 'text/plain');
  }).listen(port, host);
}
