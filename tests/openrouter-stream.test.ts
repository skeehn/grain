import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { OpenRouterProvider, OPENROUTER_FREE_MODEL, OPENROUTER_POOL_MODEL } from '../src/providers/openrouter.js';
import { getProvider } from '../src/providers/index.js';
import type { StreamEvent } from '../src/providers/types.js';
import { resetModelCatalogCache } from '../src/providers/catalog.js';

const originalFetch = globalThis.fetch;
const originalKey = process.env.OPENROUTER_API_KEY;

function responseFrom(frames: unknown[]): Response {
  const body = frames.map(frame => `data: ${typeof frame === 'string' ? frame : JSON.stringify(frame)}\r\n\r\n`).join('');
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

beforeEach(() => { process.env.OPENROUTER_API_KEY = 'test-key'; resetModelCatalogCache(); });
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

  test('routes coding turns through an explicit compatible free fallback pool', async () => {
    let requestBody: any;
    globalThis.fetch = (async (input, init) => {
      if (String(input).endsWith('/models')) return Response.json({ data: [
        { id: 'openai/gpt-oss-20b:free', context_length: 131072,
          pricing: { prompt: '0', completion: '0' }, supported_parameters: ['tools', 'tool_choice'] },
        { id: OPENROUTER_POOL_MODEL, context_length: 262144,
          pricing: { prompt: '0', completion: '0' }, supported_parameters: ['tools', 'tool_choice'] },
        { id: 'chat-only/free:free', context_length: 262144,
          pricing: { prompt: '0', completion: '0' }, supported_parameters: [] },
        { id: 'zeta/coder:free', context_length: 262144,
          pricing: { prompt: '0', completion: '0' }, supported_parameters: ['tools'] },
        { id: 'alpha/coder:free', context_length: 262144,
          pricing: { prompt: '0', completion: '0' }, supported_parameters: ['tools'] },
      ] });
      requestBody = JSON.parse(String(init?.body));
      return responseFrom([{ model: OPENROUTER_POOL_MODEL, choices: [{ delta: {}, finish_reason: 'stop' }] }]);
    }) as typeof fetch;

    const tool = { name: 'bash', description: 'run a command', input_schema: { type: 'object' } };
    for await (const _event of new OpenRouterProvider().stream([], 'system', [tool])) { /* consume */ }

    expect(requestBody.model).toBeUndefined();
    expect(requestBody.models).toEqual([OPENROUTER_POOL_MODEL, 'alpha/coder:free', 'openai/gpt-oss-20b:free']);
    expect(requestBody.models).toHaveLength(3);
    expect(requestBody.route).toBe('fallback');
    expect(requestBody.tool_choice).toBe('auto');
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

  test('refuses to call the API without a key', async () => {
    delete process.env.OPENROUTER_API_KEY;
    let called = false;
    globalThis.fetch = (async () => { called = true; return responseFrom([]); }) as typeof fetch;
    const events: StreamEvent[] = [];
    for await (const event of new OpenRouterProvider().stream([], 'system', [])) events.push(event);
    expect(called).toBe(false);
    expect(events).toContainEqual({
      type: 'error',
      error: 'OPENROUTER_API_KEY is not set. Run: grain config set key OPENROUTER_API_KEY <key>',
    });
  });

  test('yields reasoning tokens so the harness is not idle while the model thinks', async () => {
    globalThis.fetch = (async () => responseFrom([
      { choices: [{ delta: { reasoning: 'plan the edit' } }] },
      { choices: [{ delta: { content: 'done' }, finish_reason: 'stop' }] },
    ])) as typeof fetch;
    const events: StreamEvent[] = [];
    for await (const event of new OpenRouterProvider().stream([], 'system', [])) events.push(event);
    expect(events).toContainEqual({ type: 'reasoning_delta', text: 'plan the edit' });
    expect(events).toContainEqual({ type: 'text_delta', text: 'done' });
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

  test('reports the actual fallback model selected by OpenRouter', async () => {
    globalThis.fetch = (async () => responseFrom([
      { model: 'fallback/coder:free', choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] },
    ])) as typeof fetch;
    const events: StreamEvent[] = [];
    for await (const event of new OpenRouterProvider('requested/coder:free').stream([], 'system', [])) events.push(event);
    expect(events).toContainEqual({ type: 'model_selected', provider: 'openrouter', requested_model: 'requested/coder:free',
      selected_model: 'fallback/coder:free', fallback: true });
  });

  test('propagates harness cancellation into the provider request', async () => {
    const controller = new AbortController(); let requestSignal: AbortSignal | undefined;
    globalThis.fetch = (async (_input, init) => {
      requestSignal = init?.signal as AbortSignal;
      return await new Promise<Response>((_resolve, reject) => requestSignal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    }) as typeof fetch;
    const events: StreamEvent[] = [];
    const consuming = (async () => { for await (const event of new OpenRouterProvider().stream([], 'system', [], { signal: controller.signal })) events.push(event); })();
    await new Promise(resolve => setTimeout(resolve, 0)); controller.abort(); await consuming;
    expect(requestSignal?.aborted).toBe(true);
    expect(events.some(event => event.type === 'error' && /abort/i.test(event.error))).toBe(true);
  });
});
