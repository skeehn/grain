import { OpenRouterProvider } from './openrouter.js';

export const XAI_DEFAULT_MODEL = 'grok-code-fast-1';

/** xAI exposes an OpenAI-compatible streaming/tool API. */
export class XAIProvider extends OpenRouterProvider {
  constructor(model?: string) {
    super(model, { name: 'xai', apiKeyEnv: 'XAI_API_KEY', baseUrl: 'https://api.x.ai/v1/chat/completions',
      defaultModel: XAI_DEFAULT_MODEL, displayName: 'xAI' });
  }
}
