import { describe, test, expect } from 'bun:test';
import { MODEL_CATALOG, catalogWithCurrent, nextModel, resolveModelSelection } from '../src/tui/models.js';

describe('model catalog', () => {
  test('leads with subscription agents so a user without API credit can still work', () => {
    expect(MODEL_CATALOG[0].provider).toBe('claude-code');
    expect(MODEL_CATALOG.some(c => c.provider === 'codex')).toBe(true);
    expect(MODEL_CATALOG.some(c => c.provider === 'grok')).toBe(true);
    expect(MODEL_CATALOG.some(c => c.provider === 'xai')).toBe(true);
    expect(MODEL_CATALOG.some(c => c.model === 'openrouter/free')).toBe(true);
    expect(MODEL_CATALOG.some(c => c.model === 'nousresearch/hermes-3-llama-3.1-405b:free')).toBe(false);
  });

  test('marks the active model as current', () => {
    const list = catalogWithCurrent('openrouter', 'qwen/qwen3-coder:free');
    const current = list.filter(c => c.current);
    expect(current.length).toBe(1);
    expect(current[0].model).toBe('qwen/qwen3-coder:free');
  });

  test('prepends an unknown active model so it stays visible/selectable', () => {
    const list = catalogWithCurrent('openrouter', 'some/custom-model:free');
    expect(list[0].model).toBe('some/custom-model:free');
    expect(list[0].current).toBe(true);
    expect(list.length).toBe(MODEL_CATALOG.length + 1);
  });

  test('nextModel cycles through the catalog and wraps', () => {
    const first = MODEL_CATALOG[0];
    const second = nextModel(first.provider, first.model);
    expect(second.model).toBe(MODEL_CATALOG[1].model);
    const last = MODEL_CATALOG[MODEL_CATALOG.length - 1];
    expect(nextModel(last.provider, last.model).model).toBe(MODEL_CATALOG[0].model); // wraps
  });

  test('nextModel from an unknown model starts at the top of the catalog', () => {
    expect(nextModel('x', 'y').model).toBe(MODEL_CATALOG[0].model);
  });

  test('model selection switches providers explicitly or through the catalog', () => {
    expect(resolveModelSelection('openrouter:qwen/qwen3-coder:free', 'anthropic')).toEqual({ provider: 'openrouter', model: 'qwen/qwen3-coder:free' });
    expect(resolveModelSelection('openrouter/free', 'anthropic')).toEqual({ provider: 'openrouter', model: 'openrouter/free' });
    expect(resolveModelSelection('custom/model', 'vllm')).toEqual({ provider: 'vllm', model: 'custom/model' });
  });

  test('reaches every provider Grain supports, not a hardcoded subset', () => {
    // xai and the CLI-agent providers used to fall through the old whitelist
    // and were silently reinterpreted as a model id on the current provider.
    expect(resolveModelSelection('xai:grok-code-fast-1', 'openrouter')).toEqual({ provider: 'xai', model: 'grok-code-fast-1' });
    expect(resolveModelSelection('claude-code:opus', 'openrouter')).toEqual({ provider: 'claude-code', model: 'opus' });
    expect(resolveModelSelection('codex', 'openrouter')).toEqual({ provider: 'codex', model: 'auto' });
    expect(resolveModelSelection('grok', 'openrouter')).toEqual({ provider: 'grok', model: 'auto' });
    expect(resolveModelSelection('grokbot', 'openrouter')).toEqual({ provider: 'grok', model: 'auto' });
    expect(resolveModelSelection('xai', 'openrouter')).toEqual({ provider: 'xai', model: 'grok-code-fast-1' });
    expect(resolveModelSelection('openrouter', 'codex')).toEqual({ provider: 'openrouter', model: 'openrouter/free' });
    expect(resolveModelSelection('claude', 'openrouter')).toEqual({ provider: 'claude-code', model: 'auto' });
  });

  test('keeps colons that belong to the model id itself', () => {
    expect(resolveModelSelection('qwen2.5-coder:7b', 'ollama')).toEqual({ provider: 'ollama', model: 'qwen2.5-coder:7b' });
    expect(resolveModelSelection('us.anthropic.claude-sonnet-4-5-20250929-v1:0', 'bedrock'))
      .toEqual({ provider: 'bedrock', model: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0' });
  });
});
