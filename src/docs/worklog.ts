// Durable work memory: what you did, why, and what it touched.
//
// The record lives in the repository as reviewable markdown (`docs/grain/…`),
// so it is versioned, diffable, survives an engram wipe, and travels with the
// code. Engram indexes it for meaning-based recall across every repository —
// files give you durability and review, engram gives you retrieval. Neither is
// load-bearing for the other: engram being down never blocks a write.
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'fs';
import { dirname, join, relative, isAbsolute } from 'path';
import { randomUUID } from 'crypto';

export const WORK_DIR = join('docs', 'grain');
export const WORKLOG_DIR = join(WORK_DIR, 'worklog');
export const NOTES_DIR = join(WORK_DIR, 'notes');

export type WorkOutcome = 'succeeded' | 'failed' | 'cancelled';

export interface WorkEntry {
  id: string;
  timestamp: string;
  title: string;
  kind: 'task' | 'note';
  outcome?: WorkOutcome;
  runId?: string;
  provider?: string;
  model?: string;
  files: string[];
  verification?: string;
  summary?: string;
  tags: string[];
}

/** `2026-07-23T06:41:02.000Z` → `2026-07`, the worklog file it belongs to. */
export function monthKey(timestamp: string): string { return timestamp.slice(0, 7); }
export function dayKey(timestamp: string): string { return timestamp.slice(0, 10); }

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '').slice(0, 60) || 'entry';
}

/** Keep paths repo-relative so the record stays portable across machines. */
export function relativizePaths(paths: string[], root: string): string[] {
  return [...new Set(paths.map(path => {
    if (!isAbsolute(path)) return path;
    const rel = relative(root, path);
    return rel && !rel.startsWith('..') ? rel : path;
  }))].sort();
}

/** One entry, rendered as reviewable markdown with a machine-readable header. */
export function renderEntry(entry: WorkEntry): string {
  const when = entry.timestamp.replace('T', ' ').slice(0, 16);
  const lines = [`## ${when} · ${entry.title}`, ''];
  const field = (label: string, value?: string) => { if (value) lines.push(`- **${label}:** ${value}`); };
  field('id', entry.id);
  field('outcome', entry.outcome);
  field('model', entry.provider ? `${entry.provider}${entry.model ? ` · ${entry.model}` : ''}` : undefined);
  field('run', entry.runId);
  field('verification', entry.verification);
  if (entry.files.length) lines.push(`- **files:** ${entry.files.map(file => `\`${file}\``).join(', ')}`);
  if (entry.tags.length) lines.push(`- **tags:** ${entry.tags.join(', ')}`);
  if (entry.summary?.trim()) { lines.push('', entry.summary.trim()); }
  lines.push('');
  return lines.join('\n');
}

/**
 * Parse entries back out of a worklog file.
 *
 * The file is the source of truth, so it must round-trip: a hand-edited entry
 * has to remain readable by Grain rather than being silently dropped.
 */
export function parseEntries(markdown: string): WorkEntry[] {
  const out: WorkEntry[] = [];
  const sections = markdown.split(/^## /mu).slice(1);
  for (const section of sections) {
    const [heading, ...rest] = section.split('\n');
    const separator = heading.indexOf('·');
    const when = (separator > 0 ? heading.slice(0, separator) : heading).trim();
    const title = (separator > 0 ? heading.slice(separator + 1) : '').trim() || 'entry';
    const body = rest.join('\n');
    const field = (name: string): string | undefined =>
      body.match(new RegExp(`^- \\*\\*${name}:\\*\\* (.+)$`, 'mu'))?.[1]?.trim();
    const files = (field('files') || '').split(',').map(item => item.replace(/[`\s]/gu, '')).filter(Boolean);
    const tags = (field('tags') || '').split(',').map(item => item.trim()).filter(Boolean);
    const summary = body.split(/\n\n/u).slice(1).join('\n\n').trim();
    out.push({
      id: field('id') || randomUUID(), timestamp: when.replace(' ', 'T'), title,
      kind: tags.includes('note') ? 'note' : 'task',
      outcome: field('outcome') as WorkOutcome | undefined, runId: field('run'),
      provider: field('model')?.split('·')[0]?.trim(), model: field('model')?.split('·')[1]?.trim(),
      files, verification: field('verification'), summary: summary || undefined, tags,
    });
  }
  return out;
}

export class WorkLog {
  constructor(private readonly root: string) {}

  private ensure(path: string): string {
    const absolute = join(this.root, path);
    mkdirSync(dirname(absolute), { recursive: true });
    return absolute;
  }

  worklogPath(timestamp: string): string { return join(WORKLOG_DIR, `${monthKey(timestamp)}.md`); }
  notePath(timestamp: string): string { return join(NOTES_DIR, `${dayKey(timestamp)}.md`); }

  /** Append a completed task to the durable record. Returns its repo-relative path. */
  record(input: Omit<WorkEntry, 'id' | 'timestamp' | 'kind' | 'tags'> & { tags?: string[]; timestamp?: string }): { entry: WorkEntry; path: string } {
    const timestamp = input.timestamp || new Date().toISOString();
    const entry: WorkEntry = {
      ...input, id: randomUUID().slice(0, 8), timestamp, kind: 'task',
      files: relativizePaths(input.files || [], this.root),
      tags: [...new Set(['task', ...(input.tags || []), ...languageTags(input.files || [])])],
    };
    const path = this.worklogPath(timestamp);
    const absolute = this.ensure(path);
    if (!existsSync(absolute)) {
      appendFileSync(absolute, `# Work log · ${monthKey(timestamp)}\n\nMaintained by Grain. Each entry records one completed task.\n\n`);
    }
    appendFileSync(absolute, `${renderEntry(entry)}\n`);
    return { entry, path };
  }

  /** Capture a durable note by hand. */
  note(text: string, tags: string[] = [], timestamp = new Date().toISOString()): { entry: WorkEntry; path: string } {
    const firstLine = text.trim().split('\n')[0];
    const entry: WorkEntry = {
      id: randomUUID().slice(0, 8), timestamp, kind: 'note',
      title: firstLine.length > 72 ? `${firstLine.slice(0, 69)}…` : firstLine || 'note',
      files: [], summary: text.trim(), tags: [...new Set(['note', ...tags])],
    };
    const path = this.notePath(timestamp);
    const absolute = this.ensure(path);
    if (!existsSync(absolute)) appendFileSync(absolute, `# Notes · ${dayKey(timestamp)}\n\n`);
    appendFileSync(absolute, `${renderEntry(entry)}\n`);
    return { entry, path };
  }

  /** Every recorded entry, newest first. */
  entries(limit = 50): WorkEntry[] {
    const collected: WorkEntry[] = [];
    for (const directory of [WORKLOG_DIR, NOTES_DIR]) {
      const absolute = join(this.root, directory);
      if (!existsSync(absolute)) continue;
      for (const name of readdirSync(absolute).filter(file => file.endsWith('.md'))) {
        try { collected.push(...parseEntries(readFileSync(join(absolute, name), 'utf8'))); } catch { /* skip unreadable */ }
      }
    }
    return collected.sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, limit);
  }

  /** Lexical fallback for when engram is unavailable. */
  search(query: string, limit = 20): WorkEntry[] {
    const terms = query.toLowerCase().split(/\s+/u).filter(Boolean);
    if (!terms.length) return this.entries(limit);
    return this.entries(1000)
      .map(entry => ({ entry, score: score(entry, terms) }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit).map(item => item.entry);
  }
}

function score(entry: WorkEntry, terms: string[]): number {
  const title = entry.title.toLowerCase();
  const body = `${entry.summary || ''} ${entry.files.join(' ')} ${entry.tags.join(' ')}`.toLowerCase();
  return terms.reduce((total, term) =>
    total + (title.includes(term) ? 5 : 0) + (body.includes(term) ? 1 : 0), 0);
}

const EXTENSION_TAGS: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
  rs: 'rust', py: 'python', go: 'go', rb: 'ruby', java: 'java', swift: 'swift',
  c: 'c', h: 'c', cpp: 'cpp', md: 'docs', sql: 'sql', sh: 'shell',
};

export function languageTags(files: string[]): string[] {
  return [...new Set(files.map(file => EXTENSION_TAGS[file.split('.').pop()?.toLowerCase() || '']).filter(Boolean))];
}
