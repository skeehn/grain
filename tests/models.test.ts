import { describe, test, expect } from 'bun:test';
import { MODEL_CATALOG, catalogWithCurrent, nextModel } from '../src/tui/models.js';

describe('model catalog', () => {
  test('starts with automatic free routing and only advertises tool-capable free models', () => {
    expect(MODEL_CATALOG[0].model).toBe('openrouter/free');
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
});
