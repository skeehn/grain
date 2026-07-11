import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { GroqProvider, GROQ_DEFAULT_MODEL } from '../src/providers/groq.js';
import type { StreamEvent } from '../src/providers/types.js';

const originalFetch = globalThis.fetch;
const originalKey = process.env.GROQ_API_KEY;

beforeEach(() => { process.env.GROQ_API_KEY = 'test-key'; });
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.GROQ_API_KEY;
  else process.env.GROQ_API_KEY = originalKey;
});

describe('Groq streaming', () => {
  test('uses a tool-capable coding default and Groq endpoint', async () => {
    let requestUrl = '';
    let requestBody: any;
    globalThis.fetch = (async (input, init) => {
      requestUrl = String(input);
      requestBody = JSON.parse(String(init?.body));
      return new Response('data: {"choices":[{"delta":{"content":"OK"},"finish_reason":"stop"}]}\n\n', { status: 200 });
    }) as typeof fetch;

    const provider = new GroqProvider();
    const events: StreamEvent[] = [];
    for await (const event of provider.stream([], 'system', [])) events.push(event);

    expect(provider.name).toBe('groq');
    expect(provider.model).toBe(GROQ_DEFAULT_MODEL);
    expect(requestUrl).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(requestBody.max_tokens).toBe(1_024);
    expect(events).toContainEqual({ type: 'text_delta', text: 'OK' });
  });

  test('reports Groq parser failures explicitly', async () => {
    globalThis.fetch = (async () => new Response('data: {bad}\n\n', { status: 200 })) as typeof fetch;
    const events: StreamEvent[] = [];
    for await (const event of new GroqProvider().stream([], 'system', [])) events.push(event);
    expect(events).toContainEqual({ type: 'error', error: 'Groq sent malformed streaming JSON' });
  });
});
