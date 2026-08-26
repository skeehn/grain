import {
  chmodSync, closeSync, copyFileSync, existsSync, fsyncSync, lstatSync, mkdirSync,
  openSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync,
} from 'fs';
import { createHash, randomUUID } from 'crypto';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'path';
import { homedir } from 'os';
import type { FileSnapshot, ReadRangeResult, SearchMatch, WorkspaceFS } from './types.js';

const BUILTIN_IGNORES = new Set(['.git', 'node_modules', 'dist', 'build', 'target', '.next', 'coverage', '__pycache__', '.venv']);
const MAX_TEXT_BYTES = 10 * 1024 * 1024;
const digest = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
const grainHome = () => process.env.GRAIN_HOME || join(homedir(), '.grain');

function binary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  if (sample.includes(0)) return true;
  let controls = 0;
  for (const byte of sample) if (byte < 7 || (byte > 13 && byte < 32)) controls++;
  return sample.length > 0 && controls / sample.length > 0.1;
}

export function expandUserPath(path: string, home = homedir()): string {
  if (path === '~') return home;
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(home, path.slice(2));
  return path;
}

function isInside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

export class LocalWorkspaceFS implements WorkspaceFS {
  readonly root: string;
  private readonly home: string;
  private readonly ignores: string[];

  constructor(root = process.cwd(), options?: { home?: string }) {
    if (!existsSync(root)) throw new Error(`Workspace root does not exist: ${root}`);
    this.root = realpathSync(root);
    const home = resolve(options?.home ?? homedir());
    this.home = existsSync(home) ? realpathSync(home) : home;
    this.ignores = this.loadIgnores();
  }

  private loadIgnores(): string[] {
    const result: string[] = [];
    for (const name of ['.gitignore', '.grainignore']) {
      const file = join(this.root, name);
      if (existsSync(file)) result.push(...readFileSync(file, 'utf8').split('\n')
        .map(line => line.trim()).filter(line => line && !line.startsWith('#') && !line.startsWith('!')));
    }
    return result;
  }

  private assertInside(path: string): void {
    if (!isInside(this.root, path)) throw new Error(`Path escapes workspace: ${path}`);
  }

  private assertAllowed(path: string, access: 'read' | 'write'): void {
    if (isInside(this.root, path)) return;
    if (access === 'read' && isInside(this.home, path)) return;
    throw new Error(`Path escapes workspace: ${path}`);
  }

  resolve(path: string, mustExist = false, access: 'read' | 'write' = 'write'): string {
    const expanded = expandUserPath(path, this.home);
    const requested = isAbsolute(expanded) ? resolve(expanded) : resolve(this.root, expanded);
    if (existsSync(requested)) {
      const canonical = realpathSync(requested);
      this.assertAllowed(canonical, access);
      const info = lstatSync(canonical);
      if (info.isSocket() || info.isFIFO() || info.isCharacterDevice() || info.isBlockDevice()) {
        throw new Error(`Unsupported filesystem object: ${path}`);
      }
      return canonical;
    }
    if (mustExist) throw new Error(`Path not found: ${path}`);
    let parent = dirname(requested);
    while (!existsSync(parent) && parent !== dirname(parent)) parent = dirname(parent);
    const canonicalParent = realpathSync(parent);
    this.assertAllowed(canonicalParent, access);
    const candidate = resolve(canonicalParent, relative(parent, requested));
    this.assertAllowed(candidate, access);
    return candidate;
  }

  private ignored(rel: string): boolean {
    const parts = rel.split(/[\\/]/);
    if (parts.some(part => BUILTIN_IGNORES.has(part))) return true;
    return this.ignores.some(raw => {
      const pattern = raw.replace(/^\//, '').replace(/\/$/, '');
      if (!pattern.includes('*')) return rel === pattern || rel.startsWith(`${pattern}/`) || parts.includes(pattern);
      const fragments = pattern.split('*');
      let cursor = 0;
      for (const fragment of fragments) {
        const found = rel.indexOf(fragment, cursor);
        if (found < 0) return false;
        cursor = found + fragment.length;
      }
      return true;
    });
  }

  stat(path: string): FileSnapshot {
    const full = this.resolve(path, true, 'read');
    const info = statSync(full);
    const rel = relative(this.root, full);
    if (!info.isFile()) return { path: rel, existed: true, mode: info.mode, size: info.size };
    const content = readFileSync(full);
    const isBin = binary(content);
    const text = isBin ? '' : content.toString('utf8');
    return { path: rel, existed: true, content_hash: digest(content), mode: info.mode, size: info.size,
      binary: isBin, line_ending: text.includes('\r\n') ? 'crlf' : 'lf',
      final_newline: isBin ? undefined : /\r?\n$/.test(text) };
  }

  list(path = '.', maxDepth = 8): string[] {
    const base = this.resolve(path, true, 'read');
    if (statSync(base).isFile()) return [isInside(this.root, base) ? relative(this.root, base) : base];
    const atHomeRoot = resolve(base) === this.home;
    const homeWorkspace = this.root === this.home;
    const depthCap = atHomeRoot ? Math.min(maxDepth, 1) : homeWorkspace ? Math.min(maxDepth, 3) : maxDepth;
    const output: string[] = [];
    const walk = (dir: string, depth: number) => {
      if (depth > depthCap || output.length >= (atHomeRoot ? 400 : 8_000)) return;
      for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (homeWorkspace && entry.name.startsWith('.')) continue;
        const full = join(dir, entry.name);
        const rel = isInside(this.root, full) ? relative(this.root, full) : full;
        if ((isInside(this.root, full) && this.ignored(rel)) || entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) walk(full, depth + 1);
        else if (entry.isFile()) output.push(rel);
      }
    };
    walk(base, 0);
    return output;
  }

  readRange(path: string, offset = 1, limit = 500): ReadRangeResult {
    const full = this.resolve(path, true, 'read');
    const content = readFileSync(full);
    if (content.length > MAX_TEXT_BYTES) throw new Error(`File exceeds ${MAX_TEXT_BYTES} byte text limit: ${path}`);
    if (binary(content)) throw new Error(`Binary file cannot be read as text: ${path}`);
    const lines = content.toString('utf8').split('\n');
    const start = Math.max(0, offset - 1);
    const selected = lines.slice(start, start + Math.max(1, limit));
    return { path: isInside(this.root, full) ? relative(this.root, full) : full, content: selected.join('\n'), start_line: start + 1,
      end_line: start + selected.length, total_lines: lines.length, hash: digest(content) };
  }

  search(pattern: string, path = '.', limit = 200): SearchMatch[] {
    const matcher = new RegExp(pattern, 'i');
    const base = this.resolve(path, true, 'read');
    const files = statSync(base).isFile() ? [isInside(this.root, base) ? relative(this.root, base) : base] : this.list(path);
    const matches: SearchMatch[] = [];
    for (const rel of files) {
      if (matches.length >= limit) break;
      const content = readFileSync(this.resolve(rel, true, 'read'));
      if (content.length > MAX_TEXT_BYTES || binary(content)) continue;
      for (const [index, line] of content.toString('utf8').split('\n').entries()) {
        matcher.lastIndex = 0;
        if (matcher.test(line)) matches.push({ path: rel, line: index + 1, text: line });
        if (matches.length >= limit) break;
      }
    }
    return matches;
  }

  snapshot(path: string): FileSnapshot {
    const full = this.resolve(path);
    if (!existsSync(full)) return { path: relative(this.root, full), existed: false };
    const result = this.stat(path);
    if (result.content_hash && statSync(full).isFile()) {
      const dir = join(grainHome(), 'objects', result.content_hash.slice(0, 2));
      mkdirSync(dir, { recursive: true });
      const object = join(dir, result.content_hash);
      if (!existsSync(object)) copyFileSync(full, object);
    }
    return result;
  }

  writeAtomic(path: string, content: string, expectedHash?: string): FileSnapshot {
    const full = this.resolve(path);
    const before = this.snapshot(path);
    if (expectedHash && before.content_hash !== expectedHash) throw new Error(`File changed since read: ${path}`);
    mkdirSync(dirname(full), { recursive: true });
    const mode = before.mode ? before.mode & 0o777 : 0o644;
    const tmp = join(dirname(full), `.${basename(full)}.grain-${randomUUID()}.tmp`);
    const fd = openSync(tmp, 'wx', mode);
    try { writeFileSync(fd, content, 'utf8'); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(tmp, full);
    chmodSync(full, mode);
    return this.stat(path);
  }

  applyPatch(path: string, oldText: string, newText: string, expectedHash?: string): FileSnapshot {
    const read = this.readRange(path, 1, Number.MAX_SAFE_INTEGER);
    if (expectedHash && read.hash !== expectedHash) throw new Error(`File changed since read: ${path}`);
    const count = read.content.split(oldText).length - 1;
    if (count !== 1) throw new Error(count ? `Patch text occurs ${count} times: ${path}` : `Patch text not found: ${path}`);
    return this.writeAtomic(path, read.content.replace(oldText, newText), read.hash);
  }

  restoreSnapshot(snapshot: FileSnapshot, expectedCurrentHash?: string): FileSnapshot {
    if (!snapshot.existed || !snapshot.content_hash) throw new Error(`Snapshot is not restorable as a file: ${snapshot.path}`);
    const full = this.resolve(snapshot.path); const current = this.snapshot(snapshot.path);
    if (expectedCurrentHash && current.content_hash !== expectedCurrentHash) throw new Error(`File changed before rollback: ${snapshot.path}`);
    const object = join(grainHome(), 'objects', snapshot.content_hash.slice(0, 2), snapshot.content_hash);
    if (!existsSync(object)) throw new Error(`Missing snapshot object ${snapshot.content_hash}`);
    mkdirSync(dirname(full), { recursive: true }); const tmp = join(dirname(full), `.${basename(full)}.grain-restore-${randomUUID()}.tmp`);
    copyFileSync(object, tmp); const descriptor = openSync(tmp, 'r'); try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
    renameSync(tmp, full); chmodSync(full, (snapshot.mode || 0o644) & 0o777);
    const restored = this.stat(snapshot.path); if (restored.content_hash !== snapshot.content_hash) throw new Error(`Rollback verification failed: ${snapshot.path}`);
    return restored;
  }

  move(from: string, to: string): void { renameSync(this.resolve(from, true), this.resolve(to)); }
  mkdir(path: string): void { mkdirSync(this.resolve(path), { recursive: true }); }
  remove(path: string): void { rmSync(this.resolve(path, true), { recursive: true, force: false }); }
}

let current: LocalWorkspaceFS | null = null;
export const setWorkspaceRoot = (root: string) => {
  current = new LocalWorkspaceFS(root);
  process.env.GRAIN_WORKSPACE_ROOT = current.root;
  return current;
};
export const getWorkspaceFS = () => {
  const desired = process.env.GRAIN_WORKSPACE_ROOT || process.cwd();
  if (!current || current.root !== realpathSync(desired)) current = new LocalWorkspaceFS(desired);
  return current;
};
