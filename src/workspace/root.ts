import { existsSync, statSync } from 'fs';
import { dirname, resolve } from 'path';

const PROJECT_MARKERS = ['.git', 'package.json', 'Cargo.toml', 'go.mod', 'pyproject.toml', 'Gemfile', 'Makefile'];

export interface WorkspaceResolution { root?: string; mode: 'project' | 'general'; }

export function resolveWorkspace(start = process.cwd()): WorkspaceResolution {
  let current = resolve(start);
  try { if (!statSync(current).isDirectory()) current = dirname(current); }
  catch { return { mode: 'general' }; }
  while (true) {
    if (PROJECT_MARKERS.some(marker => existsSync(resolve(current, marker)))) return { root: current, mode: 'project' };
    const parent = dirname(current);
    if (parent === current) return { mode: 'general' };
    current = parent;
  }
}
