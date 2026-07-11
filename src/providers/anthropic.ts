import Anthropic from '@anthropic-ai/sdk';
import type { Provider, Message, Tool, StreamEvent } from './types.js';

const DEFAULT_MODEL = 'claude-sonnet-4-20250514';

export class AnthropicProvider implements Provider {
  name = 'anthropic';
  model: string;
  private client: Anthropic;

  constructor(model?: string) {
    this.model = model || DEFAULT_MODEL;
    this.client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }

  async *stream(messages: Message[], system: string, tools: Tool[]): AsyncIterable<StreamEvent> {
    let currentToolId = '';
    const apiMessages = messages.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content.map(block => {
        if (block.type === 'text') return { type: 'text' as const, text: block.text };
        if (block.type === 'tool_use') return { type: 'tool_use' as const, id: block.id, name: block.name, input: block.input };
        if (block.type === 'tool_result') return { type: 'tool_result' as const, tool_use_id: block.tool_use_id, content: block.content, is_error: block.is_error };
        return block as any;
      }),
    }));

    const apiTools = tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema as any,
    }));

    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: 16384,
      system,
      messages: apiMessages,
      tools: apiTools,
    });

    for await (const event of stream) {
      if (event.type === 'content_block_start') {
        const block = (event as any).content_block;
        if (block.type === 'tool_use') {
          currentToolId = block.id;
          yield { type: 'tool_use_start', id: block.id, name: block.name };
        }
      } else if (event.type === 'content_block_delta') {
        const delta = (event as any).delta;
        if (delta.type === 'text_delta') {
          yield { type: 'text_delta', text: delta.text };
        } else if (delta.type === 'input_json_delta') {
          yield { type: 'tool_use_delta', id: currentToolId, input_json: delta.partial_json };
        }
      } else if (event.type === 'content_block_stop') {
        if (currentToolId) {
          yield { type: 'tool_use_end', id: currentToolId };
          currentToolId = '';
        }
      } else if (event.type === 'message_delta') {
        const delta = (event as any).delta;
        if (delta.stop_reason) {
          yield { type: 'message_end', stop_reason: delta.stop_reason };
        }
      }
    }
  }
}
