import { describe, expect, test } from 'bun:test';
import { normalizeProviderError, ProviderError } from '../src/providers/index.js';

describe('provider contract', () => {
  test('normalizes authentication, throttling, protocol, and timeout failures', () => {
    expect(normalizeProviderError('openrouter', 'API key is invalid').category).toBe('authentication');
    expect(normalizeProviderError('openrouter', 'rate limited', 429)).toMatchObject({ category: 'rate_limit', retryable: true });
    expect(normalizeProviderError('openrouter', 'malformed streaming JSON').category).toBe('protocol');
    expect(normalizeProviderError('openrouter', 'request timeout')).toMatchObject({ category: 'timeout', retryable: true });
  });

  test('preserves an already structured provider error', () => {
    const failure = new ProviderError('test', 'unavailable', 'offline', true, 503);
    expect(normalizeProviderError('other', failure)).toBe(failure);
  });
});
