import type { Message, Provider, ProviderStreamOptions, StreamEvent, Tool } from './types.js';
import { loadConfig, normalizeProvider } from '../config.js';
import { CLI_AGENTS } from './cli-agent.js';

type ProviderLoader = (model?: string) => Promise<Provider>;
const defaultModels: Record<string, string> = {
  bedrock: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
  anthropic: 'claude-sonnet-4-20250514',
  openrouter: 'openrouter/free',
  groq: 'openai/gpt-oss-120b',
  xai: 'grok-code-fast-1',
  ollama: 'qwen2.5-coder:7b',
  vllm: 'meta-llama/Llama-3-70B-Instruct',
  'claude-code': CLI_AGENTS['claude-code'].defaultModel,
  codex: CLI_AGENTS.codex.defaultModel,
  opencode: CLI_AGENTS.opencode.defaultModel,
  grok: CLI_AGENTS.grok.defaultModel,
};

const loaders: Record<string, ProviderLoader> = {
  'claude-code': async model => new (await import('./cli-agent.js')).CliAgentProvider('claude-code', model),
  codex: async model => new (await import('./cli-agent.js')).CliAgentProvider('codex', model),
  opencode: async model => new (await import('./cli-agent.js')).CliAgentProvider('opencode', model),
  grok: async model => new (await import('./cli-agent.js')).CliAgentProvider('grok', model),
  bedrock: async model => new (await import('./bedrock.js')).BedrockProvider(model),
  anthropic: async model => new (await import('./anthropic.js')).AnthropicProvider(model),
  openrouter: async model => new (await import('./openrouter.js')).OpenRouterProvider(model),
  groq: async model => new (await import('./groq.js')).GroqProvider(model),
  xai: async model => new (await import('./xai.js')).XAIProvider(model),
  ollama: async model => new (await import('./ollama.js')).OllamaProvider(model),
  vllm: async model => {
    const { VLLMProvider } = await import('./vllm.js');
    const config = loadConfig();
    return new VLLMProvider(model || config.model || defaultModels.vllm, config.vllm || {});
  },
};

class LazyProvider implements Provider {
  readonly model: string;
  private resolved?: Promise<Provider>;

  constructor(readonly name: string, model: string | undefined, private readonly load: ProviderLoader) {
    this.model = model || defaultModels[name] || 'default';
  }

  private resolve(): Promise<Provider> {
    this.resolved ||= this.load(this.model);
    return this.resolved;
  }

  async *stream(messages: Message[], system: string, tools: Tool[], options?: ProviderStreamOptions): AsyncIterable<StreamEvent> {
    yield* (await this.resolve()).stream(messages, system, tools, options);
  }
}

export function getProvider(name: string, model?: string): Provider {
  // `claude-code` and `codex` used to alias onto the Anthropic/OpenRouter APIs,
  // which silently swapped a user's subscription for API billing they may not
  // have. They are now their own providers, backed by the installed CLI.
  const normalizedName = normalizeProvider(name);
  let loader = loaders[normalizedName];
  let configuredDefault: string | undefined;
  if (!loader) {
    const custom = loadConfig().providers?.[normalizedName];
    if (custom) {
      configuredDefault = custom.defaultModel;
      loader = async selected => new (await import('./openrouter.js')).OpenRouterProvider(selected, {
        name: normalizedName, apiKeyEnv: custom.apiKeyEnv, baseUrl: custom.baseUrl,
        defaultModel: custom.defaultModel, displayName: custom.displayName || normalizedName, headers: custom.headers,
      });
    }
  }
  if (!loader) {
    const customIds = Object.keys(loadConfig().providers || {});
    throw new Error(`Unknown provider: ${name}. Available: ${[...Object.keys(loaders), ...customIds].join(', ')}`);
  }
  return new LazyProvider(normalizedName, model || configuredDefault, loader);
}

export { delegateToClaudeCode, delegateToCodex } from './subprocess.js';
export type { Provider, ProviderStreamOptions, Message, StreamEvent, Tool } from './types.js';
export type { ModelDescriptor, ModelCapabilities, ProviderErrorCategory } from './types.js';
export { ProviderError, normalizeProviderError } from './types.js';
export { fetchOpenRouterModels, compatibleOpenRouterFreeModels, parseOpenRouterModels } from './catalog.js';
export { CLI_AGENTS, isCliAgentProvider, CliAgentProvider, forgetCliSession, recallCliSession } from './cli-agent.js';
export type { CliAgentId } from './cli-agent.js';
export { buildModelRegistry, invalidateModelRegistry, firstAvailable, sortEntries } from './registry.js';
export type { ModelEntry, ModelKind } from './registry.js';
