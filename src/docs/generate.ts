// Generate the repository wiki from the code itself.
//
// The previous generator emitted one page listing every file, which nothing
// could verify and nobody would read. These pages are derived from the same
// entity/relationship extraction the agent uses, and every page carries the
// source ranges and content hashes it was built from — so `wiki verify` can
// prove whether a page still describes the code, instead of guessing.
import { execFileSync } from 'child_process';
import { extractKnowledgeGraph, type Entity, type KnowledgeGraph } from '../tools/knowledge-graph.js';
import type { WikiPage, WikiPageType, WikiSource } from '../wiki/types.js';

/**
 * Keep only files git tracks.
 *
 * A repository routinely contains vendored or nested projects that are ignored
 * on purpose (grain's own `grain-site/`, build output, dependencies). Docs
 * generated from those describe code that is not part of this repository, and
 * their provenance hashes churn on every build.
 */
export function restrictToTracked(graph: KnowledgeGraph, root: string): KnowledgeGraph {
  let tracked: Set<string>;
  try {
    tracked = new Set(execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8', maxBuffer: 32_000_000 })
      .split('\n').filter(Boolean));
  } catch { return graph; } // not a git repo — describe everything found
  if (!tracked.size) return graph;
  const entities = graph.entities.filter(entity => tracked.has(entity.file));
  const kept = new Set(entities.map(entity => entity.id));
  return {
    entities,
    relationships: graph.relationships.filter(link => kept.has(link.from) && kept.has(link.to)),
    modules: graph.modules,
    entryPoints: graph.entryPoints.filter(point => tracked.has(point.split(':')[0]) || !point.includes('/')),
  };
}

export interface GeneratedPage {
  id: string;
  title: string;
  type: WikiPageType;
  tags: string[];
  body: string;
  sourcePaths: string[];
}

/** Group entities by their top-level source directory — the subsystem boundary. */
export function groupBySubsystem(entities: Entity[]): Map<string, Entity[]> {
  const groups = new Map<string, Entity[]>();
  for (const entity of entities) {
    const parts = entity.file.split('/').filter(Boolean);
    // `src/tui/app.ts` → `tui`; a flat `cli.ts` → `root`.
    const index = parts[0] === 'src' || parts[0] === 'lib' ? 1 : 0;
    const key = parts.length > index + 1 ? parts[index] : 'root';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(entity);
  }
  return groups;
}

/** Entities other subsystems depend on most — the de-facto public surface. */
export function publicSurface(graph: KnowledgeGraph, entities: Entity[], limit = 12): Entity[] {
  const owned = new Set(entities.map(entity => entity.id));
  const inbound = new Map<string, number>();
  for (const relationship of graph.relationships) {
    if (!owned.has(relationship.to) || owned.has(relationship.from)) continue;
    inbound.set(relationship.to, (inbound.get(relationship.to) || 0) + (relationship.weight || 1));
  }
  return [...entities]
    .sort((a, b) => (inbound.get(b.id) || 0) - (inbound.get(a.id) || 0) || a.name.localeCompare(b.name))
    .slice(0, limit);
}

function entityLine(entity: Entity): string {
  const where = entity.line ? `${entity.file}:${entity.line}` : entity.file;
  const signature = entity.signature ? ` — \`${entity.signature.replace(/\s+/gu, ' ').slice(0, 110)}\`` : '';
  return `- **${entity.name}** (${entity.type}) · \`${where}\`${signature}`;
}

/** Count relationships crossing a subsystem boundary, to describe coupling. */
function crossLinks(graph: KnowledgeGraph, entities: Entity[], byId: Map<string, Entity>): Map<string, number> {
  const owned = new Set(entities.map(entity => entity.id));
  const counts = new Map<string, number>();
  for (const relationship of graph.relationships) {
    if (!owned.has(relationship.from) || owned.has(relationship.to)) continue;
    const target = byId.get(relationship.to);
    if (!target) continue;
    const parts = target.file.split('/').filter(Boolean);
    const index = parts[0] === 'src' || parts[0] === 'lib' ? 1 : 0;
    const key = parts.length > index + 1 ? parts[index] : 'root';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

/**
 * Build the page set for a repository.
 *
 * Returns page content plus the source files each page was derived from; the
 * caller hashes those into provenance so staleness is detectable.
 */
export async function generatePages(root: string): Promise<GeneratedPage[]> {
  const extracted = await extractKnowledgeGraph(root);
  const graph = restrictToTracked(extracted, root);
  const byId = new Map(graph.entities.map(entity => [entity.id, entity]));
  const subsystems = groupBySubsystem(graph.entities);
  const pages: GeneratedPage[] = [];

  // ── Architecture overview ───────────────────────────────────────────────────
  const ranked = [...subsystems.entries()].sort((a, b) => b[1].length - a[1].length);
  const overview = [
    '# Architecture',
    '',
    `Generated from ${graph.entities.length} extracted symbols across ${subsystems.size} subsystem(s).`,
    '',
    '## Subsystems',
    '',
    '| Subsystem | Symbols | Files | Depends on |',
    '|---|---|---|---|',
    ...ranked.map(([name, entities]) => {
      const files = new Set(entities.map(entity => entity.file)).size;
      const links = [...crossLinks(graph, entities, byId).entries()]
        .sort((a, b) => b[1] - a[1]).slice(0, 3)
        .map(([target, count]) => `${target} (${count})`).join(', ');
      return `| [[subsystem-${name}]] | ${entities.length} | ${files} | ${links || '—'} |`;
    }),
    '',
    ...(graph.entryPoints.length ? ['## Entry points', '', ...graph.entryPoints.slice(0, 20).map(point => `- \`${point}\``), ''] : []),
  ].join('\n');
  // No exhaustive source list here: every file is covered by exactly one
  // subsystem page, so listing all of them again would only bloat the
  // frontmatter with hundreds of hashes that verify nothing extra.
  pages.push({
    id: 'architecture', title: 'Architecture', type: 'architecture',
    tags: ['generated', 'architecture'], body: overview, sourcePaths: [],
  });

  // ── One page per subsystem ──────────────────────────────────────────────────
  for (const [name, entities] of ranked) {
    const files = [...new Set(entities.map(entity => entity.file))].sort();
    const surface = publicSurface(graph, entities);
    const depends = [...crossLinks(graph, entities, byId).entries()].sort((a, b) => b[1] - a[1]);
    const byType = new Map<string, number>();
    for (const entity of entities) byType.set(entity.type, (byType.get(entity.type) || 0) + 1);

    pages.push({
      id: `subsystem-${name}`, title: `Subsystem: ${name}`, type: 'subsystem',
      tags: ['generated', 'subsystem', name],
      sourcePaths: files,
      body: [
        `# Subsystem: ${name}`,
        '',
        `${entities.length} symbol(s) across ${files.length} file(s) — ` +
          [...byType.entries()].sort((a, b) => b[1] - a[1]).map(([type, count]) => `${count} ${type}`).join(', ') + '.',
        '',
        '## Most depended-on symbols',
        '',
        ...(surface.length ? surface.map(entityLine) : ['- (nothing outside this subsystem references it)']),
        '',
        '## Files',
        '',
        ...files.map(file => `- \`${file}\``),
        '',
        ...(depends.length ? ['## Depends on', '', ...depends.map(([target, count]) =>
          `- [[subsystem-${target}]] — ${count} reference(s)`), ''] : []),
        'See also [[architecture]].',
        '',
      ].join('\n'),
    });
  }

  return pages;
}

/** Provenance for a page: the exact bytes it was generated from. */
export function buildSources(
  paths: string[],
  read: (path: string) => { total_lines: number; hash: string } | null,
): WikiSource[] {
  const sources: WikiSource[] = [];
  for (const path of paths) {
    const info = read(path);
    if (info) sources.push({ path, start_line: 1, end_line: info.total_lines, hash: info.hash });
  }
  return sources;
}

export type { WikiPage };
