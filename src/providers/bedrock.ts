import AnthropicBedrock from '@anthropic-ai/bedrock-sdk';
import type { Provider, Message, Tool, StreamEvent, ContentBlock } from './types.js';

const DEFAULT_MODEL = 'us.anthropic.claude-sonnet-4-5-20250929-v1:0';

export class BedrockProvider implements Provider {
  name = 'bedrock';
  model: string;
  private client: AnthropicBedrock;

  constructor(model?: string) {
    this.model = model || DEFAULT_MODEL;
    this.client = new AnthropicBedrock({
      awsRegion: process.env.AWS_REGION || 'us-east-1',
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

    // Retry with exponential backoff on rate limits (429)
    const MAX_RETRIES = 4;
    let lastError: any;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const wait = Math.min(1000 * Math.pow(2, attempt), 30000); // 2s, 4s, 8s, max 30s
        process.stderr.write(`\n⏳ Rate limited — retrying in ${wait/1000}s (attempt ${attempt+1}/${MAX_RETRIES})...\n`);
        await new Promise(r => setTimeout(r, wait));
      }
      // Once any event has been yielded, the consumer has already acted on it —
      // restarting the stream would duplicate text and tool_use blocks. Only
      // retry failures that happen before the first event.
      let yieldedAny = false;
      try {
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
              yieldedAny = true;
              yield { type: 'tool_use_start', id: block.id, name: block.name };
            }
          } else if (event.type === 'content_block_delta') {
            const delta = (event as any).delta;
            if (delta.type === 'text_delta') {
              yieldedAny = true;
              yield { type: 'text_delta', text: delta.text };
            } else if (delta.type === 'input_json_delta') {
              yieldedAny = true;
              yield { type: 'tool_use_delta', id: currentToolId, input_json: delta.partial_json };
            }
          } else if (event.type === 'content_block_stop') {
            yieldedAny = true;
            if (currentToolId) {
              yield { type: 'tool_use_end', id: currentToolId };
              currentToolId = '';
            }
          } else if (event.type === 'message_delta') {
            const delta = (event as any).delta;
            if (delta.stop_reason) {
              yieldedAny = true;
              yield { type: 'message_end', stop_reason: delta.stop_reason };
            }
          }
        }
        return; // success — exit retry loop
      } catch (err: any) {
        lastError = err;
        const status = err?.status || err?.statusCode;
        const throttled = status === 429 || /too many|rate.limit|throttl/i.test(err?.message || '');
        if (throttled && !yieldedAny) {
          continue; // retry — nothing was emitted yet
        }
        throw err; // non-retryable, or a mid-stream failure the consumer must handle
      }
    }
    throw lastError;
  }
}
