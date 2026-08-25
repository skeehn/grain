import { existsSync, readFileSync } from 'fs';
import { extname, join } from 'path';

export type ProjectKind = 'rust' | 'go' | 'python' | 'typescript' | 'javascript' | 'generic';

export interface ProjectCommand { label: string; command: string }

export interface ProjectInspection {
  kinds: ProjectKind[];
  markers: string[];
  verify: ProjectCommand | null;
  test: ProjectCommand | null;
}

const EXT_KIND: Record<string, ProjectKind> = {
  '.rs': 'rust',
  '.go': 'go',
  '.py': 'python',
  '.pyi': 'python',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
};

function readText(path: string): string {
  try { return readFileSync(path, 'utf8'); } catch { return ''; }
}

function makefileTargets(cwd: string): string[] {
  for (const name of ['Makefile', 'makefile', 'GNUmakefile']) {
    const body = readText(join(cwd, name));
    if (!body) continue;
    return [...body.matchAll(/^([A-Za-z0-9][A-Za-z0-9_-]*):/gm)].map(match => match[1]);
  }
  return [];
}

function justTargets(cwd: string): string[] {
  const body = readText(join(cwd, 'justfile'));
  if (!body) return [];
  return [...body.matchAll(/^([A-Za-z0-9][A-Za-z0-9_-]*)(?:\s+[^:\n]*)?:(?!=)/gm)].map(match => match[1]);
}

function jsRunner(cwd: string): { run: string; exec: string; bun: boolean } {
  if (existsSync(join(cwd, 'bun.lock')) || existsSync(join(cwd, 'bun.lockb'))) {
    return { run: 'bun run', exec: 'bunx', bun: true };
  }
  if (existsSync(join(cwd, 'pnpm-lock.yaml'))) return { run: 'pnpm run', exec: 'pnpm dlx', bun: false };
  if (existsSync(join(cwd, 'yarn.lock'))) return { run: 'yarn', exec: 'yarn dlx', bun: false };
  return { run: 'npm run', exec: 'npx', bun: false };
}

function pythonVerify(cwd: string): ProjectCommand {
  return {
    label: 'python compileall',
    command: "python3 -m compileall -q -x '(^|/)(\\.venv|venv|env|node_modules|dist|__pycache__|\\.git)(/|$)' .",
  };
}

function pythonTest(cwd: string): ProjectCommand | null {
  const pyproject = readText(join(cwd, 'pyproject.toml'));
  const hasPytest = /pytest/i.test(pyproject)
    || existsSync(join(cwd, 'pytest.ini'))
    || existsSync(join(cwd, 'conftest.py'))
    || existsSync(join(cwd, 'tests'))
    || existsSync(join(cwd, 'test'));
  if (!hasPytest && !existsSync(join(cwd, 'pyproject.toml')) && !existsSync(join(cwd, 'setup.py'))
    && !existsSync(join(cwd, 'requirements.txt'))) return null;
  return { label: 'pytest', command: 'python3 -m pytest -q' };
}

function rustVerify(): ProjectCommand { return { label: 'cargo check', command: 'cargo check --quiet' }; }
function rustTest(): ProjectCommand { return { label: 'cargo test', command: 'cargo test --quiet' }; }
function goVerify(): ProjectCommand { return { label: 'go build', command: 'go build ./...' }; }
function goTest(): ProjectCommand { return { label: 'go test', command: 'go test ./...' }; }

function javascriptVerify(cwd: string): ProjectCommand | null {
  const pkgPath = join(cwd, 'package.json');
  if (!existsSync(pkgPath)) return null;
  const { run, exec } = jsRunner(cwd);
  let scripts: Record<string, string> = {};
  try { scripts = (JSON.parse(readText(pkgPath)).scripts ?? {}) as Record<string, string>; } catch { /* ignore */ }
  if (scripts.typecheck) return { label: `${run} typecheck`, command: `${run} typecheck` };
  if (scripts['type-check']) return { label: `${run} type-check`, command: `${run} type-check` };
  if (existsSync(join(cwd, 'tsconfig.json'))) return { label: 'tsc --noEmit', command: `${exec} tsc --noEmit` };
  if (scripts.lint) return { label: `${run} lint`, command: `${run} lint` };
  return null;
}

function javascriptTest(cwd: string): ProjectCommand | null {
  const pkgPath = join(cwd, 'package.json');
  if (!existsSync(pkgPath)) return null;
  const { bun } = jsRunner(cwd);
  let pkg: any = {};
  try { pkg = JSON.parse(readText(pkgPath)); } catch { /* ignore */ }
  const scripts = (pkg.scripts ?? {}) as Record<string, string>;
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  if (deps.vitest) return { label: 'vitest', command: bun ? 'bunx vitest run' : 'npx vitest run' };
  if (deps.jest) return { label: 'jest', command: bun ? 'bunx jest' : 'npx jest' };
  if (bun) return { label: 'bun test', command: 'bun test' };
  if (scripts.test) return { label: `${jsRunner(cwd).run} test`, command: `${jsRunner(cwd).run} test` };
  return null;
}

function genericVerify(cwd: string): ProjectCommand | null {
  const make = makefileTargets(cwd);
  for (const target of ['check', 'lint', 'typecheck', 'verify']) {
    if (make.includes(target)) return { label: `make ${target}`, command: `make ${target}` };
  }
  const just = justTargets(cwd);
  for (const target of ['check', 'lint', 'typecheck', 'verify']) {
    if (just.includes(target)) return { label: `just ${target}`, command: `just ${target}` };
  }
  return null;
}

function genericTest(cwd: string): ProjectCommand | null {
  const make = makefileTargets(cwd);
  if (make.includes('test')) return { label: 'make test', command: 'make test' };
  const just = justTargets(cwd);
  if (just.includes('test')) return { label: 'just test', command: 'just test' };
  return null;
}

export function kindsFromPaths(paths: string[]): ProjectKind[] {
  const kinds = new Set<ProjectKind>();
  for (const path of paths) {
    const kind = EXT_KIND[extname(path).toLowerCase()];
    if (kind) kinds.add(kind);
  }
  return [...kinds];
}

function verifyForKind(cwd: string, kind: ProjectKind): ProjectCommand | null {
  if (kind === 'rust' && existsSync(join(cwd, 'Cargo.toml'))) return rustVerify();
  if (kind === 'go' && existsSync(join(cwd, 'go.mod'))) return goVerify();
  if (kind === 'python') return pythonVerify(cwd);
  if (kind === 'typescript' || kind === 'javascript') return javascriptVerify(cwd);
  return genericVerify(cwd);
}

function testForKind(cwd: string, kind: ProjectKind): ProjectCommand | null {
  if (kind === 'rust' && existsSync(join(cwd, 'Cargo.toml'))) return rustTest();
  if (kind === 'go' && existsSync(join(cwd, 'go.mod'))) return goTest();
  if (kind === 'python') return pythonTest(cwd);
  if (kind === 'typescript' || kind === 'javascript') return javascriptTest(cwd);
  return genericTest(cwd);
}

function rootKinds(cwd: string, markers: string[]): ProjectKind[] {
  const kinds: ProjectKind[] = [];
  if (markers.includes('Cargo.toml')) kinds.push('rust');
  if (markers.includes('go.mod')) kinds.push('go');
  if (markers.some(name => ['pyproject.toml', 'setup.py', 'setup.cfg', 'requirements.txt', 'Pipfile'].includes(name))) kinds.push('python');
  if (markers.includes('tsconfig.json')) kinds.push('typescript');
  else if (markers.includes('package.json')) kinds.push('javascript');
  if (!kinds.length) kinds.push('generic');
  return kinds;
}

/** Inspect the working tree. `changedPaths` steers polyglot repos toward the language that actually moved. */
export function inspectProject(cwd: string, changedPaths: string[] = []): ProjectInspection {
  const markers = [
    'Cargo.toml', 'go.mod', 'pyproject.toml', 'setup.py', 'setup.cfg', 'requirements.txt', 'Pipfile',
    'package.json', 'tsconfig.json', 'bun.lock', 'Makefile', 'justfile', 'CMakeLists.txt',
  ].filter(name => existsSync(join(cwd, name)));
  const fromFiles = kindsFromPaths(changedPaths);
  const kinds = fromFiles.length === 1 ? fromFiles : rootKinds(cwd, markers);
  const primary = kinds[0] || 'generic';
  return {
    kinds,
    markers,
    verify: verifyForKind(cwd, primary) || genericVerify(cwd) || (kinds.length > 1 ? verifyForKind(cwd, kinds[1]) : null),
    test: testForKind(cwd, primary) || genericTest(cwd),
  };
}

export function describeToolchain(inspection: ProjectInspection): string {
  const parts = [`languages: ${inspection.kinds.join(', ')}`];
  if (inspection.verify) parts.push(`check: ${inspection.verify.command}`);
  if (inspection.test) parts.push(`tests: ${inspection.test.command}`);
  if (inspection.markers.length) parts.push(`markers: ${inspection.markers.join(', ')}`);
  return parts.join('\n');
}
