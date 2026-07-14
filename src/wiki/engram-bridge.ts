// Wiki ↔ engram bridge.
//
// Grain's wiki is git-provenance + lexical. engram adds the semantic and graph
// layer: every wiki page is mirrored into the engram memory store (so it is
// retrievable by meaning, not just keyword) and `[[wiki-links]]` between pages
// become engram graph edges (backlinks the agent can traverse).
//
// Every call here is BEST-EFFORT: if the engram server is not running the
// functions no-op (or return empty) so the wiki keeps working unchanged. engram
// is reached only over localhost HTTP — never a build path — so it survives
// grain upgrades and never blocks the wiki on a missing binary.

import type { WikiPage } from './types.js';

const ENGRAM_HTTP = process.env.ENGRAM_HTTP || 'http://localhost:7474';

/** Extract `[[target]]` wiki-link targets from a page body. */
export function extractWikiLinks(body: string): string[] {
  const out = new Set<string>();
  const re = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const target = m[1].trim();
    if (target) out.add(target);
  }
  return [...out];
}

async function req(path: string, init?: RequestInit, timeoutMs = 1500): Promise<Response | null> {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(`${ENGRAM_HTTP}${path}`, { ...init, signal: ctrl.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(tid);
  }
}

/** True if the engram HTTP server is reachable. */
export async function engramAvailable(): Promise<boolean> {
  const res = await req('/health', undefined, 400);
  return !!res && res.ok;
}

const wikiTag = (pageId: string) => `wiki:${pageId}`;

/** Delete any existing engram nodes for this page (idempotent re-sync). */
async function deletePageNodes(pageId: string, project: string): Promise<void> {
  // engram's /nodes over-fetches limit*4 from the store (oldest-first) before
  // applying the project filter, so a large limit is required to be sure we see
  // recently-added wiki nodes and dedupe them.
  const res = await req(`/nodes?project=${encodeURIComponent(project)}&limit=100000`);
  if (!res || !res.ok) return;
  const nodes: any[] = await res.json().catch(() => []);
  const tag = wikiTag(pageId);
  for (const n of nodes) {
    if (Array.isArray(n.tags) && n.tags.includes(tag) && n.id) {
      await req(`/nodes/${n.id}`, { method: 'DELETE' });
    }
  }
}

/** Upsert one wiki page into engram. Returns the engram node id, or null. */
export async function indexPage(page: WikiPage, project: string): Promise<string | null> {
  await deletePageNodes(page.id, project);
  const body = `${page.title}\n\n${page.body}`.slice(0, 6000);
  const tags = [
    'wiki',
    wikiTag(page.id),
    `project:${project}`,
    `wikitype:${page.type}`,
    ...page.tags,
  ];
  const res = await req('/add', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body, node_type: 'document', tags }),
  });
  if (!res || !res.ok) return null;
  const data: any = await res.json().catch(() => null);
  return data?.id ?? null;
}

/** Create a graph edge between two engram nodes. */
async function relate(from: string, to: string, edgeType = 'wikilink'): Promise<void> {
  await req('/relate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, edge_type: edgeType, to }),
  });
}

export interface SyncResult { ok: boolean; indexed: number; edges: number }

/**
 * Mirror all wiki pages into engram and turn `[[links]]` into graph edges.
 * Best-effort: returns { ok:false } (no throw) when engram is unavailable.
 */
export async function syncPages(pages: WikiPage[], project: string): Promise<SyncResult> {
  if (!(await engramAvailable())) return { ok: false, indexed: 0, edges: 0 };

  // Pass 1: index every page, recording page.id -> engram node id.
  const nodeIdByPage = new Map<string, string>();
  let indexed = 0;
  for (const page of pages) {
    const id = await indexPage(page, project);
    if (id) { nodeIdByPage.set(page.id, id); indexed++; }
  }

  // Pass 2: wire [[wiki-links]] as edges between known pages.
  let edges = 0;
  for (const page of pages) {
    const from = nodeIdByPage.get(page.id);
    if (!from) continue;
    for (const target of extractWikiLinks(page.body)) {
      const to = nodeIdByPage.get(target);
      if (to && to !== from) { await relate(from, to); edges++; }
    }
  }

  return { ok: true, indexed, edges };
}

export interface SemanticHit { pageId: string; score: number }

/**
 * Semantic search over wiki pages via engram. Returns wiki page ids ranked by
 * meaning. Empty array when engram is unavailable (caller falls back to lexical).
 */
export async function semanticSearch(query: string, project: string, topK = 10): Promise<SemanticHit[]> {
  const res = await req(
    `/search?q=${encodeURIComponent(query)}&top_k=${topK}&project=${encodeURIComponent(project)}`,
  );
  if (!res || !res.ok) return [];
  const results: any[] = await res.json().catch(() => []);
  const hits: SemanticHit[] = [];
  for (const r of results) {
    const tag = (r.tags as string[] | undefined)?.find(t => t.startsWith('wiki:'));
    if (tag) hits.push({ pageId: tag.slice('wiki:'.length), score: r.score ?? 0 });
  }
  return hits;
}
