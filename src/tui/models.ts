// Model selection for `/model`, `--model`, and the picker overlay.
//
// Selection never rejects a target Grain can reach: the provider list is
// derived from the live config, so custom endpoints and CLI-agent providers
// resolve exactly like the built-ins.
import { loadConfig, VALID_PROVIDERS, normalizeProvider } from '../config.js';
import { CLI_AGENTS, type CliAgentId } from '../providers/cli-agent.js';

export interface ModelChoice { provider: string; model: string; label: string; hint: string }

/**
 * Small, always-offered starting set. The full, live catalog comes from
 * `buildModelRegistry`; this is the fallback when the network is unavailable
 * and the seed list for a first run.
 */
export const MODEL_CATALOG: ModelChoice[] = [
  // Subscriptions first — no API credit required. These CLIs own their tools.
  { provider: 'claude-code', model: 'auto', label: 'claude code', hint: 'subscription · Claude Code CLI' },
  { provider: 'claude-code', model: 'opus', label: 'claude opus', hint: 'subscription · highest quality' },
  { provider: 'claude-code', model: 'sonnet', label: 'claude sonnet', hint: 'subscription · balanced' },
  { provider: 'codex', model: 'auto', label: 'codex', hint: 'subscription · OpenAI Codex CLI' },
  { provider: 'grok', model: 'auto', label: 'grok', hint: 'subscription · Grok CLI / grokbot' },
  { provider: 'opencode', model: 'auto', label: 'opencode', hint: 'local agent · own config' },
  // Grain-native APIs — Grain brokers tools, diffs, and /undo.
  { provider: 'openrouter', model: 'openrouter/free', label: 'auto free', hint: 'Grain tools · free · automatic fallback' },
  { provider: 'openrouter', model: 'qwen/qwen3-coder:free', label: 'qwen3-coder', hint: 'Grain tools · free · 1M ctx' },
  { provider: 'openrouter', model: 'openai/gpt-oss-20b:free', label: 'gpt-oss-20b', hint: 'Grain tools · free · tools' },
  { provider: 'xai', model: 'grok-code-fast-1', label: 'grok-code-fast', hint: 'Grain tools · xAI Grok API' },
  { provider: 'xai', model: 'grok-4', label: 'grok-4', hint: 'Grain tools · xAI Grok API' },
  { provider: 'anthropic', model: 'claude-sonnet-4-5', label: 'claude-sonnet-4.5', hint: 'anthropic api · balanced' },
  { provider: 'anthropic', model: 'claude-opus-4-5', label: 'claude-opus-4.5', hint: 'anthropic api · max quality' },
  { provider: 'groq', model: 'openai/gpt-oss-120b', label: 'gpt-oss-120b (groq)', hint: 'Grain tools · groq · very fast' },
];

/** Every provider id Grain can resolve right now, built-ins plus user config. */
export function knownProviders(workspaceRoot?: string): string[] {
  let custom: string[] = [];
  try { custom = Object.keys(loadConfig(workspaceRoot).providers || {}); } catch { /* defaults are enough */ }
  return [...new Set([...VALID_PROVIDERS, ...custom])];
}

/** Catalog with the active (provider, model) marked current; a custom active
 *  model not in the list is prepended so it's visible and selectable. */
export function catalogWithCurrent(provider: string, model: string): Array<ModelChoice & { current: boolean }> {
  const known = MODEL_CATALOG.some(c => c.provider === provider && c.model === model);
  const base = known ? [] : [{ provider, model, label: model, hint: `${provider} · current`, current: true }];
  return [
    ...base,
    ...MODEL_CATALOG.map(c => ({ ...c, current: c.provider === provider && c.model === model })),
  ];
}

/** Next model in the catalog after the current one — for Ctrl-P style cycling. */
export function nextModel(provider: string, model: string): ModelChoice {
  const i = MODEL_CATALOG.findIndex(c => c.provider === provider && c.model === model);
  return MODEL_CATALOG[(i + 1) % MODEL_CATALOG.length];
}

/**
 * Resolve a selector into a concrete (provider, model).
 *
 * Accepts `provider:model`, a bare CLI-agent name, a catalog label, or a bare
 * model id (kept on the current provider). Only `:` separates provider from
 * model, and only when the head actually names a provider — `openrouter/free`
 * and `qwen/qwen3-coder:free` are model ids, not provider-qualified selectors.
 */
export function resolveModelSelection(
  value: string,
  currentProvider: string,
  workspaceRoot?: string,
): { provider: string; model: string } {
  const trimmed = value.trim();
  const providers = knownProviders(workspaceRoot);

  const separator = trimmed.indexOf(':');
  if (separator > 0) {
    const head = normalizeProvider(trimmed.slice(0, separator));
    const tail = trimmed.slice(separator + 1).trim();
    if (providers.includes(head) && tail) return { provider: head, model: tail };
  }

  const bare = normalizeProvider(trimmed);
  // Bare provider name: `/model grok`, `/model openrouter`, `/model grokbot`.
  if (providers.includes(bare)) {
    if (Object.prototype.hasOwnProperty.call(CLI_AGENTS, bare)) {
      const agent = CLI_AGENTS[bare as CliAgentId];
      return { provider: agent.id, model: agent.defaultModel };
    }
    const seed = MODEL_CATALOG.find(choice => choice.provider === bare);
    if (seed) return { provider: seed.provider, model: seed.model };
    return { provider: bare, model: trimmed };
  }

  const known = MODEL_CATALOG.find(choice => choice.model === trimmed || choice.label === trimmed);
  return known ? { provider: known.provider, model: known.model } : { provider: currentProvider, model: trimmed };
}
