export interface Provider {
  name: string;
  model: string;
  stream(messages: Message[], system: string, tools: Tool[], options?: ProviderStreamOptions): AsyncIterable<StreamEvent>;
}

export interface ProviderStreamOptions { signal?: AbortSignal; }

export interface ModelCapabilities {
  contextWindow: number;
  maxOutputTokens: number;
  tools: boolean;
  parallelTools: boolean;
  images: boolean;
  reasoning: boolean;
  structuredOutput: boolean;
  promptCaching: boolean;
  tokenAccounting: boolean;
}

export interface ModelDescriptor {
  provider: string;
  id: string;
  displayName: string;
  capabilities: ModelCapabilities;
  inputPricePerMillion?: number;
  outputPricePerMillion?: number;
  free?: boolean;
  source: 'builtin' | 'remote' | 'custom';
  refreshedAt: string;
}

export type ProviderErrorCategory = 'authentication' | 'rate_limit' | 'unavailable' | 'invalid_request' | 'protocol' | 'timeout' | 'aborted';

export class ProviderError extends Error {
  readonly name = 'ProviderError';
  constructor(
    readonly provider: string,
    readonly category: ProviderErrorCategory,
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
    readonly userAction?: string,
  ) { super(message); }
}

export function normalizeProviderError(provider: string, error: unknown, status?: number): ProviderError {
  if (error instanceof ProviderError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (/abort|cancel/i.test(message)) return new ProviderError(provider, 'aborted', message, false, status);
  if (/timed? ?out|timeout/i.test(message)) return new ProviderError(provider, 'timeout', message, true, status);
  if (status === 401 || status === 403 || /api.?key|unauthori|authenticat/i.test(message)) {
    return new ProviderError(provider, 'authentication', message, false, status, `Check ${provider} credentials.`);
  }
  if (status === 429 || /rate.?limit|quota|throttl/i.test(message)) return new ProviderError(provider, 'rate_limit', message, true, status);
  if ((status !== undefined && status >= 500) || /unavailable|overloaded|bad gateway/i.test(message)) {
    return new ProviderError(provider, 'unavailable', message, true, status);
  }
  if (/json|protocol|stream|tool call/i.test(message)) return new ProviderError(provider, 'protocol', message, false, status);
  return new ProviderError(provider, 'invalid_request', message, false, status);
}

export type StreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'reasoning_delta'; text: string }
  | { type: 'tool_use_start'; id: string; name: string }
  | { type: 'tool_use_delta'; id: string; input_json: string }
  | { type: 'tool_use_end'; id: string }
  | { type: 'message_end'; stop_reason: string }
  | { type: 'usage'; input_tokens: number; output_tokens: number; cache_read_tokens?: number; reasoning_tokens?: number; cost_usd?: number }
  | { type: 'retry'; attempt: number; max: number; seconds: number }
  | { type: 'model_selected'; provider: string; requested_model: string; selected_model: string; fallback: boolean }
  | { type: 'error'; error: string };

export interface Message {
  role: 'user' | 'assistant';
  content: ContentBlock[];
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; media_type: string; data: string; name?: string }
  | { type: 'tool_use'; id: string; name: string; input: any }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

export interface Tool {
  name: string;
  description: string;
  input_schema: Record<string, any>;
}

export interface ToolResult {
  content: string;
  is_error?: boolean;
}

/** A tool definition bundled with its own executor (used by spawn_agent). */
export interface ExecutableTool extends Tool {
  execute(input: any): Promise<ToolResult>;
}
