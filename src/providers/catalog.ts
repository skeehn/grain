import type { ModelDescriptor } from './types.js';

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
const CACHE_TTL_MS = 15 * 60_000;
let cache: { expiresAt: number; models: ModelDescriptor[] } | undefined;

function numberOrUndefined(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Parse the OpenRouter catalog without trusting optional provider metadata. */
export function parseOpenRouterModels(payload: unknown, now = new Date()): ModelDescriptor[] {
  const data = Array.isArray((payload as any)?.data) ? (payload as any).data : [];
  return data.flatMap((raw: any): ModelDescriptor[] => {
    if (!raw || typeof raw.id !== 'string' || !raw.id.trim()) return [];
    const supported = new Set(Array.isArray(raw.supported_parameters) ? raw.supported_parameters.map(String) : []);
    const input = numberOrUndefined(raw.pricing?.prompt);
    const output = numberOrUndefined(raw.pricing?.completion);
    const id = raw.id.trim();
    const free = id.endsWith(':free') || (input === 0 && output === 0);
    return [{
      provider: 'openrouter', id, displayName: String(raw.name || id), free, source: 'remote',
      refreshedAt: now.toISOString(),
      ...(input !== undefined ? { inputPricePerMillion: input * 1_000_000 } : {}),
      ...(output !== undefined ? { outputPricePerMillion: output * 1_000_000 } : {}),
      capabilities: {
        contextWindow: Math.max(1, numberOrUndefined(raw.context_length) ?? 128_000),
        maxOutputTokens: Math.max(1, numberOrUndefined(raw.top_provider?.max_completion_tokens) ?? 16_384),
        tools: supported.has('tools') || supported.has('tool_choice'),
        parallelTools: supported.has('tools'), images: Array.isArray(raw.architecture?.input_modalities) && raw.architecture.input_modalities.includes('image'),
        reasoning: supported.has('reasoning'), structuredOutput: supported.has('response_format'),
        promptCaching: false, tokenAccounting: true,
      },
    }];
  }).sort((a: ModelDescriptor, b: ModelDescriptor) => Number(b.free) - Number(a.free) || a.id.localeCompare(b.id));
}

export async function fetchOpenRouterModels(options: { apiKey?: string; fetchImpl?: typeof fetch; force?: boolean } = {}): Promise<ModelDescriptor[]> {
  if (!options.force && cache && cache.expiresAt > Date.now()) return cache.models;
  const fetchImpl = options.fetchImpl || fetch;
  const response = await fetchImpl(OPENROUTER_MODELS_URL, {
    headers: options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : undefined,
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`OpenRouter model catalog failed: HTTP ${response.status}`);
  const models = parseOpenRouterModels(await response.json());
  if (!models.length) throw new Error('OpenRouter model catalog returned no valid models');
  cache = { expiresAt: Date.now() + CACHE_TTL_MS, models };
  return models;
}

export async function compatibleOpenRouterFreeModels(requirements: { tools?: boolean; minContextWindow?: number } = {}): Promise<ModelDescriptor[]> {
  const models = await fetchOpenRouterModels({ apiKey: process.env.OPENROUTER_API_KEY });
  return models.filter(model => model.free
    && (!requirements.tools || model.capabilities.tools)
    && model.capabilities.contextWindow >= (requirements.minContextWindow || 0));
}

export function resetModelCatalogCache(): void { cache = undefined; }
