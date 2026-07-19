import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { OpenRouterProvider, OPENROUTER_FREE_MODEL, OPENROUTER_POOL_MODEL } from '../src/providers/openrouter.js';
import { getProvider } from '../src/providers/index.js';
import type { StreamEvent } from '../src/providers/types.js';

const originalFetch = globalThis.fetch;
const originalKey = process.env.OPENROUTER_API_KEY;

function responseFrom(frames: unknown[]): Response {
  const body = frames.map(frame => `data: ${typeof frame === 'string' ? frame : JSON.stringify(frame)}\r\n\r\n`).join('');
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

beforeEach(() => { process.env.OPENROUTER_API_KEY = 'test-key'; });
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = originalKey;
});

describe('OpenRouter streaming', () => {
  test('uses the canonical Poolside model slug', () => {
    expect(OPENROUTER_POOL_MODEL).toBe('poolside/laguna-xs-2.1:free');
  });

  test('defaults to OpenRouter free automatic routing', () => {
    expect(new OpenRouterProvider().model).toBe(OPENROUTER_FREE_MODEL);
    expect(getProvider('openrouter').model).toBe(OPENROUTER_FREE_MODEL);
    expect(getProvider('groq').model).toBe('openai/gpt-oss-120b');
  });

  test('adds automatic free fallback after a specifically selected free model', async () => {
    let requestBody: any;
    globalThis.fetch = (async (_input, init) => {
      requestBody = JSON.parse(String(init?.body));
      return responseFrom([{ choices: [{ delta: {}, finish_reason: 'stop' }] }]);
    }) as typeof fetch;

    for await (const _event of new OpenRouterProvider('qwen/qwen3-coder:free').stream(
      [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }], 'system', [],
    )) { /* consume */ }

    expect(requestBody.model).toBe('qwen/qwen3-coder:free');
    expect(requestBody.models).toEqual([OPENROUTER_FREE_MODEL]);
  });

  test('does not silently replace a selected paid model', async () => {
    let requestBody: any;
    globalThis.fetch = (async (_input, init) => {
      requestBody = JSON.parse(String(init?.body));
      return responseFrom([{ choices: [{ delta: {}, finish_reason: 'stop' }] }]);
    }) as typeof fetch;

    for await (const _event of new OpenRouterProvider('anthropic/claude-sonnet-4.5').stream(
      [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }], 'system', [],
    )) { /* consume */ }

    expect(requestBody.models).toBeUndefined();
  });

  test('keeps interleaved parallel tool calls associated by index', async () => {
    globalThis.fetch = (async () => responseFrom([
      { choices: [{ delta: { tool_calls: [
        { index: 0, id: 'call_a', function: { name: 'read', arguments: '{"pa' } },
        { index: 1, id: 'call_b', function: { name: 'grep', arguments: '{"pat' } },
      ] } }] },
      { choices: [{ delta: { tool_calls: [
        { index: 1, function: { arguments: 'tern":"TODO"}' } },
        { index: 0, function: { arguments: 'th":"README.md"}' } },
      ] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    ])) as typeof fetch;

    const events: StreamEvent[] = [];
    for await (const event of new OpenRouterProvider(OPENROUTER_POOL_MODEL).stream(
      [{ role: 'user', content: [{ type: 'text', text: 'inspect' }] }], 'system', [],
    )) events.push(event);

    expect(events).toContainEqual({ type: 'tool_use_start', id: 'call_a', name: 'read' });
    expect(events).toContainEqual({ type: 'tool_use_start', id: 'call_b', name: 'grep' });
    expect(events.filter(e => e.type === 'tool_use_delta' && e.id === 'call_a').map(e => (e as any).input_json).join(''))
      .toBe('{"path":"README.md"}');
    expect(events.filter(e => e.type === 'tool_use_delta' && e.id === 'call_b').map(e => (e as any).input_json).join(''))
      .toBe('{"pattern":"TODO"}');
    expect(events.filter(e => e.type === 'tool_use_end')).toHaveLength(2);
  });

  test('surfaces malformed stream data instead of silently dropping it', async () => {
    globalThis.fetch = (async () => responseFrom(['{bad json'])) as typeof fetch;
    const events: StreamEvent[] = [];
    for await (const event of new OpenRouterProvider().stream([], 'system', [])) events.push(event);
    expect(events).toContainEqual({ type: 'error', error: 'OpenRouter sent malformed streaming JSON' });
  });

  test('normalizes streamed usage for trajectory cost accounting', async () => {
    globalThis.fetch = (async () => responseFrom([
      { usage: { prompt_tokens: 12, completion_tokens: 5, cost: 0.0002 }, choices: [{ delta: {}, finish_reason: 'stop' }] },
    ])) as typeof fetch;
    const events: StreamEvent[] = [];
    for await (const event of new OpenRouterProvider().stream([], 'system', [])) events.push(event);
    expect(events).toContainEqual({ type: 'usage', input_tokens: 12, output_tokens: 5,
      reasoning_tokens: undefined, cost_usd: 0.0002 });
  });
});
