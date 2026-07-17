import { describe, test, expect } from 'bun:test';
import { parseRetryAfterMs, summarizeProviderError } from '../src/providers/openrouter.js';

function res(headers: Record<string, string> = {}): Response {
  return new Response(null, { headers });
}

describe('parseRetryAfterMs', () => {
  test('reads a numeric Retry-After header (seconds → ms)', () => {
    expect(parseRetryAfterMs(res({ 'retry-after': '27' }), '')).toBe(27_000);
  });

  test('falls back to OpenRouter retry_after_seconds in the body', () => {
    const body = '{"error":{"code":429,"metadata":{"retry_after_seconds":26.888}}}';
    expect(parseRetryAfterMs(res(), body)).toBe(26_888);
  });

  test('returns null when no hint is present', () => {
    expect(parseRetryAfterMs(res(), '{"error":"nope"}')).toBeNull();
  });
});

describe('summarizeProviderError', () => {
  test('429 message is short, actionable, and does not dump the raw body', () => {
    const big = '{"error":{"message":"Provider returned error","code":429,"metadata":{"raw":"model temporarily rate-limited upstream"}}}' + 'x'.repeat(4000);
    const msg = summarizeProviderError('OpenRouter', 429, big);
    expect(msg).toContain('rate-limited (429)');
    expect(msg).toContain('/model');
    expect(msg.length).toBeLessThan(400); // never the 2KB dump
    expect(msg).not.toContain('xxxxxxxxxx');
  });

  test('non-429 errors surface status and a short hint', () => {
    const msg = summarizeProviderError('OpenRouter', 500, '{"message":"boom"}');
    expect(msg).toContain('API error 500');
    expect(msg).toContain('boom');
  });
});
