import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { getWorkspaceFS, type WorkspaceFS } from '../workspace/index.js';
import type { WikiPage, WikiPageType, WikiSource } from './types.js';

const WIKI_DIR = 'docs/wiki';
const MANAGED_START = '<!-- grain:generated:start -->';
const MANAGED_END = '<!-- grain:generated:end -->';
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const quote = (value: string) => JSON.stringify(value);

function commit(root: string): string {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
  catch { return 'uncommitted'; }
}

function frontmatter(page: Omit<WikiPage, 'body' | 'path'>): string {
  return ['---', `id: ${page.id}`, `title: ${quote(page.title)}`, `type: ${page.type}`, `status: ${page.status}`,
    `owners: ${JSON.stringify(page.owners)}`, `tags: ${JSON.stringify(page.tags)}`,
    `source_commit: ${page.source_commit}`, `generated_at: ${page.generated_at}`,
    `sources: ${JSON.stringify(page.sources)}`, '---'].join('\n');
}

function parse(path: string, markdown: string): WikiPage {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) throw new Error(`Wiki page lacks valid frontmatter: ${path}`);
  const fields: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const split = line.indexOf(':');
    if (split > 0) fields[line.slice(0, split).trim()] = line.slice(split + 1).trim();
  }
  const json = <T>(key: string, fallback: T): T => {
    try { return JSON.parse(fields[key]) as T; } catch { return fallback; }
  };
  return { id: fields.id, title: json('title', fields.title), type: fields.type as WikiPageType,
    status: fields.status as WikiPage['status'], owners: json('owners', []), tags: json('tags', []),
    source_commit: fields.source_commit, generated_at: fields.generated_at, sources: json<WikiSource[]>('sources', []),
    body: match[2], path };
}

export class WikiEngine {
  constructor(private fs: WorkspaceFS = getWorkspaceFS()) {}

  /** Stable per-repository namespace, shared with the engram bridge + catalog. */
  projectKey(): string { return sha(this.fs.root).slice(0, 16); }

  /**
   * Mirror every wiki page into engram (semantic memory) and turn `[[links]]`
   * into graph edges. Best-effort — returns { ok:false } when engram is down,
   * never throws, never blocks the wiki.
   */
  async sync(): Promise<import('./engram-bridge.js').SyncResult> {
    const { syncPages } = await import('./engram-bridge.js');
    return syncPages(this.pages(), this.projectKey());
  }

  pages(): WikiPage[] {
    if (!existsSync(this.fs.resolve(WIKI_DIR))) return [];
    return this.fs.list(WIKI_DIR).filter(path => path.endsWith('.md')).map(path => parse(path, this.fs.readRange(path, 1, Number.MAX_SAFE_INTEGER).content));
  }

  build(): WikiPage {
    const files = this.fs.list('.', 12).filter(path => /\.(ts|tsx|js|jsx|rs|py|go|md)$/.test(path) && !path.startsWith(`${WIKI_DIR}/`));
    const sources: WikiSource[] = files.slice(0, 500).map(path => {
      const read = this.fs.readRange(path, 1, Number.MAX_SAFE_INTEGER);
      return { path, start_line: 1, end_line: read.total_lines, hash: read.hash };
    });
    const metadata = { id: 'repository-index', title: 'Repository Index', type: 'architecture' as const,
      status: 'current' as const, owners: [], tags: ['generated', 'repository'], source_commit: commit(this.fs.root),
      generated_at: new Date().toISOString(), sources };
    const grouped = new Map<string, string[]>();
    for (const source of sources) {
      const group = source.path.split('/')[0] || '.';
      if (!grouped.has(group)) grouped.set(group, []);
      grouped.get(group)!.push(source.path);
    }
    const generated = [...grouped].sort().map(([group, paths]) => `## ${group}\n\n${paths.map(path => `- [${path}](../../${path})`).join('\n')}`).join('\n\n');
    const existingPath = `${WIKI_DIR}/repository-index.md`;
    let human = '# Repository Index\n\nThis page is maintained by Grain. Add durable human notes below the generated region.\n';
    if (existsSync(this.fs.resolve(existingPath))) {
      const existing = this.fs.readRange(existingPath, 1, Number.MAX_SAFE_INTEGER).content;
      const parsed = existing.match(/^---\n[\s\S]*?\n---\n?([\s\S]*)$/)?.[1] || existing;
      human = parsed.replace(new RegExp(`${MANAGED_START}[\\s\\S]*?${MANAGED_END}`), '').trim();
    }
    const markdown = `${frontmatter(metadata)}\n${human}\n\n${MANAGED_START}\n${generated}\n${MANAGED_END}\n`;
    this.fs.writeAtomic(existingPath, markdown);
    this.updateCatalog({ ...metadata, body: markdown, path: existingPath });
    return parse(existingPath, markdown);
  }

  search(query: string): WikiPage[] {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    return this.pages().map(page => ({ page, score: terms.reduce((n, term) => n +
      (page.title.toLowerCase().includes(term) ? 5 : 0) + (page.tags.some(tag => tag.toLowerCase().includes(term)) ? 3 : 0) +
      (page.body.toLowerCase().includes(term) ? 1 : 0), 0) })).filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score).map(item => item.page);
  }

  get(id: string): WikiPage | undefined { return this.pages().find(page => page.id === id || page.path === id); }

  verify(): { valid: boolean; stale: Array<{ page: string; source: string; reason: string }> } {
    const stale: Array<{ page: string; source: string; reason: string }> = [];
    for (const page of this.pages()) for (const source of page.sources) {
      try {
        const current = this.fs.readRange(source.path, 1, Number.MAX_SAFE_INTEGER);
        if (current.hash !== source.hash) stale.push({ page: page.id, source: source.path, reason: 'content hash changed' });
        else if (source.start_line < 1 || source.end_line > current.total_lines) stale.push({ page: page.id, source: source.path, reason: 'line range invalid' });
      } catch (error: any) { stale.push({ page: page.id, source: source.path, reason: error.message }); }
    }
    return { valid: stale.length === 0, stale };
  }

  propose(id: string, content: string): string {
    const target = `${WIKI_DIR}/proposals/${id}-${Date.now()}.md`;
    this.fs.writeAtomic(target, `# Proposed update: ${id}\n\n${content}\n`);
    return target;
  }

  diff(): string {
    try { return execFileSync('git', ['diff', '--', WIKI_DIR], { cwd: this.fs.root, encoding: 'utf8' }) || 'No wiki changes.'; }
    catch (error: any) { return `Wiki diff unavailable: ${error.message}`; }
  }

  private updateCatalog(page: WikiPage): void {
    const home = process.env.GRAIN_HOME || join(homedir(), '.grain');
    const dir = join(home, 'wiki');
    mkdirSync(dir, { recursive: true });
    const path = join(dir, 'catalog.json');
    let catalog: any = { projects: {} };
    try { catalog = JSON.parse(readFileSync(path, 'utf8')); } catch {}
    const project = sha(this.fs.root).slice(0, 16);
    catalog.projects[project] = catalog.projects[project] || { root: this.fs.root, pages: {} };
    catalog.projects[project].pages[page.id] = { title: page.title, path: page.path, tags: page.tags, source_commit: page.source_commit };
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(catalog, null, 2), { mode: 0o600 });
    renameSync(tmp, path);
  }
}
