import { describe, test, expect, beforeEach } from 'bun:test';
import { mkdtempSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SkillManager } from '../src/skills/manager.js';

let dir: string;
let mgr: SkillManager;

const validSkill = {
  id: 'valid-1',
  name: 'fix-lint',
  description: 'Fix lint errors',
  pattern: { keywords: ['lint', 'eslint'] },
  approach: 'Run the linter.',
  examples: [],
  metadata: {
    times_used: 0,
    success_rate: 1.0,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    tags: ['lint'],
  },
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'grain-skills-malformed-'));
  mgr = new SkillManager(dir);
});

describe('SkillManager — malformed JSON skill resilience', () => {
  test('skips non-conforming skill files at load time', async () => {
    writeFileSync(join(dir, 'valid.json'), JSON.stringify(validSkill));
    writeFileSync(join(dir, 'no-id.json'), JSON.stringify({ pattern: {}, metadata: {} }));
    writeFileSync(join(dir, 'no-pattern.json'), JSON.stringify({ id: 'x1', metadata: {} }));
    writeFileSync(join(dir, 'no-metadata.json'), JSON.stringify({ id: 'x2', pattern: {} }));
    writeFileSync(join(dir, 'not-object.json'), JSON.stringify('just a string'));
    writeFileSync(join(dir, 'null.json'), 'null');
    writeFileSync(join(dir, 'broken.json'), '{not valid json');

    const all = await mgr.getAllJsonSkills();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe('valid-1');
  });

  test('matchSkills still resolves and matches valid skills alongside bad files', async () => {
    writeFileSync(join(dir, 'valid.json'), JSON.stringify(validSkill));
    writeFileSync(join(dir, 'missing-fields.json'), JSON.stringify({ name: 'nope' }));

    const matches = await mgr.matchSkills('please fix the lint errors');
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].skill.id).toBe('valid-1');
  });

  test('one skill with malformed pattern fields cannot reject the whole promise', async () => {
    writeFileSync(join(dir, 'valid.json'), JSON.stringify(validSkill));
    // Passes the load-time shape check (id/pattern/metadata present) but has
    // garbage inside pattern — per-skill guards in matchSkills must hold.
    writeFileSync(
      join(dir, 'garbage-pattern.json'),
      JSON.stringify({
        id: 'garbage-1',
        name: 'bad',
        description: 'bad',
        pattern: { keywords: 'not-an-array', regex: 42, semantic: { nested: true } },
        approach: 'x',
        examples: [],
        metadata: { times_used: 0, success_rate: 1, created_at: 'x', updated_at: 'x', tags: 'not-an-array' },
      })
    );

    const matches = await mgr.matchSkills('please fix the lint errors');
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].skill.id).toBe('valid-1');
  });

  test('a matching skill with non-array keywords/tags does not crash matchSkills', async () => {
    // This skill DOES match (valid keywords used for matching would come from
    // a valid array) — but we give it garbage keywords/tags that still pass
    // load validation, then confirm the CWD-bonus loop tolerates it.
    writeFileSync(
      join(dir, 'matcher.json'),
      JSON.stringify({
        id: 'matcher-1',
        name: 'lint-fixer',
        description: 'fix lint errors',
        pattern: { semantic: 'fix the lint errors in this repo' },
        approach: 'run linter',
        examples: [],
        metadata: { times_used: 0, success_rate: 1, created_at: 'x', updated_at: 'x' },
      })
    );
    // Now corrupt keywords/tags post-hoc to non-arrays and re-load.
    const raw = JSON.parse(readFileSync(join(dir, 'matcher.json'), 'utf-8'));
    raw.pattern.keywords = 'lint';
    raw.metadata.tags = 'typescript';
    writeFileSync(join(dir, 'matcher.json'), JSON.stringify(raw));

    const fresh = new SkillManager(dir);
    const matches = await fresh.matchSkills('fix the lint errors in this repo');
    expect(matches.some(m => m.skill.id === 'matcher-1')).toBe(true);
  });

  test('markdown frontmatter without trailing newline after closing --- parses', async () => {
    writeFileSync(join(dir, 'edge.md'), '---\ndescription: Edge case\ntags: [edge]\n---');
    const skills = await mgr.listMarkdownSkills();
    const edge = skills.find(s => s.name === 'edge');
    expect(edge).toBeDefined();
    expect(edge?.description).toBe('Edge case');
    expect(edge?.tags).toEqual(['edge']);
    expect(edge?.content).toBe('');
  });
});
