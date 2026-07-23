import { describe, expect, test } from 'bun:test';
import { parseOpenRouterModels } from '../src/providers/catalog.js';

describe('dynamic model catalog', () => {
  test('normalizes and capability-filters OpenRouter metadata', () => {
    const [model] = parseOpenRouterModels({ data: [{ id: 'vendor/coder:free', name: 'Coder', context_length: 262144,
      supported_parameters: ['tools', 'reasoning', 'response_format'], architecture: { input_modalities: ['text', 'image'] },
      pricing: { prompt: '0', completion: '0' }, top_provider: { max_completion_tokens: 8192 } }] }, new Date(0));
    expect(model.id).toBe('vendor/coder:free');
    expect(model.free).toBe(true);
    expect(model.capabilities).toMatchObject({ tools: true, reasoning: true, images: true, contextWindow: 262144, maxOutputTokens: 8192 });
    expect(model.refreshedAt).toBe(new Date(0).toISOString());
  });

  test('drops malformed entries and safely defaults optional metadata', () => {
    const models = parseOpenRouterModels({ data: [null, { nope: true }, { id: 'vendor/chat' }] });
    expect(models).toHaveLength(1);
    expect(models[0].capabilities.tools).toBe(false);
    expect(models[0].capabilities.contextWindow).toBe(128000);
  });
});
