import type { Provider, Message, Tool, StreamEvent, ContentBlock } from './types.js';

const DEFAULT_MODEL = 'anthropic/claude-sonnet-4';
const BASE_URL = 'https://openrouter.ai/api/v1/chat/completions';

export class OpenRouterProvider implements Provider {
  name = 'openrouter';
  model: string;
  private apiKey: string;

  constructor(model?: string) {
    this.model = model || DEFAULT_MODEL;
    this.apiKey = process.env.OPENROUTER_API_KEY || '';
  }

  private convertMessages(messages: Message[]): any[] {
    const result: any[] = [];

    for (const m of messages) {
      const textParts: string[] = [];
      const toolCalls: any[] = [];
      const toolResults: any[] = [];

      for (const block of m.content) {
        if (block.type === 'text') {
          textParts.push(block.text);
        } else if (block.type === 'tool_use') {
          toolCalls.push({
            id: block.id,
            type: 'function',
            function: { name: block.name, arguments: JSON.stringify(block.input) }
          });
        } else if (block.type === 'tool_result') {
          toolResults.push({
            role: 'tool',
            tool_call_id: block.tool_use_id,
            content: block.content,
          });
        }
      }

      // Assistant message with tool calls
      if (toolCalls.length > 0) {
        result.push({
          role: 'assistant',
          content: textParts.join('') || null,
          tool_calls: toolCalls,
        });
      } else if (toolResults.length > 0) {
        // Tool results become separate tool messages
        for (const tr of toolResults) {
          result.push(tr);
        }
        // Don't drop text blocks that share the message with tool results
        if (textParts.length > 0) {
          result.push({ role: m.role, content: textParts.join('') });
        }
      } else {
        // Plain text message
        result.push({ role: m.role, content: textParts.join('') || '' });
      }
    }

    return result;
  }

  private convertTools(tools: Tool[]): any[] {
    return tools.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      }
    }));
  }

  async *stream(messages: Message[], system: string, tools: Tool[]): AsyncIterable<StreamEvent> {
    const openaiMessages = [
      { role: 'system', content: system },
      ...this.convertMessages(messages),
    ];

    const body: any = {
      model: this.model,
      messages: openaiMessages,
      stream: true,
      max_tokens: 16384,
    };

    if (tools.length > 0) {
      body.tools = this.convertTools(tools);
    }

    const response = await fetch(BASE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        'HTTP-Referer': 'https://github.com/grain-agent',
        'X-Title': 'grain',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      yield { type: 'error', error: `OpenRouter API error: ${response.status} ${await response.text()}` };
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      yield { type: 'error', error: 'No response body' };
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let currentToolId = '';
    let currentToolName = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') {
          if (currentToolId) {
            yield { type: 'tool_use_end', id: currentToolId };
          }
          yield { type: 'message_end', stop_reason: currentToolId ? 'tool_use' : 'end_turn' };
          return;
        }

        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta;
          const finishReason = parsed.choices?.[0]?.finish_reason;

          if (delta) {
            if (delta.content) {
              yield { type: 'text_delta', text: delta.content };
            }

            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                if (tc.function?.name) {
                  // New tool call starting - end previous if any
                  if (currentToolId) {
                    yield { type: 'tool_use_end', id: currentToolId };
                  }
                  currentToolId = tc.id || `tool_${Date.now()}`;
                  currentToolName = tc.function.name;
                  yield { type: 'tool_use_start', id: currentToolId, name: tc.function.name };
                }
                if (tc.function?.arguments) {
                  yield { type: 'tool_use_delta', id: currentToolId, input_json: tc.function.arguments };
                }
              }
            }
          }

          if (finishReason === 'tool_calls') {
            if (currentToolId) {
              yield { type: 'tool_use_end', id: currentToolId };
            }
            yield { type: 'message_end', stop_reason: 'tool_use' };
            return;
          } else if (finishReason === 'stop') {
            yield { type: 'message_end', stop_reason: 'end_turn' };
            return;
          }
        } catch {
          // Skip malformed JSON
        }
      }
    }
  }
}
