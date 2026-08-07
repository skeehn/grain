import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { VLLMProvider } from '../src/providers/vllm.js';
import type { StreamEvent } from '../src/providers/types.js';

const originalFetch = globalThis.fetch;

function responseFrom(frames: unknown[]): Response {
  const body = frames.map(frame => `data: ${typeof frame === 'string' ? frame : JSON.stringify(frame)}\r\n\r\n`).join('');
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

beforeEach(() => { /* noop */ });
afterEach(() => { globalThis.fetch = originalFetch; });

describe('vLLM streaming', () => {
  test('parses text deltas', async () => {
    globalThis.fetch = (async () => responseFrom([
      { choices: [{ delta: { content: 'OK' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
    ])) as typeof fetch;

    const events: StreamEvent[] = [];
    for await (const event of new VLLMProvider('test-model').stream([], 'system', [], undefined)) events.push(event);

    expect(events).toContainEqual({ type: 'text_delta', text: 'OK' });
  });

  test('reports malformed streaming JSON', async () => {
    globalThis.fetch = (async () => responseFrom(['{bad json'])) as typeof fetch;
    const events: StreamEvent[] = [];
    for await (const event of new VLLMProvider('test-model').stream([], 'system', [], undefined)) events.push(event);
    expect(events).toContainEqual({ type: 'error', error: 'vLLM sent malformed streaming JSON' });
  });
});
