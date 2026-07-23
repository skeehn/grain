// Index the durable work record into engram, and wire the graph edges that a
// flat file store cannot express.
//
// Files stay the source of truth; this layer only builds the retrieval and
// relationship index over them. Every call is best-effort — engram being down
// degrades search to lexical, it never blocks a write or throws.
import { createHash } from 'crypto';
import type { WorkEntry } from './worklog.js';

const ENGRAM_HTTP = process.env.ENGRAM_HTTP || 'http://127.0.0.1:7474';

async function req(path: string, init?: RequestInit, timeoutMs = 2_000): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(`${ENGRAM_HTTP}${path}`, { ...init, signal: controller.signal }); }
  catch { return null; }
  finally { clearTimeout(timer); }
}

export async function engramReachable(): Promise<boolean> {
  const response = await req('/health');
  return Boolean(response?.ok);
}

/** Stable per-repository namespace, matching the wiki's projectKey. */
export function projectKey(root: string): string {
  return createHash('sha256').update(root).digest('hex').slice(0, 16);
}

async function addNode(body: string, tags: string[], nodeType = 'document'): Promise<string | null> {
  const response = await req('/add', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body: body.slice(0, 6_000), node_type: nodeType, tags }),
  });
  if (!response?.ok) return null;
  const data = await response.json().catch(() => null) as any;
  return data?.id ?? null;
}

async function relate(from: string, to: string, edgeType: string): Promise<boolean> {
  const response = await req('/relate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, edge_type: edgeType, to }),
  });
  return Boolean(response?.ok);
}

/**
 * Existing node ids by tag for one project.
 *
 * Fetched once per index pass, not once per file — the /nodes endpoint returns
 * the whole project, so a per-file lookup made indexing quadratic.
 */
async function tagIndex(project: string): Promise<Map<string, string>> {
  const index = new Map<string, string>();
  const response = await req(`/nodes?project=${encodeURIComponent(project)}&limit=100000`, undefined, 5_000);
  if (!response?.ok) return index;
  const nodes = await response.json().catch(() => []) as any[];
  for (const node of nodes) {
    if (!node?.id || !Array.isArray(node.tags)) continue;
    for (const tag of node.tags) if (typeof tag === 'string' && tag.startsWith('file:') && !index.has(tag)) index.set(tag, node.id);
  }
  return index;
}

/**
 * One node per touched file, reused across entries.
 *
 * This is what turns the store into an actual graph: without shared file nodes
 * every entry is an island, which is why the memory had 203 nodes and 4 edges.
 */
async function fileNode(path: string, root: string, project: string, index: Map<string, string>): Promise<string | null> {
  const tag = `file:${path}`;
  const existing = index.get(tag);
  if (existing) return existing;
  const created = await addNode(`Source file ${path} in ${root}`, ['file', tag, `project:${project}`], 'entity');
  if (created) index.set(tag, created);
  return created;
}

export interface IndexResult { ok: boolean; nodeId?: string; edges: number }

/**
 * Mirror one work entry into engram and link it to the files it touched.
 * Returns `{ ok: false }` when engram is unreachable — never throws.
 */
export async function indexWorkEntry(entry: WorkEntry, root: string): Promise<IndexResult> {
  if (!(await engramReachable())) return { ok: false, edges: 0 };
  const project = projectKey(root);
  const body = [
    entry.title,
    entry.summary || '',
    entry.files.length ? `Files: ${entry.files.join(', ')}` : '',
    entry.verification ? `Verification: ${entry.verification}` : '',
  ].filter(Boolean).join('\n\n');
  const tags = [
    entry.kind === 'note' ? 'note' : 'worklog',
    `work:${entry.id}`, `project:${project}`, `root:${root}`,
    ...(entry.outcome ? [`outcome:${entry.outcome}`] : []),
    ...entry.tags, ...entry.files.map(file => `touches:${file}`),
  ];
  const nodeId = await addNode(body, tags, entry.kind === 'note' ? 'note' : 'event');
  if (!nodeId) return { ok: false, edges: 0 };

  let edges = 0;
  if (entry.files.length) {
    const index = await tagIndex(project);
    for (const file of entry.files.slice(0, 25)) {
      const target = await fileNode(file, root, project, index);
      if (target && await relate(nodeId, target, entry.kind === 'note' ? 'mentions' : 'changed')) edges++;
    }
  }
  return { ok: true, nodeId, edges };
}

export interface RecallHit { id: string; score: number; body: string; tags: string[]; root?: string }

/**
 * Semantic recall over the work record.
 *
 * Omitting `root` searches every repository — the cross-repo question ("when
 * did I last deal with this?") that neither a filesystem nor a per-repo wiki
 * can answer.
 */
export async function recall(query: string, options: { root?: string; limit?: number; kinds?: string[] } = {}): Promise<RecallHit[]> {
  const parameters = new URLSearchParams({ q: query, top_k: String(options.limit ?? 15) });
  if (options.root) parameters.set('project', projectKey(options.root));
  const response = await req(`/search?${parameters.toString()}`, undefined, 4_000);
  if (!response?.ok) return [];
  const results = await response.json().catch(() => []) as any[];
  const kinds = options.kinds;
  return results
    .map(result => ({
      id: String(result.id), score: Number(result.score ?? 0), body: String(result.body ?? ''),
      tags: Array.isArray(result.tags) ? result.tags.map(String) : [],
      root: (Array.isArray(result.tags) ? result.tags.map(String) : []).find((tag: string) => tag.startsWith('root:'))?.slice(5),
    }))
    .filter(hit => !kinds || kinds.some(kind => hit.tags.includes(kind)));
}

/** Everything the graph knows about one file: entries that touched it. */
export async function relatedToFile(path: string, root: string): Promise<RecallHit[]> {
  const hits = await recall(path, { root, limit: 30 });
  return hits.filter(hit => hit.tags.includes(`touches:${path}`) || hit.body.includes(path));
}
