import { OpenRouterProvider } from './openrouter.js';

export const GROQ_DEFAULT_MODEL = 'qwen/qwen3-32b';

export class GroqProvider extends OpenRouterProvider {
  constructor(model?: string) {
    super(model, {
      name: 'groq',
      apiKeyEnv: 'GROQ_API_KEY',
      baseUrl: 'https://api.groq.com/openai/v1/chat/completions',
      defaultModel: GROQ_DEFAULT_MODEL,
      displayName: 'Groq',
      // Groq free-tier TPM includes requested completion tokens. Keep the
      // default low enough that ordinary coding turns do not fail before
      // streaming begins; higher account tiers can still select other models.
      maxTokens: 1_024,
    });
  }
}
