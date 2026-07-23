/**
 * Skills System Types
 *
 * Skills are reusable problem-solving patterns.
 * Two formats are supported:
 *   - Markdown (.md): human-authored, always injected as context
 *   - JSON (.json):   machine-learned, keyword-matched at runtime
 */

export interface SkillPattern {
  regex?: string[];
  keywords?: string[];
  semantic?: string;
}

export interface SkillExample {
  problem: string;
  execution: string;
  outcome: string;
  timestamp: string;
}

export interface SkillMetadata {
  times_used: number;
  success_rate: number;
  created_at: string;
  last_used?: string;
  updated_at: string;
  tags?: string[];
  complexity?: number;
}

/** Machine-learned JSON skill */
export interface Skill {
  id: string;
  name: string;
  description: string;
  pattern: SkillPattern;
  approach: string;
  code?: string[];
  examples: SkillExample[];
  metadata: SkillMetadata;
}

/** Human-authored Markdown skill */
export interface MarkdownSkill {
  /** Filename without extension */
  name: string;
  /** From YAML frontmatter `description:` */
  description: string;
  /** From YAML frontmatter `tags:` */
  tags: string[];
  /** Body content (frontmatter stripped) */
  content: string;
  /** Absolute path on disk */
  filePath: string;
  /** True for an Agent Skills package at `<name>/SKILL.md`. */
  portable?: boolean;
}

export interface SkillValidationResult {
  filePath: string;
  name: string;
  valid: boolean;
  errors: string[];
}

export interface SkillMatch {
  skill: Skill;
  confidence: number;
  trigger: 'regex' | 'keyword' | 'semantic';
  matched: string;
}

export interface SkillExecutionResult {
  skill: Skill;
  success: boolean;
  output?: string;
  error?: string;
  duration: number;
  timestamp: string;
}

export interface CreateSkillConfig {
  name: string;
  description: string;
  pattern: SkillPattern;
  approach: string;
  code?: string[];
  example: Omit<SkillExample, 'timestamp'>;
  tags?: string[];
  complexity?: number;
}
