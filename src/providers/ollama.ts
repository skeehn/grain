// Ollama provider for local models (free, offline)
import { spawn } from 'child_process';
import type { Provider, ProviderStreamOptions, Message, StreamEvent, Tool } from './types.js';

export class OllamaProvider implements Provider {
  name = 'ollama';
  model: string;
  baseUrl: string;

  constructor(model: string = 'qwen2.5-coder:32b', baseUrl: string = 'http://localhost:11434') {
    this.model = model;
    this.baseUrl = baseUrl;
  }

  async *stream(messages: Message[], system: string, tools: Tool[], options?: ProviderStreamOptions): AsyncIterable<StreamEvent> {
    // Convert messages to Ollama format
    const ollamaMessages = messages.map(msg => {
      if (msg.role === 'assistant') {
        const textBlock = msg.content.find(b => b.type === 'text');
        return {
          role: 'assistant',
          content: textBlock ? (textBlock as any).text : '',
        };
      } else {
        // user messages with tool results
        const textBlocks = msg.content.filter(b => b.type === 'text' || b.type === 'tool_result');
        const content = textBlocks.map(b => {
          if (b.type === 'text') return (b as any).text;
          if (b.type === 'tool_result') return `Tool result: ${(b as any).content}`;
          return '';
        }).join('\n');
        return { role: 'user', content };
      }
    });

    // Add system message
    ollamaMessages.unshift({ role: 'system', content: system });

    // Call Ollama API
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: ollamaMessages,
        stream: true,
      }),
      signal: options?.signal,
    });

    if (!response.ok) {
      yield { type: 'error', error: `Ollama error: ${response.statusText}` };
      return;
    }

    if (!response.body) {
      yield { type: 'error', error: 'No response body' };
      return;
    }

    // Parse streaming response
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        
        try {
          const data = JSON.parse(line);
          
          if (data.message?.content) {
            yield { type: 'text_delta', text: data.message.content };
          }
          
          if (data.done) {
            yield { type: 'message_end', stop_reason: 'end_turn' };
          }
        } catch (err) {
          // Skip invalid JSON
        }
      }
    }
  }
}
