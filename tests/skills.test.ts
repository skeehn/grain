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
    expect(skills[0].content).toBe(''); // index stays metadata-only until selected
    expect((await mgr.getMarkdownSkill('deploy'))?.content).toBe('Run the deploy script.');
  });

  test('create/get/delete markdown skill round-trip', async () => {
    await mgr.createMarkdownSkill('testing', 'How we test', 'Use bun test.', ['bun']);
    const skill = await mgr.getMarkdownSkill('testing');
    expect(skill?.content).toContain('bun test');
    expect(await mgr.deleteMarkdownSkill('testing')).toBe(true);
    expect(await mgr.getMarkdownSkill('testing')).toBeUndefined();
  });

  test('discovers portable nested SKILL.md packages', async () => {
    const { mkdirSync } = await import('fs'); mkdirSync(join(dir, 'release'), { recursive: true });
    writeFileSync(join(dir, 'release', 'SKILL.md'), '---\nname: release\ndescription: Safe releases\ntags: [release]\n---\nVerify before publishing.\n');
    const skills = await mgr.listMarkdownSkills(); expect(skills.map(skill => skill.name)).toContain('release');
    expect((await mgr.getMarkdownSkill('release'))?.content).toContain('Verify before publishing');
  });

  test('rejects non-conforming portable packages and reports actionable validation', async () => {
    const { mkdirSync } = await import('fs'); mkdirSync(join(dir, 'wrong-folder'), { recursive: true });
    writeFileSync(join(dir, 'wrong-folder', 'SKILL.md'), '---\nname: Wrong_Name\ndescription: Bad package\n---\nDo not load.\n');
    expect((await mgr.listMarkdownSkills()).map(skill => skill.name)).not.toContain('Wrong_Name');
    const result = (await mgr.validatePortableSkills()).find(item => item.name === 'Wrong_Name');
    expect(result?.valid).toBe(false);
    expect(result?.errors.join(' ')).toContain('lowercase');
    expect(result?.errors.join(' ')).toContain('parent directory');
  });

  test('portable validation enforces required description and accepts a conforming package', async () => {
    const { mkdirSync } = await import('fs');
    mkdirSync(join(dir, 'valid-skill'), { recursive: true });
    mkdirSync(join(dir, 'missing-description'), { recursive: true });
    writeFileSync(join(dir, 'valid-skill', 'SKILL.md'), '---\nname: valid-skill\ndescription: Use when validating portable skills.\n---\nValidate it.\n');
    writeFileSync(join(dir, 'missing-description', 'SKILL.md'), '---\nname: missing-description\n---\nNo description.\n');
    const results = await mgr.validatePortableSkills();
    expect(results.find(item => item.name === 'valid-skill')?.valid).toBe(true);
    expect(results.find(item => item.name === 'missing-description')?.errors).toContain('description is required');
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
