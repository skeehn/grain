import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

export interface VerifyCommand { label: string; command: string }

/** Detect which JS package manager runs the project, by lockfile. */
function jsRunner(cwd: string): { run: string; exec: string } {
  if (existsSync(join(cwd, 'bun.lock')) || existsSync(join(cwd, 'bun.lockb'))) return { run: 'bun run', exec: 'bunx' };
  if (existsSync(join(cwd, 'pnpm-lock.yaml'))) return { run: 'pnpm run', exec: 'pnpm dlx' };
  if (existsSync(join(cwd, 'yarn.lock'))) return { run: 'yarn', exec: 'yarn dlx' };
  return { run: 'npm run', exec: 'npx' };
}

/**
 * Pick a FAST, high-signal correctness check for the project (compile/typecheck,
 * not the full test suite) to run after the agent edits code. Returns null when
 * nothing reliable is detectable — auto-verify then stays out of the way.
 * Ordered so the most specific project type wins.
 */
export function detectVerifyCommand(cwd: string): VerifyCommand | null {
  if (existsSync(join(cwd, 'Cargo.toml'))) return { label: 'cargo check', command: 'cargo check --quiet' };
  if (existsSync(join(cwd, 'go.mod'))) return { label: 'go build', command: 'go build ./...' };

  const pkgPath = join(cwd, 'package.json');
  if (existsSync(pkgPath)) {
    const { run, exec } = jsRunner(cwd);
    let scripts: Record<string, string> = {};
    try { scripts = (JSON.parse(readFileSync(pkgPath, 'utf8')).scripts ?? {}) as Record<string, string>; } catch { /* ignore */ }
    if (scripts.typecheck) return { label: `${run} typecheck`, command: `${run} typecheck` };
    if (scripts['type-check']) return { label: `${run} type-check`, command: `${run} type-check` };
    if (existsSync(join(cwd, 'tsconfig.json'))) return { label: 'tsc --noEmit', command: `${exec} tsc --noEmit` };
    if (scripts.lint) return { label: `${run} lint`, command: `${run} lint` };
  }
  return null;
}
