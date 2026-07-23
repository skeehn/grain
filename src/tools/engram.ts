import { spawn } from 'child_process';
import { homedir } from 'os';
import { join } from 'path';
import { existsSync } from 'fs';
import type { ToolResult } from '../providers/types.js';
import { loadConfig } from '../config.js';
import { getEngramClient, resetEngramClient, MemoryService } from '../engram/index.js';

export const engramTool = {
  name: 'engram',
  description: 'Interact with the engram knowledge base. Persist learnings, search context, manage nodes, explore the knowledge graph.',
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['status', 'search', 'add', 'get', 'list', 'edit', 'delete', 'export', 'rebuild', 'stats', 'graph'],
        description: 'Action to perform. Governed edit/export/rebuild operations require Engram /v1.',
      },
      query:   { type: 'string', description: 'Search query (search), node id (get/delete/graph)' },
      body:    { type: 'string', description: 'Content to store (add)' },
      tags:    { type: 'array', items: { type: 'string' }, description: 'Tags (add)' },
      project: { type: 'string', description: 'Project namespace — filters results to this project (search/list/add)' },
      top_k:   { type: 'number', description: 'Max results to return (search, default 10)' },
      depth:   { type: 'number', description: 'Graph traversal depth (graph, default 1)' },
    },
    required: ['action'],
  },
};

const HTTP_TIMEOUT_MS = 5_000;
const SEARCH_TIMEOUT_MS = 15_000;
const HEALTH_TIMEOUT_MS = 2_000;
const NEGATIVE_CACHE_MS = 1_000;

function engramBin(): string {
  return process.env.GRAIN_ENGRAM_BIN || join(homedir(), 'bin', 'engram');
}

function engramDb(): string {
  return loadConfig().engram_db.replace(/^~(?=\/|$)/u, homedir());
}

function engramHttp(): string {
  return (process.env.GRAIN_ENGRAM_HTTP || 'http://127.0.0.1:7474').replace(/\/$/u, '');
}

let httpAvailable: boolean | null = null; // null = unchecked
let httpCheckedAt = 0;
let engramWarningShown = false;

// ─── HTTP helpers ────────────────────────────────────────────────────────────

async function checkHttp(): Promise<boolean> {
  if (httpAvailable === true) return true;
  if (httpAvailable === false && Date.now() - httpCheckedAt < NEGATIVE_CACHE_MS) return false;
  try {
    const status = await getEngramClient().status(true);
    httpAvailable = status.available;
  } catch {
    httpAvailable = false;
  }
  httpCheckedAt = Date.now();
  return httpAvailable;
}

export function resetEngramTransportState(): void {
  httpAvailable = null;
  httpCheckedAt = 0;
  engramWarningShown = false;
  resetEngramClient();
}

export function formatEngramStatus(content: string): string {
  try {
    const status = JSON.parse(content) as {
      available?: boolean; degraded?: boolean; transport?: string; reason?: string;
      capabilities?: { apiVersion?: string; searchModes?: string[]; supportsGovernance?: boolean;
        supportsIndexStatus?: boolean; supportsExport?: boolean; supportsIndexRebuild?: boolean };
    };
    const available = status.available === true;
    const transport = status.transport || 'unknown'; const api = status.capabilities?.apiVersion || 'unknown';
    const lines = [
      'MEMORY',
      `${available ? '✓' : '×'} ${available ? 'Connected' : 'Unavailable'}  ${transport}  API ${api}`,
      `  Search     ${(status.capabilities?.searchModes || []).join(', ') || 'unavailable'}`,
      `  Governance ${status.capabilities?.supportsGovernance ? 'enabled' : 'unavailable'}`,
      `  Index ops  ${status.capabilities?.supportsIndexStatus ? 'status' : 'no status'} · ${status.capabilities?.supportsIndexRebuild ? 'rebuild' : 'no rebuild'} · ${status.capabilities?.supportsExport ? 'export' : 'no export'}`,
    ];
    if (status.degraded || status.reason) lines.push('', `! ${status.reason || 'Memory is operating in degraded mode.'}`);
    return lines.join('\n');
  } catch { return content; }
}

export function formatEngramStats(content: string): string {
  const counts = Object.fromEntries([...content.matchAll(/^(Nodes|FTS docs|Vectors):\s*(\d+)/gmu)]
    .map(match => [match[1], Number(match[2])]));
  const nodes = counts.Nodes; const fts = counts['FTS docs']; const vectors = counts.Vectors;
  if (!Number.isFinite(nodes)) return content;
  const divergent = (Number.isFinite(fts) && fts !== nodes) || (Number.isFinite(vectors) && vectors > 0 && vectors !== nodes);
  return `INDEX\n${content.split('\n').map(line => `  ${line}`).join('\n')}` +
    (divergent ? `\n\n! Counts diverge: ${nodes} nodes · ${fts ?? '?'} FTS · ${vectors ?? '?'} vectors` : '\n\n✓ Index counts agree');
}

function qs(params: Record<string, string | number | undefined>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`);
  return parts.length ? '?' + parts.join('&') : '';
}

async function httpGet(path: string): Promise<any> {
  const timeout = path.startsWith('/search') ? SEARCH_TIMEOUT_MS : HTTP_TIMEOUT_MS;
  const res = await fetch(`${engramHttp()}${path}`, { signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return res.json();
}

async function httpPost(path: string, body: unknown): Promise<any> {
  const res = await fetch(`${engramHttp()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return res.json();
}

async function httpDelete(path: string): Promise<void> {
  const res = await fetch(`${engramHttp()}${path}`, { method: 'DELETE', signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
  if (!res.ok && res.status !== 204) throw new Error(`HTTP ${res.status} ${res.statusText}`);
}

// ─── HTTP action implementations ─────────────────────────────────────────────

async function searchHttp(query: string, topK = 10, project?: string): Promise<ToolResult> {
  const results = await new MemoryService().search({ query, limit: topK, scope: project ? { repository: project } : undefined });
  if (results.length === 0) return { content: 'No results found.' };
  const lines = results.map((r, i) => {
    const tags = r.memory.tags?.length ? ` [${r.memory.tags.join(', ')}]` : '';
    const provenance = r.memory.provenance?.sourceUri ? ` source=${r.memory.provenance.sourceUri}` : '';
    return `[${i + 1}] score=${r.score.toFixed(3)} id=${r.memory.id} status=${r.memory.status}${tags}${provenance}\n    ${r.memory.content.slice(0, 140)}`;
  });
  return { content: lines.join('\n\n') };
}

async function statusHttp(): Promise<ToolResult> {
  const status = await getEngramClient().status(true);
  return { content: JSON.stringify(status, null, 2), is_error: status.available ? undefined : true };
}

function formatMemory(memory: import('../engram/index.js').MemoryRecordV1): string {
  const source = memory.provenance.sourceUri || memory.provenance.sourceRunId;
  return `ID: ${memory.id}\nType: ${memory.type}\nStatus: ${memory.status}\nConfidence: ${memory.confidence}` +
    `${source ? `\nSource: ${source}` : ''}${memory.tags.length ? `\nTags: ${memory.tags.join(', ')}` : ''}\n\n${memory.content}`;
}

async function addHttp(body: string, tags: string[] = [], project?: string): Promise<ToolResult> {
  const allTags = project ? [...tags, `project:${project}`] : tags;
  const data = await httpPost('/add', { body, tags: allTags });
  return { content: `Added node ${data.id}` };
}

async function getHttp(id: string): Promise<ToolResult> {
  const node: any = await httpGet(`/nodes/${id}`);
  const tags = node.tags?.length ? `\nTags: ${node.tags.join(', ')}` : '';
  return { content: `ID: ${node.id}\nType: ${node.node_type}${tags}\n\n${node.body}` };
}

async function listHttp(project?: string): Promise<ToolResult> {
  const nodes: any[] = await httpGet(`/nodes${qs({ project })}`);
  if (nodes.length === 0) return { content: 'No nodes found.' };
  const lines = nodes.map(n => {
    const tags = n.tags?.length ? ` [${n.tags.join(', ')}]` : '';
    return `${n.id}${tags}: ${n.body.slice(0, 80)}`;
  });
  return { content: `${nodes.length} node(s):\n\n${lines.join('\n')}` };
}

async function deleteHttp(id: string): Promise<ToolResult> {
  await httpDelete(`/nodes/${id}`);
  return { content: `Deleted node ${id}` };
}

async function statsHttp(): Promise<ToolResult> {
  const s: any = await httpGet('/stats');
  return {
    content:
      `Nodes: ${s.nodes}\n` +
      `Edges: ${s.edges}\n` +
      `Clusters: ${s.clusters}\n` +
      `FTS docs: ${s.fts_docs}\n` +
      `Vectors: ${s.vectors}`,
  };
}

async function graphHttp(id: string, depth = 1): Promise<ToolResult> {
  const g: any = await httpGet(`/graph/${id}${qs({ depth })}`);
  const nodes = (g.nodes as any[]).map(n => `  ${n.id}: ${n.body.slice(0, 60)}`).join('\n');
  const edges = (g.edges as any[]).map(e => `  ${e.from ?? e.source} --[${e.edge_type}]--> ${e.to ?? e.target}`).join('\n');
  return {
    content:
      `Graph around ${id} (depth=${depth}):\n\nNodes (${g.nodes.length}):\n${nodes}\n\nEdges (${g.edges.length}):\n${edges || '  (none)'}`,
  };
}

// ─── Subprocess fallback ──────────────────────────────────────────────────────

function runSubprocess(args: string[]): Promise<ToolResult> {
  const bin = engramBin();
  if (!existsSync(bin)) return Promise.resolve({ content: 'engram not available', is_error: true });
  return new Promise((resolve) => {
    const proc = spawn(bin, ['-d', engramDb(), ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10000,
      env: { ...process.env },
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      if (code !== 0) resolve({ content: stderr || `engram exited ${code}`, is_error: true });
      else resolve({ content: stdout || 'OK' });
    });
    proc.on('error', (err) => resolve({ content: `engram error: ${err.message}`, is_error: true }));
  });
}

// ─── Main executor ────────────────────────────────────────────────────────────

export async function executeEngram(input: {
  action: string;
  query?: string;
  body?: string;
  tags?: string[];
  project?: string;
  top_k?: number;
  depth?: number;
}): Promise<ToolResult> {
  const useHttp = await checkHttp();

  if (!useHttp && !existsSync(engramBin())) {
    if (!engramWarningShown) {
      engramWarningShown = true;
    }
    switch (input.action) {
      case 'search': return { content: 'No results (engram not available)' };
      case 'add':    return { content: 'Knowledge not persisted (engram not available)' };
      default:       return { content: 'engram not available' };
    }
  }

  switch (input.action) {
    case 'status': {
      try { return await statusHttp(); }
      catch (error) { return { content: error instanceof Error ? error.message : String(error), is_error: true }; }
    }
    // ── search ──
    case 'search': {
      if (!input.query) return { content: 'query required', is_error: true };
      if (useHttp) {
        try { return await searchHttp(input.query, input.top_k ?? 10, input.project); }
        catch { httpAvailable = false; }
      }
      const args = ['search', input.query, '--top-k', String(input.top_k ?? 10)];
      if (input.project) args.push('--project', input.project);
      return runSubprocess(args);
    }

    // ── add ──
    case 'add': {
      if (!input.body) return { content: 'body required', is_error: true };
      if (useHttp) {
        const status = await getEngramClient().status();
        if (status.transport === 'v1') {
          try {
            const record = await new MemoryService().propose({ content: input.body,
              type: input.tags?.includes('error') ? 'error' : input.project ? 'repository_knowledge' : 'fact',
              scope: input.project ? { repository: input.project } : { user: 'local' }, tags: input.tags });
            return { content: `Proposed memory ${record.id} (candidate; requires independent validation)` };
          } catch (error) { return { content: error instanceof Error ? error.message : String(error), is_error: true }; }
        }
        try {
          return await addHttp(input.body, input.tags ?? [], input.project);
        }
        catch { httpAvailable = false; }
      }
      const args = ['add', input.body];
      if (input.tags?.length) args.push('--tags', input.tags.join(','));
      if (input.project) args.push('--project', input.project);
      return runSubprocess(args);
    }

    // ── get ──
    case 'get': {
      if (!input.query) return { content: 'query (id) required', is_error: true };
      if (useHttp) {
        const status = await getEngramClient().status();
        if (status.transport === 'v1') {
          try { return { content: formatMemory(await getEngramClient().get(input.query)) }; }
          catch (error) { return { content: error instanceof Error ? error.message : String(error), is_error: true }; }
        }
        try {
          return await getHttp(input.query);
        }
        catch { httpAvailable = false; }
      }
      return runSubprocess(['get', input.query]);
    }

    case 'edit': {
      if (!input.query) return { content: 'query (id) required', is_error: true };
      if (!input.body) return { content: 'body (new content) required', is_error: true };
      if (!useHttp) return { content: 'Memory editing requires an available Engram /v1 daemon', is_error: true };
      try { return { content: formatMemory(await getEngramClient().update(input.query, { content: input.body })) }; }
      catch (error) { return { content: error instanceof Error ? error.message : String(error), is_error: true }; }
    }

    // ── list ──
    case 'list': {
      if (useHttp) {
        const status = await getEngramClient().status();
        if (status.transport === 'v1') {
          try {
            const memories = await getEngramClient().list({ limit: input.top_k ?? 20,
              scope: input.project ? { repository: input.project } : undefined });
            return { content: memories.length ? memories.map(formatMemory).join('\n\n---\n\n') : 'No memories found.' };
          } catch (error) { return { content: error instanceof Error ? error.message : String(error), is_error: true }; }
        }
        try {
          return await listHttp(input.project);
        }
        catch { httpAvailable = false; httpCheckedAt = Date.now(); }
      }
      const args = ['list', '--limit', String(input.top_k ?? 20)];
      if (input.project) args.push('--project', input.project);
      return runSubprocess(args);
    }

    // ── delete ──
    case 'delete': {
      if (!input.query) return { content: 'query (id) required', is_error: true };
      if (useHttp) {
        const status = await getEngramClient().status();
        if (status.transport === 'v1') {
          try { await getEngramClient().forget(input.query); return { content: `Deleted memory ${input.query}` }; }
          catch (error) { return { content: error instanceof Error ? error.message : String(error), is_error: true }; }
        }
        try {
          return await deleteHttp(input.query);
        }
        catch { httpAvailable = false; httpCheckedAt = Date.now(); }
      }
      return runSubprocess(['delete', input.query]);
    }

    case 'export': {
      if (!useHttp) return { content: 'Memory export requires an available Engram /v1 daemon', is_error: true };
      try { return { content: JSON.stringify(await getEngramClient().export({
        scope: input.project ? { repository: input.project } : undefined,
      }), null, 2) }; }
      catch (error) { return { content: error instanceof Error ? error.message : String(error), is_error: true }; }
    }

    case 'rebuild': {
      if (!useHttp) return { content: 'Index rebuild requires an available Engram /v1 daemon', is_error: true };
      try { return { content: JSON.stringify(await getEngramClient().rebuildIndex(), null, 2) }; }
      catch (error) { return { content: error instanceof Error ? error.message : String(error), is_error: true }; }
    }

    // ── stats ──
    case 'stats': {
      if (useHttp) {
        const status = await getEngramClient().status();
        if (status.transport === 'v1') {
          try { return { content: JSON.stringify(await getEngramClient().indexStatus(), null, 2) }; }
          catch (error) { return { content: error instanceof Error ? error.message : String(error), is_error: true }; }
        }
        try {
          return await statsHttp();
        }
        catch { httpAvailable = false; httpCheckedAt = Date.now(); }
      }
      return runSubprocess(['stats']);
    }

    // ── graph ──
    case 'graph': {
      if (!input.query) return { content: 'query (node id) required', is_error: true };
      if (useHttp) {
        try { return await graphHttp(input.query, input.depth ?? 1); }
        catch { httpAvailable = false; httpCheckedAt = Date.now(); }
      }
      return runSubprocess(['graph', input.query, '--depth', String(input.depth ?? 1)]);
    }

    default:
      return { content: `Unknown action: ${input.action}`, is_error: true };
  }
}
