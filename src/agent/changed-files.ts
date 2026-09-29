// Observe what a turn changed on disk, for agents whose edits Grain does not
// broker itself.
//
// Grain normally learns the changed-file set from its own write/patch tools. A
// delegated coding-agent CLI edits the tree directly, so without this the whole
// downstream chain — automatic verification, /diff, /undo, and the durable work
// record — believes nothing happened.
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { lstatSync, readFileSync } from 'fs';
import { resolve, sep, relative } from 'path';
import { snapshotExternalEdit } from './checkpoint.js';

function hashFile(path: string): string {
  try { return lstatSync(path).isFile() ? createHash('sha256').update(readFileSync(path)).digest('hex') : 'not-file'; }
  catch { return 'missing'; }
}

/** `git status --porcelain` paths, or null when this is not a usable git tree. */
export function gitTreeState(root: string): Map<string, string> | null {
  try {
    const output = execFileSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 8_000_000,
    });
    const state = new Map<string, string>();
    const records = output.split('\0');
    for (let index = 0; index < records.length; index++) {
      const line = records[index];
      if (line.length < 4) continue;
      const path = line.slice(3); const code = line.slice(0, 2);
      if (path) state.set(path, `${code}:${hashFile(resolve(root, path))}`);
      // With -z a rename is destination NUL source. Both paths need undo.
      if (/[RC]/u.test(code)) {
        const source = records[++index];
        if (source && /R/u.test(code)) state.set(source, ` D:${hashFile(resolve(root, source))}`);
      }
    }
    return state;
  } catch { return null; }
}

/**
 * Paths whose status changed between two snapshots.
 *
 * State includes content hashes: an already-dirty file can change without
 * its porcelain status changing.
 */
export function diffTreeState(before: Map<string, string> | null, after: Map<string, string> | null): string[] {
  if (!before || !after) return [];
  const changed = new Set<string>();
  for (const [path, code] of after) if (before.get(path) !== code) changed.add(path);
  for (const path of before.keys()) if (!after.has(path)) changed.add(path);
  return [...changed].sort();
}

/** Snapshot helper: returns a function that reports what changed since the call. */
export function watchTree(root: string): () => string[] {
  const before = gitTreeState(root);
  if (!before) return () => [];
  const dirty = new Map<string, Buffer>();
  for (const path of before.keys()) {
    try { if (lstatSync(resolve(root, path)).isFile()) dirty.set(path, readFileSync(resolve(root, path))); } catch { /* previously deleted */ }
  }
  const tracked = new Map<string, string>();
  const unsupported = new Set<string>();
  try {
    const output = execFileSync('git', ['ls-files', '--stage', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 8_000_000 });
    for (const record of output.split('\0')) {
      const match = /^(\d+) ([0-9a-f]+) (\d)\t([\s\S]+)$/u.exec(record);
      if (!match) continue;
      if (match[1].startsWith('100') && match[3] === '0') tracked.set(match[4], match[2]);
      else unsupported.add(match[4]);
    }
  } catch { return () => diffTreeState(before, gitTreeState(root)); }
  return () => {
    const changed = diffTreeState(before, gitTreeState(root));
    for (const path of changed) {
      const absolute = resolve(root, path);
      if (!absolute.startsWith(resolve(root) + sep)) continue;
      // Never restore through a symlink introduced by the child agent.
      let unsafe = false; let current = resolve(root);
      for (const part of relative(root, absolute).split(sep)) {
        current = resolve(current, part);
        try { if (lstatSync(current).isSymbolicLink()) unsafe = true; } catch { /* missing file/parent can be restored */ }
      }
      if (unsafe || unsupported.has(path) || before.get(path)?.endsWith('not-file')) continue;
      if (dirty.has(path)) { snapshotExternalEdit(absolute, true, dirty.get(path)!); continue; }
      // A file deleted by the user before this task must stay deleted on undo.
      if (before.get(path)?.endsWith('missing')) { snapshotExternalEdit(absolute, false, Buffer.alloc(0)); continue; }
      const blob = tracked.get(path);
      if (blob) {
        try {
          const content = execFileSync('git', ['cat-file', 'blob', blob], { cwd: root, maxBuffer: 16_000_000 });
          snapshotExternalEdit(absolute, true, content);
        } catch { /* if the snapshot is unavailable, never mark an existing file as new */ }
      } else if (!before.has(path)) snapshotExternalEdit(absolute, false, Buffer.alloc(0));
    }
    return changed;
  };
}
