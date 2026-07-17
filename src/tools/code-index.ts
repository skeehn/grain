// Lean, self-contained code retrieval — no DB, no cloud embeddings, no repo
// clone. A per-process symbol index (definitions) + ranked content search over
// the repo. Built lazily on first query, refreshed per file by mtime.
import { readdirSync, statSync, readFileSync } from 'fs';
import { join, extname, relative, sep } from 'path';

export type SymbolKind = 'function' | 'class' | 'interface' | 'type' | 'struct' | 'enum' | 'trait' | 'const' | 'method';

export interface SymbolDef { name: string; kind: SymbolKind; file: string; line: number }
interface IndexedFile { path: string; mtimeMs: number; defs: SymbolDef[]; lines: string[] }

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'target', '.next', 'vendor', '__pycache__', '.venv', 'venv', 'coverage', '.turbo']);
const CODE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.rs', '.go', '.c', '.h', '.cpp', '.cc', '.hpp', '.java', '.rb', '.php', '.swift', '.kt', '.scala', '.sh']);
const MAX_FILE_BYTES = 512 * 1024; // skip generated/minified giants

// Definition patterns per family. Each capture group 1 is the symbol name.
const DEF_PATTERNS: Array<{ re: RegExp; kind: SymbolKind }> = [
  // TS/JS
  { re: /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/, kind: 'function' },
  { re: /^\s*(?:export\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)/, kind: 'class' },
  { re: /^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/, kind: 'interface' },
  { re: /^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*[=<]/, kind: 'type' },
  { re: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/, kind: 'function' },
  { re: /^\s*(?:export\s+)?enum\s+([A-Za-z_$][\w$]*)/, kind: 'enum' },
  // Python
  { re: /^\s*def\s+([A-Za-z_]\w*)/, kind: 'function' },
  { re: /^\s*class\s+([A-Za-z_]\w*)/, kind: 'class' },
  // Rust
  { re: /^\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)/, kind: 'function' },
  { re: /^\s*(?:pub\s+)?struct\s+([A-Za-z_]\w*)/, kind: 'struct' },
  { re: /^\s*(?:pub\s+)?trait\s+([A-Za-z_]\w*)/, kind: 'trait' },
  { re: /^\s*(?:pub\s+)?enum\s+([A-Za-z_]\w*)/, kind: 'enum' },
  // Go
  { re: /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/, kind: 'function' },
  { re: /^\s*type\s+([A-Za-z_]\w*)\s+(?:struct|interface)/, kind: 'struct' },
];

let ROOT = process.cwd();
const index = new Map<string, IndexedFile>();

/** Point the index at a repo root (usually the tool cwd). Clears stale state. */
export function setCodeIndexRoot(root: string): void {
  if (root !== ROOT) { ROOT = root; index.clear(); }
}

function walk(dir: string, out: string[]): void {
  let entries: import('fs').Dirent[];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.') {
      if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full, out);
    } else if (CODE_EXT.has(extname(entry.name))) {
      out.push(full);
    }
  }
}

function extractDefs(relPath: string, lines: string[]): SymbolDef[] {
  const defs: SymbolDef[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length > 400) continue; // skip minified lines
    for (const { re, kind } of DEF_PATTERNS) {
      const m = re.exec(line);
      if (m) { defs.push({ name: m[1], kind, file: relPath, line: i + 1 }); break; }
    }
  }
  return defs;
}

/** Build or refresh the index (only re-reads changed files). Returns file count. */
export function buildIndex(): number {
  const files: string[] = [];
  walk(ROOT, files);
  const seen = new Set<string>();
  for (const abs of files) {
    let st;
    try { st = statSync(abs); } catch { continue; }
    if (st.size > MAX_FILE_BYTES) continue;
    const rel = relative(ROOT, abs).split(sep).join('/');
    seen.add(rel);
    const existing = index.get(rel);
    if (existing && existing.mtimeMs === st.mtimeMs) continue; // unchanged
    let content: string;
    try { content = readFileSync(abs, 'utf8'); } catch { continue; }
    const lines = content.split('\n');
    index.set(rel, { path: rel, mtimeMs: st.mtimeMs, defs: extractDefs(rel, lines), lines });
  }
  for (const rel of [...index.keys()]) if (!seen.has(rel)) index.delete(rel); // dropped files
  return index.size;
}

function ensureBuilt(): void { if (index.size === 0) buildIndex(); }

/** All definitions of a symbol (exact name match). */
export function codeDef(name: string): SymbolDef[] {
  ensureBuilt();
  const out: SymbolDef[] = [];
  for (const f of index.values()) for (const d of f.defs) if (d.name === name) out.push(d);
  return out;
}

/** Lines that reference a symbol (word-boundary match), excluding pure defs. */
export function codeRefs(name: string, limit = 40): Array<{ file: string; line: number; text: string }> {
  ensureBuilt();
  const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
  const out: Array<{ file: string; line: number; text: string }> = [];
  for (const f of index.values()) {
    for (let i = 0; i < f.lines.length; i++) {
      if (re.test(f.lines[i])) { out.push({ file: f.path, line: i + 1, text: f.lines[i].trim().slice(0, 200) }); if (out.length >= limit) return out; }
    }
  }
  return out;
}

/**
 * Ranked search over symbol names, file paths, and content. Not embeddings —
 * a transparent term-frequency score favoring symbol-name and path hits, which
 * for code beats naive grep and needs no model. Returns top-N snippets.
 */
export function codeSearch(query: string, limit = 12): Array<{ file: string; line: number; text: string; score: number; kind?: string }> {
  ensureBuilt();
  const terms = query.toLowerCase().split(/[^a-z0-9_]+/).filter(t => t.length > 1);
  if (terms.length === 0) return [];
  const hits: Array<{ file: string; line: number; text: string; score: number; kind?: string }> = [];

  for (const f of index.values()) {
    const pathLc = f.path.toLowerCase();
    const pathBonus = terms.reduce((s, t) => s + (pathLc.includes(t) ? 2 : 0), 0);
    // Symbol-name matches are the strongest signal.
    for (const d of f.defs) {
      const nameLc = d.name.toLowerCase();
      let score = 0;
      for (const t of terms) {
        if (nameLc === t) score += 12;
        else if (nameLc.includes(t)) score += 6;
      }
      if (score > 0) hits.push({ file: d.file, line: d.line, text: `${d.kind} ${d.name}`, score: score + pathBonus, kind: d.kind });
    }
    // Content lines: term frequency, capped so one file can't dominate.
    let contentHits = 0;
    for (let i = 0; i < f.lines.length && contentHits < 3; i++) {
      const lineLc = f.lines[i].toLowerCase();
      let score = 0;
      for (const t of terms) if (lineLc.includes(t)) score += 1;
      if (score >= Math.min(2, terms.length)) {
        hits.push({ file: f.path, line: i + 1, text: f.lines[i].trim().slice(0, 200), score: score + pathBonus });
        contentHits++;
      }
    }
  }
  hits.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));
  // Dedupe by file:line, keep highest score.
  const seen = new Set<string>();
  const out: typeof hits = [];
  for (const h of hits) {
    const key = `${h.file}:${h.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(h);
    if (out.length >= limit) break;
  }
  return out;
}

/** Compact retrieval block for injection into the model's context on a big repo. */
export function retrieveCodeContext(query: string, limit = 8): string {
  const hits = codeSearch(query, limit);
  if (hits.length === 0) return '';
  return hits.map(h => `• ${h.file}:${h.line}${h.kind ? ` (${h.kind})` : ''} — ${h.text}`).join('\n');
}
