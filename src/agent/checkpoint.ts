// Per-task edit checkpoint: snapshot a file's prior content the first time the
// agent touches it, so a whole task's edits can be reverted with /undo. Content
// snapshots (not git) keep it precise (only files the agent changed) and working
// in non-git dirs. One changeset per task; a new task starts a fresh one.
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { dirname } from 'path';

interface Snapshot { path: string; existed: boolean; content: string }

let changeset = new Map<string, Snapshot>();

/** Begin a fresh changeset (call at the start of each task). */
export function newChangeset(): void { changeset = new Map(); }

/** Record a file's pre-edit state the first time it's touched this task. */
export function snapshotBeforeEdit(absPath: string): void {
  if (changeset.has(absPath)) return; // keep the ORIGINAL pre-task state
  const existed = existsSync(absPath);
  changeset.set(absPath, { path: absPath, existed, content: existed ? safeRead(absPath) : '' });
}

function safeRead(p: string): string { try { return readFileSync(p, 'utf8'); } catch { return ''; } }

export function changedFileCount(): number { return changeset.size; }
export function changedFiles(): string[] { return [...changeset.keys()]; }

/** Revert every file in the current changeset to its pre-task state. */
export function undoLast(): { restored: string[]; deleted: string[] } {
  const restored: string[] = [];
  const deleted: string[] = [];
  for (const snap of changeset.values()) {
    if (snap.existed) {
      try { mkdirSync(dirname(snap.path), { recursive: true }); writeFileSync(snap.path, snap.content); restored.push(snap.path); } catch { /* skip */ }
    } else if (existsSync(snap.path)) {
      try { rmSync(snap.path); deleted.push(snap.path); } catch { /* skip */ }
    }
  }
  changeset = new Map();
  return { restored, deleted };
}
