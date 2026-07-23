// Observe what a turn changed on disk, for agents whose edits Grain does not
// broker itself.
//
// Grain normally learns the changed-file set from its own write/patch tools. A
// delegated coding-agent CLI edits the tree directly, so without this the whole
// downstream chain — automatic verification, /diff, /undo, and the durable work
// record — believes nothing happened.
import { execFileSync } from 'child_process';

/** `git status --porcelain` paths, or null when this is not a usable git tree. */
export function gitTreeState(root: string): Map<string, string> | null {
  try {
    const output = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 8_000_000,
    });
    const state = new Map<string, string>();
    for (const line of output.split('\n')) {
      if (line.length < 4) continue;
      // Rename entries read `R  old -> new`; the new path is what changed.
      const path = line.slice(3).split(' -> ').pop()!.trim().replace(/^"|"$/gu, '');
      if (path) state.set(path, line.slice(0, 2));
    }
    return state;
  } catch { return null; }
}

/**
 * Paths whose status changed between two snapshots.
 *
 * Compares status codes, not just presence, so a file that was already dirty
 * and got edited again is still reported.
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
  return () => diffTreeState(before, gitTreeState(root));
}
