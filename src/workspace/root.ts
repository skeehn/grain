import { existsSync, statSync } from 'fs';
import { homedir } from 'os';
import { dirname, resolve } from 'path';

const PROJECT_MARKERS = ['.git', 'package.json', 'Cargo.toml', 'go.mod', 'pyproject.toml', 'Gemfile', 'Makefile'];

export interface WorkspaceResolution { root?: string; mode: 'project' | 'general'; }

/** Launch/open folder plus optional git/package root. `cd` is never required to read a named file. */
export interface WorkspaceState { cwd: string; projectRoot?: string; }

export function openWorkspace(start = process.cwd(), options?: { home?: string }): WorkspaceState {
  let cwd = resolve(start);
  try { if (!statSync(cwd).isDirectory()) cwd = dirname(cwd); }
  catch { /* keep resolved start */ }
  const found = resolveWorkspace(cwd, options);
  return { cwd, projectRoot: found.root };
}

/**
 * Walk up from `start` looking for a project marker.
 *
 * The home directory is never a Grain project unless it is itself a Git
 * repository. A loose `pyproject.toml` / `Makefile` in `$HOME` (common in
 * lab workspaces) used to claim the entire home tree, after which the agent
 * synchronously indexed tens of thousands of files and froze the TUI.
 */
export function resolveWorkspace(start = process.cwd(), options?: { home?: string }): WorkspaceResolution {
  const home = resolve(options?.home ?? homedir());
  let current = resolve(start);
  try { if (!statSync(current).isDirectory()) current = dirname(current); }
  catch { return { mode: 'general' }; }
  while (true) {
    const atHome = current === home;
    if (PROJECT_MARKERS.some(marker => existsSync(resolve(current, marker)))) {
      if (atHome && !existsSync(resolve(current, '.git'))) return { mode: 'general' };
      return { root: current, mode: 'project' };
    }
    if (atHome) return { mode: 'general' };
    const parent = dirname(current);
    if (parent === current) return { mode: 'general' };
    current = parent;
  }
}
