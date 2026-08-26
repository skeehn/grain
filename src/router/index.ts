// Model router - intelligent model selection based on task complexity
// Model IDs verified against AWS Bedrock live inference profiles — June 2026
import type { Message } from '../providers/types.js';

export enum TaskComplexity {
  TRIVIAL = 'trivial',
  SIMPLE = 'simple',
  MODERATE = 'moderate',
  COMPLEX = 'complex',
  CRITICAL = 'critical',
}

export interface ModelConfig {
  provider: string;
  model: string;
  label: string;
  inputCostPer1M: number;
  outputCostPer1M: number;
  speedRating: number;
}

// June 2026 — verified live against AWS Bedrock us-east-1 inference profiles
export const MODEL_CONFIGS: Record<string, ModelConfig> = {
  'poolside': {
    provider: 'openrouter',
    label: 'Poolside Laguna XS 2.1',
    model: 'poolside/laguna-xs-2.1',
    inputCostPer1M: 0.06,
    outputCostPer1M: 0.12,
    speedRating: 9,
  },
  'haiku': {
    provider: 'bedrock',
    label: 'Haiku 4.5',
    model: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
    inputCostPer1M: 0.80,
    outputCostPer1M: 4.00,
    speedRating: 10,
  },
  'sonnet': {
    provider: 'bedrock',
    label: 'Sonnet 4.6',
    model: 'us.anthropic.claude-sonnet-4-6',
    inputCostPer1M: 3.00,
    outputCostPer1M: 15.00,
    speedRating: 7,
  },
  'opus': {
    provider: 'bedrock',
    label: 'Opus 4.5',
    model: 'us.anthropic.claude-opus-4-5-20251101-v1:0',
    inputCostPer1M: 15.00,
    outputCostPer1M: 75.00,
    speedRating: 4,
  },
};

// Aliases so users can pass --model sonnet4-5, sonnet, opus, etc.
export const MODEL_ALIASES: Record<string, string> = {
  'pool':          'poolside',
  'poolside':      'poolside',
  'laguna':        'poolside',
  'laguna-xs':     'poolside',
  'laguna-xs-2.1': 'poolside',
  'haiku':        'haiku',
  'haiku4':       'haiku',
  'haiku4-5':     'haiku',
  'sonnet':       'sonnet',
  'sonnet4':      'sonnet',
  'sonnet4-5':    'sonnet',
  'sonnet4-6':    'sonnet',
  'opus':         'opus',
  'opus4':        'opus',
  'opus4-5':      'opus',
  'opus4-8':      'opus',
  'fast':         'haiku',
  'cheap':        'haiku',
  'best':         'opus',
  'smart':        'opus',
};

// Complexity to model mapping
const COMPLEXITY_TO_MODEL: Record<TaskComplexity, string> = {
  [TaskComplexity.TRIVIAL]:  'haiku',
  [TaskComplexity.SIMPLE]:   'haiku',
  [TaskComplexity.MODERATE]: 'sonnet',
  [TaskComplexity.COMPLEX]:  'opus',
  [TaskComplexity.CRITICAL]: 'opus',
};

// Keywords for task classification
const KEYWORD_PATTERNS = {
  trivial: [
    /^(show|read|display|list|get|fetch|check|status|what|how\smany)/i,
    /^git\sstatus/i,
    /^scan/i,
  ],
  simple: [
    /comment|doc|readme|format|lint|style/i,
    /typo|fix\stypo|rename/i,
    /add\slog|console\.log|debug/i,
  ],
  critical: [
    // word-bounded: bare "key" matched "keyboard"/"monkey", "token" matched "tokenize"
    /\bsecurity\b|\bauth(?!or)\w*|\bpasswords?\b|\btokens?\b|\bsecrets?\b|\b(?:api|ssh|access|private|secret)[ _-]?keys?\b|\bencrypt|\bdecrypt/i,
    /payment|billing|transaction|\bmoney\b|credit\s?card|stripe/i,
    /\bdeploy|production|release|publish|\bship\b/i,
    /delete.*database|drop.*table|truncate/i,
  ],
  complex: [
    /architecture|design|pattern|refactor\s(entire|whole|all)/i,
    /algorithm|optimization|performance/i,
    // bare "model" matched any prompt mentioning a model ("which model are you")
    /database\s+schema|\bmigrations?\b|\bdata\s+model\b/i,
    /api\sdesign|rest\sapi|graphql/i,
    /website|landing|web\sapp|frontend/i,
    /implement.*from\sscratch|rewrite/i,
    /benchmark|test\ssuite|comprehensive/i,
  ],
};

export function classifyTaskComplexity(prompt: string, _conversationHistory?: Message[]): TaskComplexity {
  // Check for critical patterns first
  for (const pattern of KEYWORD_PATTERNS.critical) {
    if (pattern.test(prompt)) return TaskComplexity.CRITICAL;
  }

  // Check for complex patterns
  for (const pattern of KEYWORD_PATTERNS.complex) {
    if (pattern.test(prompt)) return TaskComplexity.COMPLEX;
  }

  // Check for trivial patterns
  for (const pattern of KEYWORD_PATTERNS.trivial) {
    if (pattern.test(prompt)) return TaskComplexity.TRIVIAL;
  }

  // Check for simple patterns
  for (const pattern of KEYWORD_PATTERNS.simple) {
    if (pattern.test(prompt)) return TaskComplexity.SIMPLE;
  }

  // Heuristics: word count + multi-step
  const wordCount = prompt.split(/\s+/).length;
  const hasMultipleSteps = /\d\.\s|\band\s.*\band\s/.test(prompt);

  if (wordCount < 10) return TaskComplexity.TRIVIAL;
  if (wordCount < 30 && !hasMultipleSteps) return TaskComplexity.SIMPLE;
  if (wordCount > 100 || hasMultipleSteps) return TaskComplexity.COMPLEX;

  return TaskComplexity.MODERATE;
}

export function resolveModelAlias(alias: string): string | undefined {
  return MODEL_ALIASES[alias.toLowerCase()];
}

/**
 * Resolve a short alias *inside the provider the user already chose*.
 *
 * The old behaviour rewrote both provider and model from `MODEL_CONFIGS`, so
 * `--provider claude-code --model opus` silently became Bedrock — unusable for
 * anyone without AWS. An alias now only picks a model; the provider is only
 * filled in when the caller did not state one.
 */
export function resolveModelForProvider(
  provider: string | undefined,
  model: string,
): { provider: string | undefined; model: string; label?: string } {
  const key = MODEL_ALIASES[model.toLowerCase()];
  if (!key || !MODEL_CONFIGS[key]) return { provider, model };
  const config = MODEL_CONFIGS[key];
  // Every CLI agent speaks these aliases natively — pass them straight through.
  if (provider && CLI_ALIAS_PROVIDERS.includes(provider)) return { provider, model: model.toLowerCase() };
  if (provider && provider !== config.provider) {
    // The user pinned a provider. Honour it and keep the alias as written; the
    // provider knows its own naming better than this table does.
    return { provider, model };
  }
  return { provider: config.provider, model: config.model, label: config.label };
}

const CLI_ALIAS_PROVIDERS = ['claude-code', 'codex', 'opencode', 'grok'];

export function routeModel(
  complexity: TaskComplexity,
  options?: { preferFast?: boolean; preferCheap?: boolean; forceModel?: string; }
): ModelConfig {
  if (options?.forceModel) {
    // Try alias first, then direct key
    const key = MODEL_ALIASES[options.forceModel.toLowerCase()] ?? options.forceModel;
    if (MODEL_CONFIGS[key]) return MODEL_CONFIGS[key];
  }

  let modelKey = COMPLEXITY_TO_MODEL[complexity];
  if (options?.preferCheap || options?.preferFast) modelKey = 'haiku';

  return MODEL_CONFIGS[modelKey];
}

export function estimateCost(inputTokens: number, outputTokens: number, model: ModelConfig): number {
  return (inputTokens / 1_000_000) * model.inputCostPer1M +
         (outputTokens / 1_000_000) * model.outputCostPer1M;
}

export function explainRouting(complexity: TaskComplexity, model: ModelConfig): string {
  const reasons: Record<TaskComplexity, string> = {
    [TaskComplexity.TRIVIAL]:  `Quick task → ${model.label} (fast, cheap)`,
    [TaskComplexity.SIMPLE]:   `Simple edit → ${model.label} (fast, cheap)`,
    [TaskComplexity.MODERATE]: `Standard task → ${model.label} (balanced)`,
    [TaskComplexity.COMPLEX]:  `Complex work → ${model.label} (most capable)`,
    [TaskComplexity.CRITICAL]: `Critical → ${model.label} (most capable)`,
  };
  return `${reasons[complexity]} [${model.model.split('/').pop()?.split('.').pop() || model.model}]`;
}
