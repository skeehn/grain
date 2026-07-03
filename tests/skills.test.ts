import { describe, test, expect, beforeEach } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SkillManager } from '../src/skills/manager.js';

let dir: string;
let mgr: SkillManager;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'grain-skills-'));
  mgr = new SkillManager(dir);
});

describe('markdown skills', () => {
  test('loads .md skills with YAML frontmatter', async () => {
    writeFileSync(
      join(dir, 'deploy.md'),
      '---\ndescription: How to deploy the app\ntags: [deploy, ci]\n---\nRun the deploy script.\n'
    );
    const skills = await mgr.listMarkdownSkills();
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('deploy');
    expect(skills[0].description).toBe('How to deploy the app');
    expect(skills[0].tags).toEqual(['deploy', 'ci']);
    expect(skills[0].content).toBe('Run the deploy script.');
  });

  test('create/get/delete markdown skill round-trip', async () => {
    await mgr.createMarkdownSkill('testing', 'How we test', 'Use bun test.', ['bun']);
    const skill = await mgr.getMarkdownSkill('testing');
    expect(skill?.content).toContain('bun test');
    expect(await mgr.deleteMarkdownSkill('testing')).toBe(true);
    expect(await mgr.getMarkdownSkill('testing')).toBeUndefined();
  });

  test('skips malformed files without throwing', async () => {
    writeFileSync(join(dir, 'bad.json'), '{not valid');
    writeFileSync(join(dir, 'ok.md'), 'no frontmatter, just content');
    const skills = await mgr.listMarkdownSkills();
    expect(skills).toHaveLength(1);
  });

  test('getMarkdownContext returns relevant skill content for a prompt', async () => {
    await mgr.createMarkdownSkill('rust-tips', 'Rust build tips', 'Use cargo build --release.', ['rust']);
    await mgr.createMarkdownSkill('css-tips', 'CSS layout tips', 'Use flexbox.', ['css']);
    const ctx = await mgr.getMarkdownContext('help me with rust compilation');
    expect(ctx).toContain('cargo build');
  });
});

describe('json skills', () => {
  test('createSkill persists and matchSkills finds it by keyword', async () => {
    await mgr.createSkill({
      name: 'fix-lint',
      description: 'Fix lint errors',
      pattern: { keywords: ['lint', 'eslint'] },
      approach: 'Run the linter and fix reported issues.',
      example: { problem: 'lint fails', execution: 'ran eslint --fix', outcome: 'clean' },
    });
    const all = await mgr.getAllJsonSkills();
    expect(all).toHaveLength(1);

    const matches = await mgr.matchSkills('please fix the lint errors in this repo');
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].skill.name).toBe('fix-lint');
  });

  test('recordExecution updates usage metadata', async () => {
    const skill = await mgr.createSkill({
      name: 's',
      description: 'd',
      pattern: { keywords: ['x'] },
      approach: 'a',
      example: { problem: 'p', execution: 'e', outcome: 'o' },
    });
    await mgr.recordExecution(skill.id, true);
    const updated = await mgr.getSkill(skill.id);
    expect(updated?.metadata.times_used).toBeGreaterThanOrEqual(1);
  });
});
