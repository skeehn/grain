// One catalog for everything Grain can talk to: subscription CLIs, direct APIs,
// local runtimes, and user-configured OpenAI-compatible endpoints.
//
// The picker and `/model` both read this, so a model that is listed is a model
// that can actually run — every entry carries its own availability verdict and,
// when unavailable, the exact command that fixes it.
import { spawn } from 'child_process';
import { loadConfig } from '../config.js';
import { CLI_AGENTS, type CliAgentId } from './cli-agent.js';
import { fetchOpenRouterModels } from './catalog.js';

export type ModelKind = 'subscription' | 'api' | 'local' | 'custom';

export interface ModelEntry {
  /** Canonical selector, e.g. `claude-code:opus` or `openrouter/qwen3-coder:free`. */
  id: string;
  provider: string;
  model: string;
  label: string;
  hint: string;
  kind: ModelKind;
  available: boolean;
  /** Present when unavailable: what the user must do. */
  fix?: string;
  free?: boolean;
}

const PROBE_TIMEOUT_MS = 2_500;

function probe(binary: string): Promise<boolean> {
  return new Promise(resolve => {
    let settled = false;
    const done = (value: boolean) => { if (!settled) { settled = true; clearTimeout(timer); resolve(value); } };
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } done(false); }, PROBE_TIMEOUT_MS);
    timer.unref?.();
    const child = spawn(binary, ['--version'], { stdio: 'ignore' });
    child.on('error', () => done(false));
    child.on('close', code => done(code === 0));
  });
}

async function ollamaModels(): Promise<string[]> {
  try {
    const response = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(1_500) });
    if (!response.ok) return [];
    const payload = await response.json() as any;
    return (payload.models || []).map((item: any) => String(item.name)).filter(Boolean);
  } catch { return []; }
}

const API_PROVIDERS: Array<{ provider: string; envKey: string; label: string; models: Array<{ id: string; hint: string }> }> = [
  { provider: 'anthropic', envKey: 'ANTHROPIC_API_KEY', label: 'Anthropic API', models: [
    { id: 'claude-opus-4-5', hint: 'api credit · max quality' },
    { id: 'claude-sonnet-4-5', hint: 'api credit · balanced' },
    { id: 'claude-haiku-4-5', hint: 'api credit · fast' },
  ] },
  { provider: 'groq', envKey: 'GROQ_API_KEY', label: 'Groq', models: [
    { id: 'openai/gpt-oss-120b', hint: 'very fast · tools' },
    { id: 'openai/gpt-oss-20b', hint: 'fastest · tools' },
  ] },
  { provider: 'xai', envKey: 'XAI_API_KEY', label: 'xAI Grok API', models: [
    { id: 'grok-code-fast-1', hint: 'Grain-native tools · coding · fast' },
    { id: 'grok-4', hint: 'Grain-native tools · general' },
    { id: 'grok-4-fast', hint: 'Grain-native tools · fast' },
  ] },
  { provider: 'bedrock', envKey: '', label: 'AWS Bedrock', models: [
    { id: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0', hint: 'bedrock · balanced' },
    { id: 'us.anthropic.claude-haiku-4-5-20251001-v1:0', hint: 'bedrock · fast' },
  ] },
];

function bedrockConfigured(): boolean {
  return Boolean(process.env.AWS_PROFILE || process.env.AWS_ACCESS_KEY_ID || process.env.AWS_REGION);
}

export interface RegistryOptions {
  /** Skip the OpenRouter network call — used when the picker must open instantly. */
  offline?: boolean;
  workspaceRoot?: string;
  /** Cap on live OpenRouter entries; the picker filters, it does not need thousands. */
  openRouterLimit?: number;
}

let cached: { at: number; entries: ModelEntry[] } | undefined;

/** Discovered once per process minute — probing four binaries per keystroke is not free. */
export async function buildModelRegistry(options: RegistryOptions = {}): Promise<ModelEntry[]> {
  if (cached && Date.now() - cached.at < 60_000) return cached.entries;
  const entries = await discover(options);
  cached = { at: Date.now(), entries };
  return entries;
}

export function invalidateModelRegistry(): void { cached = undefined; }

async function discover(options: RegistryOptions): Promise<ModelEntry[]> {
  const config = loadConfig(options.workspaceRoot);
  const entries: ModelEntry[] = [];

  // ── Subscriptions first: they cost nothing extra and are what most users hold.
  const agentIds = Object.keys(CLI_AGENTS) as CliAgentId[];
  const installed = await Promise.all(agentIds.map(id => probe(CLI_AGENTS[id].binary)));
  agentIds.forEach((id, index) => {
    const definition = CLI_AGENTS[id];
    for (const model of definition.models) {
      entries.push({
        id: `${id}:${model.id}`, provider: id, model: model.id,
        label: `${definition.displayName} · ${model.label}`, hint: model.hint, kind: 'subscription',
        available: installed[index],
        fix: installed[index] ? undefined : `Install the ${definition.binary} CLI and sign in, then rerun /model.`,
      });
    }
  });

  // ── Direct APIs.
  for (const api of API_PROVIDERS) {
    const available = api.provider === 'bedrock' ? bedrockConfigured() : Boolean(process.env[api.envKey]);
    for (const model of api.models) {
      entries.push({
        id: `${api.provider}:${model.id}`, provider: api.provider, model: model.id,
        label: `${api.label} · ${model.id}`, hint: model.hint, kind: 'api', available,
        fix: available ? undefined
          : api.provider === 'bedrock' ? 'Configure AWS credentials (aws configure) to use Bedrock.'
          : `grain config set key ${api.envKey} <your-key>`,
      });
    }
  }

  // ── Local runtimes.
  for (const model of await ollamaModels()) {
    entries.push({ id: `ollama:${model}`, provider: 'ollama', model, label: `Ollama · ${model}`,
      hint: 'local · free · offline', kind: 'local', available: true, free: true });
  }

  // ── User-configured OpenAI-compatible endpoints.
  for (const [id, custom] of Object.entries(config.providers || {})) {
    const available = Boolean(process.env[custom.apiKeyEnv]);
    entries.push({ id: `${id}:${custom.defaultModel}`, provider: id, model: custom.defaultModel,
      label: `${custom.displayName || id} · ${custom.defaultModel}`, hint: custom.baseUrl, kind: 'custom',
      available, fix: available ? undefined : `grain config set key ${custom.apiKeyEnv} <your-key>` });
  }

  // ── OpenRouter: the long tail. Live, so new models appear without a release.
  const openRouterKey = process.env.OPENROUTER_API_KEY;
  if (!options.offline) {
    try {
      const remote = await fetchOpenRouterModels({ apiKey: openRouterKey });
      const usable = remote.filter(model => model.capabilities.tools);
      for (const model of usable.slice(0, options.openRouterLimit ?? 250)) {
        entries.push({
          id: `openrouter:${model.id}`, provider: 'openrouter', model: model.id,
          label: `OpenRouter · ${model.id}`,
          hint: `${model.free ? 'free · ' : ''}${Math.round(model.capabilities.contextWindow / 1024)}K context`,
          kind: 'api', available: Boolean(openRouterKey), free: model.free,
          fix: openRouterKey ? undefined : 'grain config set key OPENROUTER_API_KEY <your-key>',
        });
      }
    } catch { /* offline or throttled — the static entries above still work */ }
  }
  if (!entries.some(entry => entry.provider === 'openrouter')) {
    entries.push({ id: 'openrouter:openrouter/free', provider: 'openrouter', model: 'openrouter/free',
      label: 'OpenRouter · auto free', hint: 'free · automatic compatible fallback', kind: 'api',
      available: Boolean(openRouterKey), free: true,
      fix: openRouterKey ? undefined : 'grain config set key OPENROUTER_API_KEY <your-key>' });
  }

  return sortEntries(entries);
}

/** Available first, then subscription > local > api > custom, then label. */
export function sortEntries(entries: ModelEntry[]): ModelEntry[] {
  const rank: Record<ModelKind, number> = { subscription: 0, local: 1, api: 2, custom: 3 };
  return [...entries].sort((a, b) =>
    Number(b.available) - Number(a.available) || rank[a.kind] - rank[b.kind] || a.label.localeCompare(b.label));
}

/** Anything the user can currently run, for "pick me a working default". */
export function firstAvailable(entries: ModelEntry[]): ModelEntry | undefined {
  return entries.find(entry => entry.available);
}
