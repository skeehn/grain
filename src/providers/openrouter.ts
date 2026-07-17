import type { Provider, Message, Tool, StreamEvent } from './types.js';

export const OPENROUTER_POOL_MODEL = 'poolside/laguna-xs-2.1';
const DEFAULT_MODEL = 'anthropic/claude-sonnet-4';
const BASE_URL = 'https://openrouter.ai/api/v1/chat/completions';
const STREAM_IDLE_TIMEOUT_MS = 90_000;
// Free/community models throttle constantly (429) and upstream providers flap
// (502/503). Retry a bounded number of times BEFORE any content has streamed,
// honoring the provider's Retry-After when it's short enough to be worth waiting.
const MAX_TRANSIENT_RETRIES = 3;
const MAX_RETRY_WAIT_MS = 30_000;

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** Retry delay (ms) from a 429/503 — Retry-After header or OpenRouter's
 *  `retry_after_seconds` body field. Null when the response gives no hint. */
export function parseRetryAfterMs(res: Response, bodyText: string): number | null {
  const header = res.headers.get('retry-after');
  if (header) { const s = Number(header); if (Number.isFinite(s)) return Math.max(0, s * 1000); }
  const m = bodyText.match(/"retry_after_seconds(?:_raw)?"\s*:\s*([\d.]+)/);
  if (m) return Math.max(0, Math.round(Number(m[1]) * 1000));
  return null;
}

/** Collapse a raw provider error body into a short human message — never dump
 *  the full 2KB JSON (which also risks leaking keys/PII into logs/engram). */
export function summarizeProviderError(name: string, status: number, bodyText: string): string {
  const raw = bodyText.match(/"raw"\s*:\s*"([^"]{0,180})/)?.[1];
  const msg = bodyText.match(/"message"\s*:\s*"([^"]{0,180})/)?.[1];
  const hint = (raw || msg || bodyText.slice(0, 160)).trim();
  if (status === 429) return `${name} rate-limited (429). ${hint} — try again shortly or switch model with /model <name>.`.trim();
  return `${name} API error ${status}: ${hint}`.trim();
}

export interface OpenAICompatibleOptions {
  name: string;
  apiKeyEnv: string;
  baseUrl: string;
  defaultModel: string;
  displayName: string;
  headers?: Record<string, string>;
  maxTokens?: number;
}

const OPENROUTER_OPTIONS: OpenAICompatibleOptions = {
  name: 'openrouter', apiKeyEnv: 'OPENROUTER_API_KEY', baseUrl: BASE_URL,
  defaultModel: DEFAULT_MODEL, displayName: 'OpenRouter',
  headers: { 'HTTP-Referer': 'https://github.com/skeehn/grain', 'X-Title': 'Grain' },
};

type ToolState = { id: string; name: string; started: boolean; ended: boolean };

export class OpenRouterProvider implements Provider {
  name: string;
  model: string;
  private apiKey: string;
  private options: OpenAICompatibleOptions;

  constructor(model?: string, options: OpenAICompatibleOptions = OPENROUTER_OPTIONS) {
    this.options = options;
    this.name = options.name;
    this.model = model || options.defaultModel;
    this.apiKey = process.env[options.apiKeyEnv] || '';
  }

  private convertMessages(messages: Message[]): unknown[] {
    const result: unknown[] = [];
    for (const message of messages) {
      const text: string[] = [];
      const calls: unknown[] = [];
      const results: unknown[] = [];
      for (const block of message.content) {
        if (block.type === 'text') text.push(block.text);
        if (block.type === 'image') text.push(`[Image attachment retained locally: ${block.name || block.media_type}]`);
        if (block.type === 'tool_use') calls.push({
          id: block.id,
          type: 'function',
          function: { name: block.name, arguments: JSON.stringify(block.input) },
        });
        if (block.type === 'tool_result') results.push({
          role: 'tool', tool_call_id: block.tool_use_id, content: block.content,
        });
      }
      if (calls.length) result.push({ role: 'assistant', content: text.join('') || null, tool_calls: calls });
      else if (results.length) result.push(...results);
      else result.push({ role: message.role, content: text.join('') });
    }
    return result;
  }

  async *stream(messages: Message[], system: string, tools: Tool[]): AsyncIterable<StreamEvent> {
    if (!this.apiKey) {
      yield { type: 'error', error: `${this.options.apiKeyEnv} is not set. Run: grain config set key ${this.options.apiKeyEnv} <key>` };
      return;
    }

    const body: Record<string, unknown> = {
      model: this.model,
      messages: [{ role: 'system', content: system }, ...this.convertMessages(messages)],
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: this.options.maxTokens ?? 16_384,
    };
    if (tools.length) body.tools = tools.map(tool => ({
      type: 'function',
      function: { name: tool.name, description: tool.description, parameters: tool.input_schema },
    }));

    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refreshTimeout = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => controller.abort(), STREAM_IDLE_TIMEOUT_MS);
    };

    try {
      let response: Response;
      for (let attempt = 0; ; attempt++) {
        refreshTimeout();
        response = await fetch(this.options.baseUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
            ...this.options.headers,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (response.ok) break;
        const bodyText = (await response.text()).slice(0, 2_000);
        const transient = response.status === 429 || response.status === 502 || response.status === 503;
        if (transient && attempt < MAX_TRANSIENT_RETRIES) {
          // Honor Retry-After when short; otherwise exponential backoff.
          const backoff = parseRetryAfterMs(response, bodyText) ?? Math.min(MAX_RETRY_WAIT_MS, 1000 * 2 ** attempt);
          if (backoff <= MAX_RETRY_WAIT_MS) { await sleep(backoff); continue; }
        }
        if (timer) clearTimeout(timer);
        yield { type: 'error', error: summarizeProviderError(this.options.displayName, response.status, bodyText) };
        return;
      }
      const reader = response.body?.getReader();
      if (!reader) {
        yield { type: 'error', error: `${this.options.displayName} returned an empty response body` };
        return;
      }

      const decoder = new TextDecoder();
      const states = new Map<number, ToolState>();
      let buffer = '';
      let ended = false;
      const endTools = function* (): Generator<StreamEvent> {
        for (const state of states.values()) if (state.started && !state.ended) {
          state.ended = true;
          yield { type: 'tool_use_end', id: state.id };
        }
      };

      while (!ended) {
        const next = await reader.read();
        if (next.done) { buffer += decoder.decode(); break; }
        refreshTimeout();
        buffer += decoder.decode(next.value, { stream: true });
        const frames = buffer.split(/\r?\n\r?\n/);
        buffer = frames.pop() || '';

        for (const frame of frames) {
          const data = frame.split(/\r?\n/)
            .filter(line => line.startsWith('data:'))
            .map(line => line.slice(5).trimStart()).join('\n');
          if (!data) continue;
          if (data === '[DONE]') {
            yield* endTools();
            yield { type: 'message_end', stop_reason: states.size ? 'tool_use' : 'end_turn' };
            ended = true;
            break;
          }

          let parsed: any;
          try { parsed = JSON.parse(data); }
          catch {
            yield { type: 'error', error: `${this.options.displayName} sent malformed streaming JSON` };
            return;
          }
          if (parsed.error) {
            yield { type: 'error', error: parsed.error.message || JSON.stringify(parsed.error) };
            return;
          }
          if (parsed.usage) {
            yield { type: 'usage', input_tokens: parsed.usage.prompt_tokens || 0,
              output_tokens: parsed.usage.completion_tokens || 0,
              reasoning_tokens: parsed.usage.completion_tokens_details?.reasoning_tokens,
              cost_usd: parsed.usage.cost };
          }

          const choice = parsed.choices?.[0];
          const delta = choice?.delta;
          if (typeof delta?.content === 'string' && delta.content) yield { type: 'text_delta', text: delta.content };
          for (const call of delta?.tool_calls || []) {
            const index = Number.isInteger(call.index) ? call.index : 0;
            const state = states.get(index) || {
              id: call.id || `tool_${index}_${Date.now()}`,
              name: call.function?.name || '', started: false, ended: false,
            };
            if (call.id) state.id = call.id;
            if (call.function?.name) state.name = call.function.name;
            states.set(index, state);
            if (!state.started && state.name) {
              state.started = true;
              yield { type: 'tool_use_start', id: state.id, name: state.name };
            }
            if (call.function?.arguments) {
              if (!state.started) {
                yield { type: 'error', error: `${this.options.displayName} streamed arguments before a tool name at index ${index}` };
                return;
              }
              yield { type: 'tool_use_delta', id: state.id, input_json: call.function.arguments };
            }
          }
          if (choice?.finish_reason) {
            yield* endTools();
            yield { type: 'message_end', stop_reason: choice.finish_reason === 'tool_calls' ? 'tool_use' : choice.finish_reason };
            ended = true;
            break;
          }
        }
      }
      if (!ended) {
        yield* endTools();
        yield { type: 'message_end', stop_reason: states.size ? 'tool_use' : 'end_turn' };
      }
    } catch (error: any) {
      yield {
        type: 'error',
        error: error?.name === 'AbortError'
          ? `${this.options.displayName} stream timed out after ${STREAM_IDLE_TIMEOUT_MS / 1_000}s of inactivity`
          : `${this.options.displayName} request failed: ${error?.message || error}`,
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
