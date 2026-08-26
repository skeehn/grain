import type { ToolResult } from '../providers/types.js';
import { getProvider } from '../providers/index.js';
import { CliAgentProvider, isCliAgentProvider } from '../providers/cli-agent.js';
import { executeTool, getChildTools } from './index.js';
import { getSystemPrompt } from '../system-prompt.js';
import { loadConfig, normalizeProvider } from '../config.js';
import type { Message, ContentBlock } from '../providers/types.js';

const CHILD_MAX_TURNS = 20;
const CHILD_WALL_CLOCK_MS = 5 * 60_000; // hard cap so a stuck child can't hang the parent
const CHILD_STREAM_IDLE_MS = 90_000;

/** Bound a provider stream by inactivity so a stalled child rejects, not hangs. */
async function* childStreamWithTimeout<T>(source: AsyncIterable<T>, ms: number): AsyncGenerator<T> {
  const it = source[Symbol.asyncIterator]();
  try {
    while (true) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`child stream timed out (${Math.round(ms / 1000)}s idle)`)), ms);
      });
      try {
        const res = await Promise.race([it.next(), timeout]);
        if (res.done) return;
        yield res.value;
      } finally {
        clearTimeout(timer);
      }
    }
  } finally {
    try { Promise.resolve(it.return?.()).catch(() => {}); } catch { /* already dead */ }
  }
}

export const delegateTool = {
  name: 'delegate',
  description: 'Delegate a subtask to a child agent. Use claude-code, codex, or grok for subscription CLIs (own tools and login). Use openrouter or xai for Grain-native models. The child runs in isolated context and returns its result.',
  input_schema: {
    type: 'object',
    properties: {
      task: { type: 'string', description: 'Description of the task to delegate' },
      provider: { type: 'string', description: 'Provider: claude-code, codex, grok, grokbot, openrouter, xai, groq, ollama, anthropic, opencode' },
      model: { type: 'string', description: 'Model override for the child agent' },
    },
    required: ['task'],
  },
};

export async function executeDelegate(input: { task: string; provider?: string; model?: string }): Promise<ToolResult> {
  // Default to the PARENT's configured provider, not a hardcoded 'bedrock' the
  // user may have no credentials for (the old default silently failed).
  const providerName = normalizeProvider(input.provider || loadConfig().provider || 'openrouter');

  if (isCliAgentProvider(providerName)) {
    try {
      const child = new CliAgentProvider(providerName, input.model, { fresh: true, write: true });
      let text = '';
      let error: string | undefined;
      for await (const event of childStreamWithTimeout(
        child.stream([{ role: 'user', content: [{ type: 'text', text: input.task }] }], '', [], undefined),
        CHILD_STREAM_IDLE_MS,
      )) {
        if (event.type === 'text_delta') text += event.text;
        if (event.type === 'error') error = event.error;
      }
      if (error) return { content: `${text}\n${error}`.trim(), is_error: true };
      return { content: text || `${providerName} produced no output.` };
    } catch (err: any) {
      return { content: `Delegation to ${providerName} failed: ${err.message}`, is_error: true };
    }
  }

  try {
    const provider = getProvider(providerName, input.model);
    const system = getSystemPrompt();
    const messages: Message[] = [
      { role: 'user', content: [{ type: 'text', text: input.task }] }
    ];

    const deadline = Date.now() + CHILD_WALL_CLOCK_MS;
    let lastText = '';           // most recent assistant prose — the artifact to hand back
    let malformedToolCalls = 0;

    for (let turn = 0; turn < CHILD_MAX_TURNS; turn++) {
      if (Date.now() > deadline) {
        return { content: `${lastText || '(no output)'}\n[delegate stopped: ${Math.round(CHILD_WALL_CLOCK_MS / 60_000)}min budget exhausted]`, is_error: true };
      }

      const assistantBlocks: ContentBlock[] = [];
      let turnText = '';
      let currentToolId = '';
      let currentToolName = '';
      let currentToolInput = '';

      for await (const event of childStreamWithTimeout(provider.stream(messages, system, getChildTools()), CHILD_STREAM_IDLE_MS)) {
        if (event.type === 'text_delta') {
          turnText += event.text;
        } else if (event.type === 'tool_use_start') {
          currentToolId = event.id;
          currentToolName = event.name;
          currentToolInput = '';
        } else if (event.type === 'tool_use_delta') {
          currentToolInput += event.input_json;
        } else if (event.type === 'tool_use_end') {
          if (currentToolName) {
            let parsedInput: any = {};
            try { parsedInput = JSON.parse(currentToolInput); }
            catch { malformedToolCalls++; } // don't silently coerce to {} and run a blank tool
            assistantBlocks.push({ type: 'tool_use', id: currentToolId, name: currentToolName, input: parsedInput });
          }
        }
      }

      // Accumulate the turn's prose as ONE text block (not per-delta fragments).
      if (turnText) { assistantBlocks.unshift({ type: 'text', text: turnText }); lastText = turnText; }
      messages.push({ role: 'assistant', content: assistantBlocks });

      const toolResults: ContentBlock[] = [];
      for (const block of assistantBlocks) {
        if (block.type === 'tool_use') {
          if (block.name === 'finish') {
            return { content: block.input?.result || lastText || 'Task completed.' };
          }
          const result = await executeTool(block.name, block.input);
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result.content, is_error: result.is_error });
        }
      }

      // No tools this turn → the child is done talking; hand back its answer.
      if (toolResults.length === 0) {
        return { content: lastText || 'Delegate produced no output.' };
      }
      messages.push({ role: 'user', content: toolResults });
    }

    const note = malformedToolCalls ? ` (${malformedToolCalls} malformed tool call(s) skipped)` : '';
    return { content: `${lastText || 'Delegate reached its turn limit.'}\n[delegate stopped at ${CHILD_MAX_TURNS} turns${note}]`, is_error: true };
  } catch (err: any) {
    return { content: `Delegation failed: ${err.message}`, is_error: true };
  }
}
