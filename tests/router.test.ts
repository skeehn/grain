import { describe, test, expect } from 'bun:test';
import {
  TaskComplexity,
  classifyTaskComplexity,
  resolveModelAlias,
  routeModel,
  estimateCost,
  explainRouting,
  MODEL_CONFIGS,
} from '../src/router/index.js';

describe('classifyTaskComplexity', () => {
  test('trivial: read/show/list prompts', () => {
    expect(classifyTaskComplexity('show me the readme')).toBe(TaskComplexity.TRIVIAL);
    expect(classifyTaskComplexity('list files in src')).toBe(TaskComplexity.TRIVIAL);
    expect(classifyTaskComplexity('what is 2+2')).toBe(TaskComplexity.TRIVIAL);
  });

  test('critical: security and payment prompts', () => {
    expect(classifyTaskComplexity('rotate the auth token')).toBe(TaskComplexity.CRITICAL);
    expect(classifyTaskComplexity('fix the stripe payment flow')).toBe(TaskComplexity.CRITICAL);
    expect(classifyTaskComplexity('deploy to production')).toBe(TaskComplexity.CRITICAL);
  });

  test('complex: architecture and rewrites', () => {
    expect(classifyTaskComplexity('design the api architecture')).toBe(TaskComplexity.COMPLEX);
    expect(classifyTaskComplexity('build a landing website for my startup')).toBe(TaskComplexity.COMPLEX);
  });

  test('critical wins over complex when both match', () => {
    expect(classifyTaskComplexity('refactor entire auth architecture')).toBe(TaskComplexity.CRITICAL);
  });

  test('short unmatched prompts fall back to trivial', () => {
    expect(classifyTaskComplexity('do the thing')).toBe(TaskComplexity.TRIVIAL);
  });

  test('long prompts classify as complex', () => {
    const long = Array(120).fill('word').join(' ');
    expect(classifyTaskComplexity(long)).toBe(TaskComplexity.COMPLEX);
  });
});

describe('resolveModelAlias', () => {
  test('maps Poolside convenience aliases', () => {
    expect(resolveModelAlias('pool')).toBe('poolside');
    expect(resolveModelAlias('laguna')).toBe('poolside');
  });
  test('resolves known aliases case-insensitively', () => {
    expect(resolveModelAlias('SONNET4-6')).toBe('sonnet');
    expect(resolveModelAlias('fast')).toBe('haiku');
    expect(resolveModelAlias('best')).toBe('opus');
  });

  test('returns undefined for unknown alias', () => {
    expect(resolveModelAlias('gpt-4')).toBeUndefined();
  });
});

describe('routeModel', () => {
  test('routes complexity tiers to expected models', () => {
    expect(routeModel(TaskComplexity.TRIVIAL).label).toBe(MODEL_CONFIGS['haiku'].label);
    expect(routeModel(TaskComplexity.MODERATE).label).toBe(MODEL_CONFIGS['sonnet'].label);
    expect(routeModel(TaskComplexity.CRITICAL).label).toBe(MODEL_CONFIGS['opus'].label);
  });

  test('forceModel accepts alias and direct key', () => {
    expect(routeModel(TaskComplexity.MODERATE, { forceModel: 'best' })).toBe(MODEL_CONFIGS['opus']);
    expect(routeModel(TaskComplexity.MODERATE, { forceModel: 'haiku' })).toBe(MODEL_CONFIGS['haiku']);
  });

  test('unknown forceModel falls back to complexity routing', () => {
    expect(routeModel(TaskComplexity.MODERATE, { forceModel: 'nonexistent' })).toBe(MODEL_CONFIGS['sonnet']);
  });

  test('preferCheap overrides complexity', () => {
    expect(routeModel(TaskComplexity.COMPLEX, { preferCheap: true })).toBe(MODEL_CONFIGS['haiku']);
  });
});

describe('estimateCost', () => {
  test('computes per-million pricing', () => {
    const cost = estimateCost(1_000_000, 1_000_000, MODEL_CONFIGS['sonnet']);
    expect(cost).toBeCloseTo(3.0 + 15.0);
  });

  test('zero tokens cost zero', () => {
    expect(estimateCost(0, 0, MODEL_CONFIGS['opus'])).toBe(0);
  });
});

describe('explainRouting', () => {
  test('returns a non-empty explanation for every tier', () => {
    for (const c of Object.values(TaskComplexity)) {
      const text = explainRouting(c, MODEL_CONFIGS['sonnet']);
      expect(text.length).toBeGreaterThan(0);
      expect(text).toContain(MODEL_CONFIGS['sonnet'].label);
    }
  });
});
