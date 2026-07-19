import type { Message, Provider, StreamEvent, Tool } from './types.js';
import { loadConfig } from '../config.js';

type ProviderLoader = (model?: string) => Promise<Provider>;
const defaultModels: Record<string, string> = {
  bedrock: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
  anthropic: 'claude-sonnet-4-20250514',
  openrouter: 'openrouter/free',
  groq: 'openai/gpt-oss-120b',
  ollama: 'qwen2.5-coder:7b',
  vllm: 'meta-llama/Llama-3-70B-Instruct',
};

const loaders: Record<string, ProviderLoader> = {
  bedrock: async model => new (await import('./bedrock.js')).BedrockProvider(model),
  anthropic: async model => new (await import('./anthropic.js')).AnthropicProvider(model),
  openrouter: async model => new (await import('./openrouter.js')).OpenRouterProvider(model),
  groq: async model => new (await import('./groq.js')).GroqProvider(model),
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

  async *stream(messages: Message[], system: string, tools: Tool[]): AsyncIterable<StreamEvent> {
    yield* (await this.resolve()).stream(messages, system, tools);
  }
}

export function getProvider(name: string, model?: string): Provider {
  const normalizedName = name === 'codex' ? 'openrouter' : name === 'claude-code' ? 'anthropic' : name;
  const loader = loaders[normalizedName];
  if (!loader) throw new Error(`Unknown provider: ${name}. Available: ${Object.keys(loaders).join(', ')}`);
  return new LazyProvider(normalizedName, model, loader);
}

export { delegateToClaudeCode, delegateToCodex } from './subprocess.js';
export type { Provider, Message, StreamEvent, Tool } from './types.js';
