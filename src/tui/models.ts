// Curated model catalog for the /model selector and Ctrl-P cycling. Users can
// still `/model <any-provider-id>` for anything not listed. Kept short and
// grouped so switching is one keystroke; free options first for cheap testing.
export interface ModelChoice { provider: string; model: string; label: string; hint: string }

export const MODEL_CATALOG: ModelChoice[] = [
  // Free (OpenRouter) — good for high-volume testing.
  { provider: 'openrouter', model: 'poolside/laguna-m.1:free', label: 'laguna-m.1', hint: 'free · poolside · coding' },
  { provider: 'openrouter', model: 'nvidia/nemotron-3-super-120b-a12b:free', label: 'nemotron-3-super', hint: 'free · 1M ctx · responsive' },
  { provider: 'openrouter', model: 'qwen/qwen3-coder:free', label: 'qwen3-coder', hint: 'free · 1M ctx · coding' },
  { provider: 'openrouter', model: 'nousresearch/hermes-3-llama-3.1-405b:free', label: 'hermes-3-405b', hint: 'free · 405B' },
  { provider: 'openrouter', model: 'meta-llama/llama-3.3-70b-instruct:free', label: 'llama-3.3-70b', hint: 'free · 70B' },
  // Strong paid (direct) — reach for hard tasks.
  { provider: 'anthropic', model: 'claude-sonnet-4-5', label: 'claude-sonnet-4.5', hint: 'anthropic · balanced' },
  { provider: 'anthropic', model: 'claude-opus-4-5', label: 'claude-opus-4.5', hint: 'anthropic · max quality' },
  { provider: 'groq', model: 'qwen/qwen3-32b', label: 'qwen3-32b (groq)', hint: 'groq · very fast' },
];

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
