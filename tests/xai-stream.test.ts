import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { XAI_DEFAULT_MODEL, XAIProvider } from '../src/providers/xai.js';
import type { StreamEvent } from '../src/providers/types.js';

const originalFetch = globalThis.fetch; const originalKey = process.env.XAI_API_KEY;
beforeEach(() => { process.env.XAI_API_KEY = 'test-key'; });
afterEach(() => { globalThis.fetch = originalFetch; if (originalKey === undefined) delete process.env.XAI_API_KEY; else process.env.XAI_API_KEY = originalKey; });

describe('xAI/Grok provider', () => {
  test('uses xAI OpenAI-compatible streaming and preserves tool calls', async () => {
    let url = ''; let body: any;
    globalThis.fetch = (async (input, init) => { url = String(input); body = JSON.parse(String(init?.body));
      return new Response([
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"read","arguments":"{\\"path\\":\\"README.md\\"}"}}]},"finish_reason":null}]}',
        'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}', 'data: [DONE]', '',
      ].join('\n\n'), { status: 200 }); }) as typeof fetch;
    const provider = new XAIProvider(); const events: StreamEvent[] = [];
    for await (const event of provider.stream([], 'system', [{ name: 'read', description: 'read file', input_schema: { type: 'object' } }])) events.push(event);
    expect(provider.name).toBe('xai'); expect(provider.model).toBe(XAI_DEFAULT_MODEL);
    expect(url).toBe('https://api.x.ai/v1/chat/completions'); expect(body.model).toBe(XAI_DEFAULT_MODEL);
    expect(events).toContainEqual({ type: 'tool_use_start', id: 'call-1', name: 'read' });
    expect(events.some(event => event.type === 'tool_use_end')).toBe(true);
  });
});
