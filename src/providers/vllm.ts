/**
 * vLLM Provider
 * 
 * Connects to a vLLM inference server via OpenAI-compatible API.
 * Use this for local model hosting with high throughput.
 * 
 * Setup:
 * 1. Install vLLM: pip install vllm
 * 2. Start server: vllm serve meta-llama/Llama-3-70B-Instruct --port 8000
 * 3. Configure grain: ~/.grain/config.json
 * 
 * Config:
 * {
 *   "provider": "vllm",
 *   "model": "meta-llama/Llama-3-70B-Instruct",
 *   "vllm": {
 *     "endpoint": "http://localhost:8000",
 *     "apiKey": "optional-key"
 *   }
 * }
 */

import type { Provider, Message, ContentBlock, Tool, StreamEvent } from './types.js';

interface VLLMConfig {
  endpoint?: string;
  apiKey?: string;
}

interface OpenAIMessage {
  role: string;
  content: string;
}

interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
  };
}

export class VLLMProvider implements Provider {
  name = 'vllm';
  model: string;
  private endpoint: string;
  private apiKey: string | null;

  constructor(model: string, config: VLLMConfig = {}) {
    this.model = model;
    this.endpoint = config.endpoint || 'http://localhost:8000';
    this.apiKey = config.apiKey || null;
  }

  async *stream(
    messages: Message[],
    system: string,
    tools: Tool[]
  ): AsyncIterable<StreamEvent> {
    try {
      const openaiMessages = this.formatMessages(messages, system);
      const openaiTools = this.formatTools(tools);

      const body: any = {
        model: this.model,
        messages: openaiMessages,
        stream: true,
        temperature: 0.7,
        max_tokens: 4096,
      };

      if (openaiTools.length > 0) {
        body.tools = openaiTools;
        body.tool_choice = 'auto';
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

      const response = await fetch(`${this.endpoint}/v1/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        yield {
          type: 'error',
          error: `vLLM API error (${response.status}): ${errorText}`,
        };
        return;
      }

      if (!response.body) {
        yield { type: 'error', error: 'No response body from vLLM' };
        return;
      }

      // Parse Server-Sent Events stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      // Track the currently-open tool call so tool_use_end fires exactly once
      // per call (when the next call starts or the stream finishes) — the old
      // `!toolCall.index` check ended index-0 after every chunk and never
      // ended index >= 1.
      let openToolId: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim() || line.trim() === 'data: [DONE]') continue;
          if (!line.startsWith('data: ')) continue;

          const jsonStr = line.slice(6);
          try {
            const chunk = JSON.parse(jsonStr);
            const delta = chunk.choices?.[0]?.delta;

            if (!delta) continue;

            // Text content
            if (delta.content) {
              yield { type: 'text_delta', text: delta.content };
            }

            // Tool calls
            if (delta.tool_calls && delta.tool_calls.length > 0) {
              for (const toolCall of delta.tool_calls) {
                if (toolCall.id && toolCall.function?.name) {
                  // A new call starting closes the previous one
                  if (openToolId && openToolId !== toolCall.id) {
                    yield { type: 'tool_use_end', id: openToolId };
                  }
                  openToolId = toolCall.id;
                  yield {
                    type: 'tool_use_start',
                    id: toolCall.id,
                    name: toolCall.function.name,
                  };
                }

                if (toolCall.function?.arguments) {
                  yield {
                    type: 'tool_use_delta',
                    id: toolCall.id || openToolId || 'unknown',
                    input_json: toolCall.function.arguments,
                  };
                }
              }
            }

            // Stream end — close any open tool call first
            const finishReason = chunk.choices?.[0]?.finish_reason;
            if (finishReason) {
              if (openToolId) {
                yield { type: 'tool_use_end', id: openToolId };
                openToolId = null;
              }
              yield {
                type: 'message_end',
                stop_reason: finishReason === 'tool_calls' ? 'tool_use' : finishReason,
              };
            }
          } catch (parseErr: any) {
            // Skip malformed JSON chunks
            console.error('vLLM parse error:', parseErr.message, jsonStr.slice(0, 100));
          }
        }
      }
    } catch (err: any) {
      yield { type: 'error', error: `vLLM stream error: ${err.message}` };
    }
  }

  private formatMessages(messages: Message[], system: string): OpenAIMessage[] {
    const openaiMessages: OpenAIMessage[] = [];

    if (system) {
      openaiMessages.push({ role: 'system', content: system });
    }

    for (const msg of messages) {
      let content = '';

      for (const block of msg.content) {
        if (block.type === 'text') {
          content += block.text;
        } else if (block.type === 'tool_use') {
          // OpenAI expects tool calls in assistant message
          content += `\n[TOOL CALL: ${block.name}]\n${JSON.stringify(block.input, null, 2)}\n`;
        } else if (block.type === 'tool_result') {
          // OpenAI expects tool results in tool message role
          openaiMessages.push({
            role: 'tool',
            content: block.content,
          } as any);
        }
      }

      if (content.trim()) {
        openaiMessages.push({
          role: msg.role,
          content: content.trim(),
        });
      }
    }

    return openaiMessages;
  }

  private formatTools(tools: Tool[]): OpenAITool[] {
    return tools.map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema,
      },
    }));
  }
}
