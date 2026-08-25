import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { VLLMProvider, VLLM_DEFAULT_ENDPOINT } from '../src/providers/vllm.js';
import type { StreamEvent } from '../src/providers/types.js';

const originalFetch = globalThis.fetch;
const originalKey = process.env.VLLM_API_KEY;

function responseFrom(frames: unknown[]): Response {
  const body = frames.map(frame => `data: ${typeof frame === 'string' ? frame : JSON.stringify(frame)}\r\n\r\n`).join('');
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

beforeEach(() => { delete process.env.VLLM_API_KEY; });
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.VLLM_API_KEY;
  else process.env.VLLM_API_KEY = originalKey;
});

describe('vLLM streaming', () => {
  test('parses text deltas', async () => {
    let requestUrl = '';
    let requestHeaders: HeadersInit | undefined;
    globalThis.fetch = (async (input, init) => {
      requestUrl = String(input);
      requestHeaders = init?.headers;
      return responseFrom([
        { choices: [{ delta: { content: 'OK' } }] },
        { choices: [{ delta: {}, finish_reason: 'stop' }] },
      ]);
    }) as typeof fetch;

    const events: StreamEvent[] = [];
    for await (const event of new VLLMProvider('test-model').stream([], 'system', [], undefined)) events.push(event);

    expect(requestUrl).toBe(`${VLLM_DEFAULT_ENDPOINT}/v1/chat/completions`);
    expect(new Headers(requestHeaders).has('Authorization')).toBe(false);
    expect(events).toContainEqual({ type: 'text_delta', text: 'OK' });
  });

  test('reports malformed streaming JSON', async () => {
    globalThis.fetch = (async () => responseFrom(['{bad json'])) as typeof fetch;
    const events: StreamEvent[] = [];
    for await (const event of new VLLMProvider('test-model').stream([], 'system', [], undefined)) events.push(event);
    expect(events).toContainEqual({ type: 'error', error: 'vLLM sent malformed streaming JSON' });
  });

  test('uses the configured endpoint and optional key', async () => {
    let requestUrl = '';
    let requestHeaders: HeadersInit | undefined;
    globalThis.fetch = (async (input, init) => {
      requestUrl = String(input);
      requestHeaders = init?.headers;
      return responseFrom([{ choices: [{ delta: {}, finish_reason: 'stop' }] }]);
    }) as typeof fetch;

    for await (const _ of new VLLMProvider('test-model', {
      endpoint: 'http://127.0.0.1:9000/',
      apiKey: 'local-secret',
    }).stream([], 'system', [], undefined)) { /* consume */ }

    expect(requestUrl).toBe('http://127.0.0.1:9000/v1/chat/completions');
    expect(new Headers(requestHeaders).get('Authorization')).toBe('Bearer local-secret');
  });
});
