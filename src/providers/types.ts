export interface Provider {
  name: string;
  model: string;
  stream(messages: Message[], system: string, tools: Tool[]): AsyncIterable<StreamEvent>;
}

export type StreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_use_start'; id: string; name: string }
  | { type: 'tool_use_delta'; id: string; input_json: string }
  | { type: 'tool_use_end'; id: string }
  | { type: 'message_end'; stop_reason: string }
  | { type: 'usage'; input_tokens: number; output_tokens: number; cache_read_tokens?: number; reasoning_tokens?: number; cost_usd?: number }
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
