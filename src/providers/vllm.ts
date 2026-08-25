import { OpenRouterProvider } from './openrouter.js';

export const VLLM_DEFAULT_MODEL = 'meta-llama/Llama-3-70B-Instruct';
export const VLLM_DEFAULT_ENDPOINT = 'http://localhost:8000';

export interface VLLMConfig {
  endpoint?: string;
  apiKey?: string;
}

function completionsUrl(endpoint?: string): string {
  const root = (endpoint || VLLM_DEFAULT_ENDPOINT).replace(/\/+$/, '');
  return root.endsWith('/v1/chat/completions') ? root : `${root}/v1/chat/completions`;
}

/** Local vLLM (or any OpenAI-compatible server) — no key required. */
export class VLLMProvider extends OpenRouterProvider {
  constructor(model?: string, config: VLLMConfig = {}) {
    super(model, {
      name: 'vllm',
      apiKeyEnv: 'VLLM_API_KEY',
      baseUrl: completionsUrl(config.endpoint),
      defaultModel: VLLM_DEFAULT_MODEL,
      displayName: 'vLLM',
      apiKey: config.apiKey,
      allowEmptyApiKey: true,
    });
  }
}
