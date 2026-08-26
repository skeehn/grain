/**
 * Skills Manager
 *
 * Manages two skill formats:
 *   ~/.grain/skills/<name>/SKILL.md — portable Agent Skills, selected progressively
 *   ~/.grain/skills/*.md   — legacy human-authored context snippets
 *   ~/.grain/skills/*.json — machine-learned patterns, keyword-matched
 */

import fs from 'fs/promises';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';
import type {
  Skill,
  MarkdownSkill,
  SkillMatch,
  SkillExample,
  CreateSkillConfig,
  SkillValidationResult,
} from './types.js';

// ─── CWD language detection ────────────────────────────────────────────────────

/** Map from file extension → canonical language/framework tags */
const EXT_TAGS: Record<string, string[]> = {
  rs:    ['rust', 'cargo'],
  toml:  ['rust', 'cargo', 'toml'],
  ts:    ['typescript', 'ts', 'node'],
  tsx:   ['typescript', 'react', 'tsx'],
  jsx:   ['javascript', 'react', 'jsx'],
  js:    ['javascript', 'js', 'node'],
  py:    ['python', 'pip'],
  go:    ['go', 'golang'],
  rb:    ['ruby', 'rails'],
  java:  ['java', 'maven', 'gradle'],
  kt:    ['kotlin', 'android'],
  swift: ['swift', 'ios', 'xcode'],
  cs:    ['csharp', 'dotnet'],
  cpp:   ['cpp', 'c++'],
  c:     ['c', 'gcc'],
  vue:   ['vue', 'vite'],
  svelte:['svelte', 'vite'],
  dart:  ['dart', 'flutter'],
  ex:    ['elixir', 'phoenix'],
  exs:   ['elixir'],
  hs:    ['haskell'],
  lua:   ['lua'],
  sh:    ['shell', 'bash'],
  zsh:   ['shell', 'zsh'],
};

/** Special filenames → tags (checked case-insensitively) */
const FILE_TAGS: Record<string, string[]> = {
  'cargo.toml':      ['rust', 'cargo'],
  'package.json':    ['node', 'javascript', 'typescript', 'npm'],
  'vite.config.ts':  ['vite', 'react', 'frontend'],
  'vite.config.js':  ['vite', 'react', 'frontend'],
  'next.config.js':  ['next', 'react', 'frontend'],
  'next.config.ts':  ['next', 'react', 'frontend'],
  'tailwind.config.js': ['tailwind', 'css', 'frontend'],
  'tailwind.config.ts': ['tailwind', 'css', 'frontend'],
  'dockerfile':      ['docker', 'container'],
  'docker-compose.yml': ['docker', 'compose'],
  'go.mod':          ['go', 'golang'],
  'pyproject.toml':  ['python', 'pip'],
  'requirements.txt':['python', 'pip'],
  'gemfile':         ['ruby', 'rails'],
  'pom.xml':         ['java', 'maven'],
  'build.gradle':    ['java', 'gradle'],
};

/**
 * Reads the top-level entries of `cwd` and returns a deduplicated set
 * of language/framework tags inferred from file extensions and filenames.
 * Capped to 50 entries so it stays cheap on large directories.
 */
async function detectCwdLanguages(cwd = process.cwd()): Promise<Set<string>> {
  const tags = new Set<string>();
  let entries: string[] = [];
  try {
    entries = await fs.readdir(cwd);
  } catch {
    return tags;
  }
  for (const entry of entries.slice(0, 50)) {
    const lower = entry.toLowerCase();
    // Check special filenames first
    if (FILE_TAGS[lower]) {
      for (const t of FILE_TAGS[lower]) tags.add(t);
      continue;
    }
    // Check extension
    const ext = lower.split('.').pop() ?? '';
    if (ext && EXT_TAGS[ext]) {
      for (const t of EXT_TAGS[ext]) tags.add(t);
    }
  }
  return tags;
}

// ─── YAML frontmatter parser (no deps) ────────────────────────────────────────

function parseFrontmatter(raw: string): { meta: Record<string, any>; body: string } {
  // Trailing newline after the closing `---` is optional
  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n([\s\S]*))?$/);
  if (!fmMatch) return { meta: {}, body: raw };

  const meta: Record<string, any> = {};
  for (const line of fmMatch[1].split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon < 1) continue;
    const key = line.slice(0, colon).trim();
    let val: any = line.slice(colon + 1).trim();

    // Inline list: [a, b, c]
    const inlineArr = val.match(/^\[(.*)\]$/);
    if (inlineArr) {
      val = inlineArr[1].split(',').map((s: string) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    }
    // String val
    else {
      val = val.replace(/^["']|["']$/g, '');
    }
    meta[key] = val;
  }
  return { meta, body: fmMatch[2] ?? '' };
}

/** Validate the normative Agent Skills fields without applying legacy defaults. */
export function validatePortableSkillSource(raw: string, directoryName: string, filePath = 'SKILL.md'): SkillValidationResult {
  const { meta } = parseFrontmatter(raw); const errors: string[] = [];
  const name = typeof meta.name === 'string' ? meta.name.trim() : '';
  const description = typeof meta.description === 'string' ? meta.description.trim() : '';
  if (!raw.startsWith('---\n') && !raw.startsWith('---\r\n')) errors.push('requires YAML frontmatter');
  if (!name) errors.push('name is required');
  else {
    if (name.length > 64) errors.push('name must be at most 64 characters');
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(name)) errors.push('name must contain lowercase letters, numbers, and single hyphens only');
    if (name !== directoryName) errors.push(`name must match parent directory "${directoryName}"`);
  }
  if (!description) errors.push('description is required');
  else if (description.length > 1024) errors.push('description must be at most 1024 characters');
  if (typeof meta.compatibility === 'string' && meta.compatibility.length > 500) errors.push('compatibility must be at most 500 characters');
  return { filePath, name: name || directoryName, valid: errors.length === 0, errors };
}

// ─── SkillManager ──────────────────────────────────────────────────────────────

export class SkillManager {
  private jsonSkills: Map<string, Skill> = new Map();
  private mdSkills: Map<string, MarkdownSkill> = new Map();
  private skillsDir: string;
  private skillRoots: string[];
  private initialized = false;

  constructor(skillsDir?: string) {
    this.skillsDir = skillsDir
      || path.join(process.env.GRAIN_HOME || path.join(os.homedir(), '.grain'), 'skills');
    const cwd = process.cwd();
    const atHome = path.resolve(cwd) === path.resolve(os.homedir());
    this.skillRoots = skillsDir ? [skillsDir] : [
      this.skillsDir,
      // Home-directory `.agents` / `.claude` trees are huge host skill dumps,
      // not this project's skills. Scanning them from `cd ~` blocked first turns.
      ...(atHome ? [] : [
        path.join(cwd, '.agents', 'skills'),
        path.join(cwd, '.claude', 'skills'),
        path.join(cwd, '.grain', 'skills'),
      ]),
    ];
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await fs.mkdir(this.skillsDir, { recursive: true });
    await this.loadAll();
    this.initialized = true;
  }

  private async loadAll(): Promise<void> {
    for (const root of this.skillRoots) {
      let files: Array<import('fs').Dirent> = [];
      try { files = await fs.readdir(root, { withFileTypes: true }); } catch { continue; }
      for (const entry of files) {
      const file = entry.name;
      const fp = entry.isDirectory() ? path.join(root, file, 'SKILL.md') : path.join(root, file);
      if (entry.isDirectory() && !existsSync(fp)) continue;
      if (file.endsWith('.md')) {
        try {
          const raw = await fs.readFile(fp, 'utf-8');
          const { meta } = parseFrontmatter(raw);
          const skill: MarkdownSkill = {
            name: meta.name || path.basename(file, '.md'),
            description: meta.description || '',
            tags: Array.isArray(meta.tags) ? meta.tags : (meta.tags ? [meta.tags] : []),
            content: '',
            filePath: fp,
          };
          this.mdSkills.set(skill.name, skill);
        } catch { /* skip bad files */ }
      } else if (entry.isDirectory()) {
        try {
          const raw = await fs.readFile(fp, 'utf-8'); const { meta } = parseFrontmatter(raw);
          if (!validatePortableSkillSource(raw, file, fp).valid) continue;
          const skill: MarkdownSkill = { name: meta.name || file, description: meta.description || '',
            tags: Array.isArray(meta.tags) ? meta.tags : (meta.tags ? [meta.tags] : []), content: '', filePath: fp, portable: true };
          this.mdSkills.set(skill.name, skill);
        } catch { /* skip bad files */ }
      } else if (file.endsWith('.json')) {
        try {
          const raw = await fs.readFile(fp, 'utf-8');
          const skill = JSON.parse(raw) as Skill;
          // Validate shape before registering — a malformed skill file must
          // not be able to crash matchSkills later.
          if (
            skill &&
            typeof skill === 'object' &&
            skill.id &&
            skill.pattern &&
            typeof skill.pattern === 'object' &&
            skill.metadata &&
            typeof skill.metadata === 'object'
          ) {
            this.jsonSkills.set(skill.id, skill);
          }
        } catch { /* skip bad files */ }
      }
      }
    }
  }

  private async materialize(skill: MarkdownSkill): Promise<MarkdownSkill> {
    const raw = await fs.readFile(skill.filePath, 'utf8'); const { body } = parseFrontmatter(raw);
    return { ...skill, content: body.trim() };
  }

  /**
   * Score a single Markdown skill against the task prompt and CWD language tags.
   *
   * Scoring layers (returns 0–1):
   *   1. Tag / keyword overlap with prompt tokens → 0.70 – 0.95
   *   2. Description word overlap with prompt tokens → 0.50 – 0.85
   *   3. CWD language tag overlap (bonus +0.10, capped at 1.0)
   *
   * Skills with no tags and no description get a baseline score of 0.30 so
   * they only surface when nothing more relevant exists.
   */
  private async scoreMdSkill(skill: MarkdownSkill, promptLower: string, cwdTags: Set<string>): Promise<number> {
    const promptTokens = new Set(promptLower.split(/\s+/).filter(Boolean));
    let score = 0;

    // ── 1. Tag overlap ────────────────────────────────────────────────────────
    if (skill.tags.length > 0) {
      const tagsLower = skill.tags.map(t => t.toLowerCase());
      const matched = tagsLower.filter(t => promptLower.includes(t) || promptTokens.has(t));
      if (matched.length > 0) {
        score = Math.max(score, Math.min(0.95, 0.70 + (matched.length / tagsLower.length) * 0.25));
      }
    }

    // ── 2. Description word overlap ───────────────────────────────────────────
    if (skill.description) {
      const descWords = skill.description.toLowerCase().split(/\s+/).filter(Boolean);
      const overlap = descWords.filter(w => promptTokens.has(w)).length;
      if (overlap > 0) {
        score = Math.max(score, Math.min(0.85, 0.50 + (overlap / descWords.length) * 0.35));
      }
    }

    // Baseline for skills with no matchable metadata
    if (score === 0) score = 0.30;

    // ── 3. CWD language bonus ─────────────────────────────────────────────────
    const skillTokens = new Set(skill.tags.map(t => t.toLowerCase()));
    if ([...skillTokens].some(t => cwdTags.has(t))) {
      score = Math.min(1.0, score + 0.10);
    }

    return score;
  }

  /**
   * Returns the top-3 Markdown skills most relevant to `prompt`, ranked by
   * relevance score.  Falls back to returning up to 3 skills by insertion
   * order when no prompt is supplied (e.g. legacy callers).
   *
   * The rendered block mirrors the JSON-skills layout so the injected context
   * is consistent.
   */
  async getMarkdownContext(prompt?: string): Promise<string> {
    await this.initialize();
    if (this.mdSkills.size === 0) return '';

    const MAX_MD_SKILLS = 3;
    let selected: MarkdownSkill[];

    if (prompt) {
      const promptLower = prompt.toLowerCase();
      const cwdTags = await detectCwdLanguages();

      const scored = await Promise.all(
        Array.from(this.mdSkills.values()).map(async skill => ({
          skill,
          score: await this.scoreMdSkill(skill, promptLower, cwdTags),
        }))
      );

      selected = scored
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_MD_SKILLS)
        .map(({ skill }) => skill);
    } else {
      // Legacy / no-prompt path: take first N by insertion order
      selected = Array.from(this.mdSkills.values()).slice(0, MAX_MD_SKILLS);
    }

    selected = await Promise.all(selected.map(skill => this.materialize(skill)));
    const parts: string[] = ['## Skills\n'];
    for (const skill of selected) {
      parts.push(`### ${skill.name}${skill.description ? ` — ${skill.description}` : ''}`);
      parts.push(skill.content);
      parts.push('');
    }
    return parts.join('\n');
  }

  /** Returns list of all Markdown skills (for CLI display) */
  async listMarkdownSkills(): Promise<MarkdownSkill[]> {
    await this.initialize();
    return Array.from(this.mdSkills.values());
  }

  /** Validate every discovered portable package, including packages excluded from activation. */
  async validatePortableSkills(): Promise<SkillValidationResult[]> {
    const results: SkillValidationResult[] = [];
    for (const root of this.skillRoots) {
      let entries: Array<import('fs').Dirent> = [];
      try { entries = await fs.readdir(root, { withFileTypes: true }); } catch { continue; }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const fp = path.join(root, entry.name, 'SKILL.md');
        if (!existsSync(fp)) continue;
        try { results.push(validatePortableSkillSource(await fs.readFile(fp, 'utf8'), entry.name, fp)); }
        catch (error) { results.push({ filePath: fp, name: entry.name, valid: false,
          errors: [error instanceof Error ? error.message : String(error)] }); }
      }
    }
    return results;
  }

  /** Get a Markdown skill by name */
  async getMarkdownSkill(name: string): Promise<MarkdownSkill | undefined> {
    await this.initialize();
    const skill = this.mdSkills.get(name); return skill ? this.materialize(skill) : undefined;
  }

  /** Create a Markdown skill */
  async createMarkdownSkill(name: string, description: string, content: string, tags: string[] = []): Promise<MarkdownSkill> {
    await this.initialize();
    const slug = name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    if (!slug || slug.length > 64) throw new Error('Skill name must produce a 1-64 character lowercase hyphenated name');
    if (!description.trim() || description.trim().length > 1024) throw new Error('Skill description must contain 1-1024 characters');
    const directory = path.join(this.skillsDir, slug); await fs.mkdir(directory, { recursive: true });
    const fp = path.join(directory, 'SKILL.md');

    const tagsLine = tags.length > 0 ? `\ntags: [${tags.join(', ')}]` : '';
    const raw = `---\nname: ${slug}\ndescription: ${description}${tagsLine}\n---\n\n${content.trim()}\n`;
    writeFileSync(fp, raw, 'utf-8');

    const skill: MarkdownSkill = { name: slug, description, tags, content: content.trim(), filePath: fp, portable: true };
    this.mdSkills.set(slug, skill);
    return skill;
  }

  /** Delete a Markdown skill by name */
  async deleteMarkdownSkill(name: string): Promise<boolean> {
    await this.initialize();
    const skill = this.mdSkills.get(name);
    if (!skill) return false;
    if (!path.resolve(skill.filePath).startsWith(`${path.resolve(this.skillsDir)}${path.sep}`)) return false;
    try {
      await fs.unlink(skill.filePath);
      if (path.basename(skill.filePath) === 'SKILL.md') try { await fs.rmdir(path.dirname(skill.filePath)); } catch {}
      this.mdSkills.delete(name);
      return true;
    } catch {
      return false;
    }
  }

  // ─── JSON skill methods (machine-learned) ──────────────────────────────────

  /**
   * Score every JSON skill against the task prompt AND the cwd's inferred
   * language tags, then return the top-3 above `threshold`.
   *
   * Scoring layers (applied per skill, best match wins per trigger type):
   *   1. Regex match          → base 0.90
   *   2. Keyword overlap      → 0.70 – 0.95, proportional to fraction matched
   *   3. Semantic word overlap → 0.50 – 0.85
   *
   * CWD bonus: if the skill's keywords/tags intersect the detected language
   * tags from the working directory, the final score gets a +0.10 boost
   * (capped at 1.0).  This lets "rust" skills float up automatically when
   * Cargo.toml is present even if the prompt doesn't say "rust".
   */
  async matchSkills(input: string, threshold = 0.6): Promise<SkillMatch[]> {
    await this.initialize();

    const inputLower = input.toLowerCase();
    const cwdTags = await detectCwdLanguages();

    // Collect the single best match per skill (avoid duplicate entries)
    const bestPerSkill = new Map<string, SkillMatch>();

    const consider = (candidate: SkillMatch) => {
      const existing = bestPerSkill.get(candidate.skill.id);
      if (!existing || candidate.confidence > existing.confidence) {
        bestPerSkill.set(candidate.skill.id, candidate);
      }
    };

    for (const skill of this.jsonSkills.values()) {
      // Guard per-skill: one malformed skill must not reject the whole match.
      try {
        // ── 1. Regex ────────────────────────────────────────────────────────
        if (Array.isArray(skill.pattern?.regex)) {
          for (const pattern of skill.pattern.regex) {
            try {
              if (new RegExp(pattern, 'i').test(input)) {
                consider({ skill, confidence: 0.9, trigger: 'regex', matched: pattern });
                break;
              }
            } catch { /* skip bad regex */ }
          }
        }

        // ── 2. Keyword overlap ──────────────────────────────────────────────
        if (Array.isArray(skill.pattern?.keywords)) {
          const kwLower = skill.pattern.keywords.map(k => String(k).toLowerCase());
          const matched = kwLower.filter(kw => inputLower.includes(kw));
          if (matched.length > 0) {
            const confidence = Math.min(0.95, 0.7 + (matched.length / kwLower.length) * 0.25);
            consider({ skill, confidence, trigger: 'keyword', matched: matched.join(', ') });
          }
        }

        // ── 3. Semantic word overlap ────────────────────────────────────────
        if (typeof skill.pattern?.semantic === 'string') {
          const semWords = skill.pattern.semantic.toLowerCase().split(/\s+/);
          const inWords = inputLower.split(/\s+/);
          const overlap = semWords.filter(w => inWords.includes(w)).length;
          if (overlap > 0) {
            const confidence = Math.min(0.85, 0.5 + (overlap / semWords.length) * 0.35);
            consider({ skill, confidence, trigger: 'semantic', matched: skill.pattern.semantic });
          }
        }
      } catch { /* skip malformed skill */ }
    }

    // ── CWD language bonus ────────────────────────────────────────────────────
    // Collect all keyword-like strings associated with each skill for tag
    // comparison: pattern.keywords + metadata.tags.
    for (const [id, match] of bestPerSkill) {
      const skill = match.skill;
      // Guard against non-array keywords/tags: a matched skill can pass
      // load-time validation (which only checks metadata is an object) yet
      // still carry a malformed `keywords`/`tags`, which would throw here.
      const kw = Array.isArray(skill.pattern?.keywords) ? skill.pattern!.keywords : [];
      const tg = Array.isArray(skill.metadata?.tags) ? skill.metadata!.tags : [];
      const skillTokens = new Set([
        ...kw.map(k => String(k).toLowerCase()),
        ...tg.map(t => String(t).toLowerCase()),
      ]);
      const hasCwdOverlap = [...skillTokens].some(t => cwdTags.has(t));
      if (hasCwdOverlap) {
        bestPerSkill.set(id, {
          ...match,
          confidence: Math.min(1.0, match.confidence + 0.10),
        });
      }
    }

    return Array.from(bestPerSkill.values())
      .filter(m => m.confidence >= threshold)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 3);
  }

  async getAllJsonSkills(): Promise<Skill[]> {
    await this.initialize();
    return Array.from(this.jsonSkills.values());
  }

  async createSkill(config: CreateSkillConfig): Promise<Skill> {
    await this.initialize();
    const skill: Skill = {
      id: randomUUID(),
      name: config.name,
      description: config.description,
      pattern: config.pattern,
      approach: config.approach,
      code: config.code,
      examples: [{ ...config.example, timestamp: new Date().toISOString() }],
      metadata: {
        times_used: 0,
        success_rate: 1.0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: config.tags,
        complexity: config.complexity,
      },
    };
    await this.saveSkill(skill);
    return skill;
  }

  async saveSkill(skill: Skill): Promise<void> {
    await this.initialize();
    const fp = path.join(this.skillsDir, `${skill.id}.json`);
    await fs.writeFile(fp, JSON.stringify(skill, null, 2), 'utf-8');
    this.jsonSkills.set(skill.id, skill);
  }

  async getSkill(id: string): Promise<Skill | undefined> {
    await this.initialize();
    return this.jsonSkills.get(id);
  }

  async recordExecution(skillId: string, success: boolean, example?: Omit<SkillExample, 'timestamp'>): Promise<void> {
    const skill = await this.getSkill(skillId);
    if (!skill) return;

    const total = skill.metadata.times_used + 1;
    const successes = skill.metadata.times_used * skill.metadata.success_rate + (success ? 1 : 0);
    skill.metadata.times_used = total;
    skill.metadata.success_rate = successes / total;
    skill.metadata.last_used = new Date().toISOString();
    skill.metadata.updated_at = new Date().toISOString();

    if (success && example) {
      skill.examples.push({ ...example, timestamp: new Date().toISOString() });
      if (skill.examples.length > 10) skill.examples = skill.examples.slice(-10);
    }
    await this.saveSkill(skill);
  }

  async deleteSkill(skillId: string): Promise<void> {
    await this.initialize();
    const fp = path.join(this.skillsDir, `${skillId}.json`);
    await fs.unlink(fp);
    this.jsonSkills.delete(skillId);
  }

  async searchSkills(query: string): Promise<Skill[]> {
    await this.initialize();
    const q = query.toLowerCase();
    return Array.from(this.jsonSkills.values()).filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.metadata.tags?.some(t => t.toLowerCase().includes(q))
    );
  }

  getSkillsDirectory(): string { return this.skillsDir; }
  clear(): void { this.jsonSkills.clear(); this.mdSkills.clear(); this.initialized = false; }
}

// ─── Singleton ─────────────────────────────────────────────────────────────────

let instance: SkillManager | null = null;
export function getSkillManager(): SkillManager {
  if (!instance) instance = new SkillManager();
  return instance;
}
export function resetSkillManager(): void { instance = null; }
