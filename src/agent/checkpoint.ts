// Per-task edit checkpoint: snapshot a file's prior content the first time the
// agent touches it, so a whole task's edits can be reverted with /undo. Content
// snapshots (not git) keep it precise (only files the agent changed) and working
// in non-git dirs. One changeset per task; a new task starts a fresh one.
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, lstatSync, realpathSync } from 'fs';
import { dirname, basename, join, resolve } from 'path';

interface Snapshot { path: string; target: string; existed: boolean; content: string | Buffer }

let changeset = new Map<string, Snapshot>();

/** Begin a fresh changeset (call at the start of each task). */
export function newChangeset(): void { changeset = new Map(); }

/** Record a file's pre-edit state the first time it's touched this task. */
export function snapshotBeforeEdit(absPath: string): void {
  if (changeset.has(absPath)) return; // keep the ORIGINAL pre-task state
  const target = canonicalPath(absPath);
  assertNoSymlink(target);
  const existed = existsSync(absPath);
  changeset.set(absPath, { path: absPath, target, existed, content: existed ? readFileSync(absPath) : '' });
}

/** Store a pre-run snapshot collected before a subscription CLI edited it. */
export function snapshotExternalEdit(path: string, existed: boolean, content: Buffer): void {
  if (!changeset.has(path)) changeset.set(path, { path, target: canonicalPath(path), existed, content });
}

// Resolve platform aliases (e.g. macOS /var) at capture time, not at undo time.
function canonicalPath(path: string): string {
  const parent = dirname(resolve(path));
  return join(existsSync(parent) ? realpathSync(parent) : canonicalPath(parent), basename(path));
}

function assertNoSymlink(path: string): void {
  for (let current = path; dirname(current) !== current; current = dirname(current)) {
    try { if (lstatSync(current).isSymbolicLink()) throw new Error(`Refusing undo through symlink: ${current}`); }
    catch (error: any) { if (error.code !== 'ENOENT') throw error; }
  }
}

export function changedFileCount(): number { return changeset.size; }
export function changedFiles(): string[] { return [...changeset.keys()]; }

/** Revert every file in the current changeset to its pre-task state. */
export function undoLast(): { restored: string[]; deleted: string[]; skipped: string[] } {
  const restored: string[] = [];
  const deleted: string[] = [];
  const skipped: string[] = [];
  for (const snap of changeset.values()) {
    try {
      assertNoSymlink(snap.target);
      if (snap.existed) {
        mkdirSync(dirname(snap.target), { recursive: true }); writeFileSync(snap.target, snap.content); restored.push(snap.path);
      } else if (existsSync(snap.target)) { rmSync(snap.target); deleted.push(snap.path); }
      changeset.delete(snap.path);
    } catch (error: any) { skipped.push(`${snap.path}: ${error.message}`); }
  }
  return { restored, deleted, skipped };
}
