import { spawn } from 'child_process';
import { homedir } from 'os';
import { join } from 'path';
import { existsSync } from 'fs';
import type { ToolResult } from '../providers/types.js';

export const engramTool = {
  name: 'engram',
  description: 'Interact with the engram knowledge base. Persist learnings, search context, manage nodes, explore the knowledge graph.',
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['search', 'add', 'get', 'list', 'delete', 'stats', 'graph'],
        description: 'Action to perform: search=FTS+vector, add=persist new knowledge, get=fetch by id, list=all nodes, delete=remove by id, stats=counts, graph=neighbors of a node',
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

const ENGRAM_BIN  = join(homedir(), 'bin', 'engram');
const ENGRAM_DB   = join(homedir(), '.engram', 'knowledge');
const ENGRAM_HTTP = 'http://localhost:7474';

let httpAvailable: boolean | null = null; // null = unchecked
let engramWarningShown = false;

// ─── HTTP helpers ────────────────────────────────────────────────────────────

async function checkHttp(): Promise<boolean> {
  if (httpAvailable !== null) return httpAvailable;
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 400);
    const res = await fetch(`${ENGRAM_HTTP}/health`, { signal: ctrl.signal });
    clearTimeout(tid);
    httpAvailable = res.ok;
  } catch {
    httpAvailable = false;
  }
  return httpAvailable;
}

function qs(params: Record<string, string | number | undefined>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`);
  return parts.length ? '?' + parts.join('&') : '';
}

async function httpGet(path: string): Promise<any> {
  const res = await fetch(`${ENGRAM_HTTP}${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return res.json();
}

async function httpPost(path: string, body: unknown): Promise<any> {
  const res = await fetch(`${ENGRAM_HTTP}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return res.json();
}

async function httpDelete(path: string): Promise<void> {
  const res = await fetch(`${ENGRAM_HTTP}${path}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 204) throw new Error(`HTTP ${res.status} ${res.statusText}`);
}

// ─── HTTP action implementations ─────────────────────────────────────────────

async function searchHttp(query: string, topK = 10, project?: string): Promise<ToolResult> {
  const results: any[] = await httpGet(`/search${qs({ q: query, top_k: topK, project })}`);
  if (results.length === 0) return { content: 'No results found.' };
  const lines = results.map((r, i) => {
    const tags = r.tags?.length ? ` [${r.tags.join(', ')}]` : '';
    return `[${i + 1}] score=${r.score.toFixed(3)} id=${r.id}${tags}\n    ${r.body.slice(0, 140)}`;
  });
  return { content: lines.join('\n\n') };
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
  return new Promise((resolve) => {
    const proc = spawn(ENGRAM_BIN, args, {
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

  if (!useHttp && !existsSync(ENGRAM_BIN)) {
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
    // ── search ──
    case 'search': {
      if (!input.query) return { content: 'query required', is_error: true };
      if (useHttp) {
        try { return await searchHttp(input.query, input.top_k ?? 10, input.project); }
        catch { httpAvailable = false; }
      }
      return runSubprocess(['-d', ENGRAM_DB, 'search', input.query]);
    }

    // ── add ──
    case 'add': {
      if (!input.body) return { content: 'body required', is_error: true };
      if (useHttp) {
        try { return await addHttp(input.body, input.tags ?? [], input.project); }
        catch { httpAvailable = false; }
      }
      const args = ['-d', ENGRAM_DB, 'add', input.body];
      if (input.tags?.length) args.push('--tags', input.tags.join(','));
      return runSubprocess(args);
    }

    // ── get ──
    case 'get': {
      if (!input.query) return { content: 'query (id) required', is_error: true };
      if (useHttp) {
        try { return await getHttp(input.query); }
        catch { httpAvailable = false; }
      }
      return runSubprocess(['-d', ENGRAM_DB, 'get', input.query]);
    }

    // ── list (HTTP-only, no subprocess equivalent) ──
    case 'list': {
      if (!useHttp) return { content: 'list requires engram HTTP server' };
      try { return await listHttp(input.project); }
      catch (e: any) { return { content: `list failed: ${e.message}`, is_error: true }; }
    }

    // ── delete (HTTP-only) ──
    case 'delete': {
      if (!input.query) return { content: 'query (id) required', is_error: true };
      if (!useHttp) return { content: 'delete requires engram HTTP server' };
      try { return await deleteHttp(input.query); }
      catch (e: any) { return { content: `delete failed: ${e.message}`, is_error: true }; }
    }

    // ── stats (HTTP-only) ──
    case 'stats': {
      if (!useHttp) return { content: 'stats requires engram HTTP server' };
      try { return await statsHttp(); }
      catch (e: any) { return { content: `stats failed: ${e.message}`, is_error: true }; }
    }

    // ── graph (HTTP-only) ──
    case 'graph': {
      if (!input.query) return { content: 'query (node id) required', is_error: true };
      if (!useHttp) return { content: 'graph requires engram HTTP server' };
      try { return await graphHttp(input.query, input.depth ?? 1); }
      catch (e: any) { return { content: `graph failed: ${e.message}`, is_error: true }; }
    }

    default:
      return { content: `Unknown action: ${input.action}`, is_error: true };
  }
}
