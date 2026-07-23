import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  WorkLog, languageTags, monthKey, parseEntries, relativizePaths, renderEntry, type WorkEntry,
} from '../src/docs/worklog.js';
import { diffTreeState } from '../src/agent/changed-files.js';
import { cleanSummary } from '../src/agent/loop.js';
import { groupBySubsystem, publicSurface, restrictToTracked } from '../src/docs/generate.js';

const roots: string[] = [];
const newRoot = () => { const root = mkdtempSync(join(tmpdir(), 'grain-work-')); roots.push(root); return root; };
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('durable work record', () => {
  test('a completed task lands in the repository as reviewable markdown', () => {
    const root = newRoot();
    const { entry, path } = new WorkLog(root).record({
      title: 'Add subtract to calc', outcome: 'succeeded', runId: 'run-1',
      provider: 'claude-code', model: 'sonnet', files: [join(root, 'calc.py')],
      verification: 'bun test passed', summary: 'Added subtract().',
    });
    expect(path).toBe(join('docs', 'grain', 'worklog', `${monthKey(entry.timestamp)}.md`));
    const written = readFileSync(join(root, path), 'utf8');
    expect(written).toContain('Add subtract to calc');
    expect(written).toContain('bun test passed');
    // Absolute paths would not survive being read on another machine.
    expect(entry.files).toEqual(['calc.py']);
    expect(entry.tags).toContain('python');
  });

  test('entries round-trip through the file, so hand edits are not lost', () => {
    const entry: WorkEntry = {
      id: 'abc123', timestamp: '2026-07-23T07:10:00.000Z', title: 'Fix the parser', kind: 'task',
      outcome: 'succeeded', runId: 'run-9', provider: 'groq', model: 'gpt-oss-120b',
      files: ['src/a.ts', 'src/b.ts'], verification: 'typecheck passed',
      summary: 'Rewrote the tokenizer.', tags: ['task', 'typescript'],
    };
    const [parsed] = parseEntries(`# Work log\n\n${renderEntry(entry)}`);
    expect(parsed.title).toBe('Fix the parser');
    expect(parsed.outcome).toBe('succeeded');
    expect(parsed.files).toEqual(['src/a.ts', 'src/b.ts']);
    expect(parsed.verification).toBe('typecheck passed');
    expect(parsed.summary).toContain('Rewrote the tokenizer.');
  });

  test('notes and tasks share one timeline, newest first', () => {
    const root = newRoot(); const log = new WorkLog(root);
    log.record({ title: 'First task', outcome: 'succeeded', files: ['a.ts'], timestamp: '2026-07-01T09:00:00.000Z' });
    log.note('Keep the parser allocation-free', ['perf'], '2026-07-02T09:00:00.000Z');
    const entries = log.entries();
    expect(entries.map(item => item.kind)).toEqual(['note', 'task']);
    expect(entries[0].tags).toContain('perf');
  });

  test('lexical search works with the memory server down', () => {
    const root = newRoot(); const log = new WorkLog(root);
    log.record({ title: 'Add retry backoff', outcome: 'succeeded', files: ['src/http.ts'] });
    log.record({ title: 'Rename widget', outcome: 'succeeded', files: ['src/ui.ts'] });
    expect(log.search('retry').map(entry => entry.title)).toEqual(['Add retry backoff']);
    expect(log.search('nothing-matches-this')).toEqual([]);
  });

  test('a note file is created per day and appended to', () => {
    const root = newRoot(); const log = new WorkLog(root);
    log.note('first', [], '2026-07-23T09:00:00.000Z');
    log.note('second', [], '2026-07-23T11:00:00.000Z');
    const path = join(root, 'docs', 'grain', 'notes', '2026-07-23.md');
    expect(existsSync(path)).toBe(true);
    const body = readFileSync(path, 'utf8');
    expect(body).toContain('first');
    expect(body).toContain('second');
    expect(body.match(/^# Notes/gmu)?.length).toBe(1); // header written once
  });

  test('paths outside the repository are kept absolute rather than mangled', () => {
    expect(relativizePaths(['/elsewhere/x.ts'], '/repo')).toEqual(['/elsewhere/x.ts']);
    expect(relativizePaths(['/repo/src/x.ts', 'src/x.ts'], '/repo')).toEqual(['src/x.ts']);
  });

  test('language tags come from the files actually touched', () => {
    expect(languageTags(['src/a.rs', 'b.py', 'c.unknown'])).toEqual(['rust', 'python']);
  });
});

describe('delegated-agent change detection', () => {
  test('reports files a child agent edited without Grain brokering the write', () => {
    const before = new Map([['src/a.ts', ' M']]);
    const after = new Map([['src/a.ts', ' M'], ['src/b.ts', '??']]);
    expect(diffTreeState(before, after)).toEqual(['src/b.ts']);
  });

  test('an already-dirty file edited again still counts as changed', () => {
    expect(diffTreeState(new Map([['a.ts', ' M']]), new Map([['a.ts', 'MM']]))).toEqual(['a.ts']);
  });

  test('a reverted file is reported too', () => {
    expect(diffTreeState(new Map([['a.ts', ' M']]), new Map())).toEqual(['a.ts']);
  });

  test('a non-git tree yields no false positives', () => {
    expect(diffTreeState(null, null)).toEqual([]);
  });
});

describe('recorded summaries', () => {
  test('live tool narration is stripped from the durable record', () => {
    expect(cleanSummary('· Edit(/tmp/x)\nAdded the function.')).toBe('Added the function.');
    expect(cleanSummary('  · Bash(npm test)\n\n\nDone.')).toBe('Done.');
    expect(cleanSummary('')).toBeUndefined();
    expect(cleanSummary('· only narration')).toBeUndefined();
  });
});

describe('generated documentation', () => {
  const entity = (id: string, file: string, name = id) =>
    ({ id, name, type: 'function' as const, file });

  test('subsystems come from the source layout, not a hand-kept list', () => {
    const groups = groupBySubsystem([
      entity('a', 'src/tui/app.ts'), entity('b', 'src/tui/frame.ts'),
      entity('c', 'src/providers/index.ts'), entity('d', 'src/cli.ts'),
    ]);
    expect([...groups.keys()].sort()).toEqual(['providers', 'root', 'tui']);
    expect(groups.get('tui')!.length).toBe(2);
  });

  test('the public surface is what other subsystems actually depend on', () => {
    const entities = [entity('own1', 'src/x/a.ts', 'used'), entity('own2', 'src/x/b.ts', 'unused')];
    const graph = {
      entities: [...entities, entity('out', 'src/y/c.ts')],
      relationships: [{ from: 'out', to: 'own1', type: 'calls' as const }],
      modules: [], entryPoints: [],
    };
    expect(publicSurface(graph, entities)[0].name).toBe('used');
  });

  test('untracked sub-projects are excluded so docs describe this repository only', () => {
    const graph = {
      entities: [entity('a', 'src/real.ts'), entity('b', 'vendored-site/app.tsx')],
      relationships: [{ from: 'a', to: 'b', type: 'imports' as const }],
      modules: [], entryPoints: [],
    };
    // No git repo at this path → nothing is filtered, rather than everything.
    const untouched = restrictToTracked(graph, '/definitely/not/a/repo');
    expect(untouched.entities.length).toBe(2);
  });
});

describe('tool policy coverage', () => {
  test('every registered tool has an explicit risk classification', async () => {
    // The classifier defaults unknown tools to `destructive`, which denies them
    // outright in non-interactive runs. That is the safe default, but it means
    // a newly added tool is silently unusable until it is classified — so
    // assert the classification is deliberate rather than the fallback.
    const { TOOLS } = await import('../src/tools/index.js');
    const { classifyTool } = await import('../src/policy/classifier.js');
    const unclassified = TOOLS
      .map(tool => tool.name)
      .filter(name => !name.startsWith('mcp__') && name !== 'bash' && name !== 'git')
      .filter(name => classifyTool(name, {}) === 'destructive');
    expect(unclassified).toEqual([]);
  });
});
