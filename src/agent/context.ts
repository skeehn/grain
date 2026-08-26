import type { Message, ContentBlock } from '../providers/types.js';
import { executeEngram } from '../tools/engram.js';
import { createHash } from 'crypto';
import type { CompactionRecordV1 } from '../session/store.js';

// Fallback input budget when the caller doesn't know the model's real window.
export const MAX_TOKENS = 180000;
// Rough per-image token cost (vision blocks are otherwise invisible to chars/4).
const IMAGE_TOKENS = 1500;
// Compact once the estimate reaches this fraction of the usable input budget.
const COMPACT_AT = 0.8;

export function countTokens(messages: Message[]): number {
  let chars = 0;
  let images = 0;
  for (const msg of messages) {
    for (const block of msg.content) {
      if (block.type === 'text') chars += block.text.length;
      else if (block.type === 'tool_result') chars += (typeof block.content === 'string' ? block.content : JSON.stringify(block.content ?? '')).length;
      else if (block.type === 'tool_use') chars += JSON.stringify(block.input).length + block.name.length;
      else if (block.type === 'image') images += 1;
    }
  }
  // chars/4 is a loose lower bound for code/tool-heavy content; images add a
  // fixed cost so vision turns aren't undercounted to zero.
  return Math.ceil(chars / 4) + images * IMAGE_TOKENS;
}

/**
 * Whether history should be compacted for the given model input budget.
 * `budgetTokens` is the model's usable input window (contextWindow minus the
 * output reservation); `overheadTokens` accounts for the per-turn system
 * prompt + skills that live outside `messages`. Falls back to MAX_TOKENS so
 * callers that don't know the window still get sane behavior — critical for
 * small-window models (e.g. 32K) where the old fixed 144K threshold never fired.
 */
export function needsCompaction(
  messages: Message[],
  budgetTokens: number = MAX_TOKENS,
  overheadTokens = 0,
): boolean {
  const budget = budgetTokens > 0 ? budgetTokens : MAX_TOKENS;
  return countTokens(messages) + overheadTokens > budget * COMPACT_AT;
}

// A single oversized tool_result (a big file read or command dump) otherwise
// stays verbatim in the RECENT window that compaction never touches, and is
// re-sent every turn. Bound what's STORED in history to head+tail; the model
// already saw the full output when it ran, and can re-read a specific range.
const MAX_TOOL_RESULT_CHARS = 48_000; // ~12k tokens

export function boundToolResult(content: string): string {
  if (content.length <= MAX_TOOL_RESULT_CHARS) return content;
  const head = content.slice(0, Math.floor(MAX_TOOL_RESULT_CHARS * 0.7));
  const tail = content.slice(-Math.floor(MAX_TOOL_RESULT_CHARS * 0.25));
  const trimmed = content.length - head.length - tail.length;
  return `${head}\n\n… [${trimmed} chars trimmed from the middle to save context — re-read a specific range if you need it] …\n\n${tail}`;
}

const MAX_REQUEST_BLOCK_CHARS = 48_000;
const REQUEST_OMISSION_NOTICE = '[Earlier conversation was omitted from this model request to fit its context window. Durable session history is unchanged.]';

export interface MessageWindowResult {
  messages: Message[];
  omittedMessages: number;
  estimatedTokens: number;
  truncatedBlocks: number;
}

function shortenString(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  const marker = `\n… [${value.length - maxChars} chars omitted from this request] …\n`;
  const usable = Math.max(0, maxChars - marker.length);
  const head = Math.ceil(usable * 0.7);
  return `${value.slice(0, head)}${marker}${value.slice(-(usable - head))}`;
}

function cloneForRequest(messages: Message[]): { messages: Message[]; truncatedBlocks: number } {
  let truncatedBlocks = 0;
  const copy = messages.map(message => ({
    role: message.role,
    content: message.content.map(block => {
      if (block.type === 'text') {
        const text = shortenString(block.text, MAX_REQUEST_BLOCK_CHARS);
        if (text !== block.text) truncatedBlocks++;
        return { ...block, text };
      }
      if (block.type === 'tool_result') {
        const content = shortenString(String(block.content ?? ''), MAX_REQUEST_BLOCK_CHARS);
        if (content !== block.content) truncatedBlocks++;
        return { ...block, content };
      }
      if (block.type === 'tool_use') {
        const serialized = JSON.stringify(block.input ?? {});
        if (serialized.length <= MAX_REQUEST_BLOCK_CHARS) return { ...block, input: structuredClone(block.input ?? {}) };
        truncatedBlocks++;
        return { ...block, input: {
          _grain_context_truncated: true,
          preview: shortenString(serialized, MAX_REQUEST_BLOCK_CHARS - 128),
        } };
      }
      return { ...block };
    }),
  })) as Message[];
  return { messages: copy, truncatedBlocks };
}

/**
 * Group provider history at protocol boundaries. A tool-use assistant message
 * and its immediately following matching tool-result message are indivisible:
 * retaining only one side causes OpenAI-compatible and Anthropic APIs to reject
 * the request before the model can run.
 */
function messageGroups(messages: Message[]): Message[][] {
  const groups: Message[][] = [];
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    const toolIds = message.role === 'assistant'
      ? new Set(message.content.filter((block): block is Extract<ContentBlock, { type: 'tool_use' }> => block.type === 'tool_use').map(block => block.id))
      : new Set<string>();
    const next = messages[index + 1];
    const results = next?.role === 'user'
      ? next.content.filter((block): block is Extract<ContentBlock, { type: 'tool_result' }> => block.type === 'tool_result')
      : [];
    if (toolIds.size > 0 && results.length > 0 && results.every(result => toolIds.has(result.tool_use_id))) {
      groups.push([message, next]);
      index++;
    } else {
      groups.push([message]);
    }
  }
  return groups;
}

function constrainToBudget(messages: Message[], budgetTokens: number): { messages: Message[]; truncatedBlocks: number } {
  const cloned = cloneForRequest(messages);
  let truncatedBlocks = cloned.truncatedBlocks;
  const output = cloned.messages;
  // Repeatedly shrink the largest reducible block. This is deterministic and
  // retains block types, tool IDs, and tool-result correlation IDs.
  for (let pass = 0; countTokens(output) > budgetTokens && pass < 64; pass++) {
    let target: { size: number; shrink: () => void } | undefined;
    for (const message of output) for (let index = 0; index < message.content.length; index++) {
      const block = message.content[index];
      if (block.type === 'image') {
        const candidate = { size: IMAGE_TOKENS * 4, shrink: () => {
          message.content[index] = { type: 'text', text: `[image ${block.name || block.media_type} omitted from this request to fit context]` };
        } };
        if (!target || candidate.size > target.size) target = candidate;
      } else if (block.type === 'text' && block.text.length > 128) {
        const candidate = { size: block.text.length, shrink: () => { block.text = shortenString(block.text, Math.max(128, Math.floor(block.text.length / 2))); } };
        if (!target || candidate.size > target.size) target = candidate;
      } else if (block.type === 'tool_result' && block.content.length > 128) {
        const candidate = { size: block.content.length, shrink: () => { block.content = shortenString(block.content, Math.max(128, Math.floor(block.content.length / 2))); } };
        if (!target || candidate.size > target.size) target = candidate;
      } else if (block.type === 'tool_use') {
        const serialized = JSON.stringify(block.input ?? {});
        if (serialized.length > 128) {
          const candidate = { size: serialized.length, shrink: () => {
            block.input = { _grain_context_truncated: true, preview: shortenString(serialized, Math.max(96, Math.floor(serialized.length / 2))) };
          } };
          if (!target || candidate.size > target.size) target = candidate;
        }
      }
    }
    if (!target) break;
    target.shrink();
    truncatedBlocks++;
  }
  return { messages: output, truncatedBlocks };
}

/**
 * Produce a request-only, newest-first history window without mutating durable
 * session messages. Complete tool-call/result groups are retained or omitted
 * together, and the most recent group is always kept (with bounded payloads).
 */
export function fitMessagesToTokenBudget(messages: Message[], budgetTokens: number): MessageWindowResult {
  const budget = Math.max(256, Math.floor(budgetTokens));
  const bounded = cloneForRequest(messages);
  if (countTokens(bounded.messages) <= budget) return {
    messages: bounded.messages, omittedMessages: 0, estimatedTokens: countTokens(bounded.messages),
    truncatedBlocks: bounded.truncatedBlocks,
  };

  const groups = messageGroups(messages);
  const noticeTokens = Math.ceil(REQUEST_OMISSION_NOTICE.length / 4) + 8;
  const selectionBudget = Math.max(128, budget - noticeTokens);
  const selected: Message[][] = [];
  let used = 0;
  let firstSelectedIndex = groups.length;
  let truncatedBlocks = 0;
  for (let index = groups.length - 1; index >= 0; index--) {
    // Only the newest group is forcibly shrunk. Older groups that do not fit
    // are omitted as whole units, preserving useful recent detail instead of
    // reducing every historical turn to fragments.
    const constrained = selected.length === 0
      ? constrainToBudget(groups[index], selectionBudget)
      : cloneForRequest(groups[index]);
    const tokens = countTokens(constrained.messages);
    if (selected.length > 0 && used + tokens > selectionBudget) break;
    selected.unshift(constrained.messages);
    used += tokens;
    truncatedBlocks += constrained.truncatedBlocks;
    firstSelectedIndex = index;
    if (used >= selectionBudget) break;
  }

  let output = selected.flat();
  const omittedMessages = groups.slice(0, firstSelectedIndex).reduce((sum, group) => sum + group.length, 0);
  if (omittedMessages > 0 && output.length > 0) {
    if (output[0].role === 'user') output[0] = {
      ...output[0], content: [{ type: 'text', text: REQUEST_OMISSION_NOTICE }, ...output[0].content],
    };
    else output.unshift({ role: 'user', content: [{ type: 'text', text: REQUEST_OMISSION_NOTICE }] });
  }
  const final = constrainToBudget(output, budget);
  output = final.messages;
  truncatedBlocks += final.truncatedBlocks;
  return { messages: output, omittedMessages, estimatedTokens: countTokens(output), truncatedBlocks };
}

export function compact(messages: Message[]): Message[] {
  const KEEP_RECENT = 20;
  if (messages.length <= KEEP_RECENT) return messages;

  const toSummarize = messages.slice(0, -KEEP_RECENT);
  const toKeep = messages.slice(-KEEP_RECENT);

  // The cut can land between a tool_use and its tool_result. A kept user
  // message whose tool_result references a summarized-away tool_use makes the
  // API reject the whole history, so convert those orphaned blocks to text
  // (they get merged into the summary message below to keep roles alternating).
  // Strip every leading orphaned tool_result turn, not just the first —
  // consecutive tool-result turns would otherwise leave a second orphan at
  // the head of kept history and still trip the 400.
  const orphanChunks: string[] = [];
  while (toKeep.length > 0 && toKeep[0].role === 'user' && toKeep[0].content.some(b => b.type === 'tool_result')) {
    const orphan = toKeep.shift()!;
    orphanChunks.push(
      orphan.content
        .map(b => {
          if (b.type === 'tool_result') return `[earlier tool result]: ${String(b.content).slice(0, 500)}`;
          if (b.type === 'text') return b.text;
          return '';
        })
        .filter(Boolean)
        .join('\n'),
    );
  }
  const orphanText = orphanChunks.filter(Boolean).join('\n');

  // Extract structured facts from summarized messages
  const filesWritten: string[] = [];
  const commandsRun: string[] = [];
  const errors: string[] = [];
  const keyDecisions: string[] = [];

  for (const msg of toSummarize) {
    for (const block of msg.content) {
      if (block.type === 'tool_use') {
        if (block.name === 'write' || block.name === 'multi_edit') {
          const p = block.input?.path || (block.input?.edits || []).map((e: any) => e.path).join(', ');
          if (p) filesWritten.push(p);
        } else if (block.name === 'bash') {
          const cmd = (block.input?.command || '').slice(0, 80);
          if (cmd) commandsRun.push(cmd);
        } else if (block.name === 'finish') {
          // finish carries `result` (not `message`) — read both for safety.
          const m = block.input?.result || block.input?.message || '';
          if (m) keyDecisions.push(`COMPLETED: ${m}`);
        }
      } else if (block.type === 'tool_result' && (block as any).is_error) {
        const err = (typeof block.content === 'string' ? block.content : '').slice(0, 120);
        if (err) errors.push(err);
      } else if (block.type === 'text' && msg.role === 'assistant') {
        const text = (block as any).text?.trim() || '';
        if (text.length > 100 && text.length < 400) keyDecisions.push(text.slice(0, 200));
      }
    }
  }

  const parts: string[] = [
    `[CONTEXT SUMMARY — ${toSummarize.length} earlier messages compacted]`,
  ];
  if (filesWritten.length) parts.push(`Files written: ${[...new Set(filesWritten)].join(', ')}`);
  if (commandsRun.length) parts.push(`Commands run: ${[...new Set(commandsRun)].slice(0, 10).join(' | ')}`);
  if (errors.length) parts.push(`Errors: ${[...new Set(errors)].slice(0, 5).join(' | ')}`);
  if (keyDecisions.length) parts.push(`Key outcomes:\n${keyDecisions.slice(0, 5).map(d => `  • ${d}`).join('\n')}`);
  if (orphanText) parts.push(orphanText);
  parts.push('[Continue from the recent messages below]');

  const summaryText = parts.join('\n');

  // Anthropic requires alternating roles: a `user` summary followed by another
  // `user` turn 400s. After orphan-stripping, if kept history still starts with
  // a user turn, fold the summary into it instead of prepending a second user
  // message. If nothing is kept, the summary stands alone.
  if (toKeep.length === 0) {
    return [{ role: 'user', content: [{ type: 'text', text: summaryText }] }];
  }
  if (toKeep[0].role === 'user') {
    const [first, ...rest] = toKeep;
    return [{ ...first, content: [{ type: 'text', text: summaryText }, ...first.content] }, ...rest];
  }
  return [{ role: 'user', content: [{ type: 'text', text: summaryText }] }, ...toKeep];
}

export interface CompactionResult {
  messages: Message[];
  record?: Omit<CompactionRecordV1, 'schema_version' | 'id' | 'session_id' | 'created_at'>;
}

/** Create the provider history and the durable evidence record in one deterministic pass. */
export function compactWithRecord(messages: Message[], entryIds: string[] = [], parentId?: string): CompactionResult {
  const compacted = compact(messages);
  if (compacted === messages) return { messages };
  const summarizedCount = Math.max(0, messages.length - 20);
  const source = messages.slice(0, summarizedCount);
  const sourceIds = source.map((_, index) => entryIds[index] || `message:${index}`);
  const filesRead = new Set<string>(); const filesModified = new Set<string>(); const commands = new Set<string>();
  const decisions: string[] = []; const errors: string[] = []; const verification: string[] = []; const openTasks: string[] = [];
  for (const message of source) for (const block of message.content) {
    if (block.type === 'tool_use') {
      const input = block.input as any;
      if (block.name === 'read' && input?.path) filesRead.add(String(input.path));
      if ((block.name === 'write' || block.name === 'patch' || block.name === 'multi_edit') && input?.path) filesModified.add(String(input.path));
      if (block.name === 'multi_edit' && Array.isArray(input?.edits)) for (const edit of input.edits) if (edit?.path) filesModified.add(String(edit.path));
      if (block.name === 'bash' && input?.command) commands.add(String(input.command).slice(0, 240));
      if (block.name === 'finish' && (input?.result || input?.message)) decisions.push(String(input.result || input.message).slice(0, 500));
    } else if (block.type === 'tool_result' && (block as any).is_error) errors.push(String(block.content).slice(0, 500));
    else if (block.type === 'text') {
      const text = block.text.trim();
      if (/\b(?:todo|remaining|next step|unresolved)\b/iu.test(text)) openTasks.push(text.slice(0, 500));
      if (/\b(?:verified|tests? pass|typecheck|build succeeded)\b/iu.test(text)) verification.push(text.slice(0, 500));
    }
  }
  const summary = compacted.flatMap(message => message.content)
    .find((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text' && block.text.includes('[CONTEXT SUMMARY'))?.text || '';
  const sourceHash = createHash('sha256').update(JSON.stringify(source)).digest('hex');
  return { messages: compacted, record: {
    parent_id: parentId, summary, source_entry_ids: sourceIds, first_kept_entry_id: entryIds[summarizedCount],
    tokens_before: countTokens(messages), tokens_after: countTokens(compacted), files_read: [...filesRead],
    files_modified: [...filesModified], commands: [...commands], open_tasks: openTasks.slice(0, 20), decisions: decisions.slice(0, 20),
    errors: errors.slice(0, 20), verification: verification.slice(0, 20), summary_model: 'grain-deterministic-v1', source_hash: sourceHash,
  } };
}

function engramMiss(result: { content: unknown; is_error?: boolean }): boolean {
  return Boolean(result.is_error) || /^No results|engram not available/iu.test(String(result.content));
}

export const ENGRAM_UNAVAILABLE = '__ENGRAM_UNAVAILABLE__';

export async function engramRetrieve(query: string, project?: string): Promise<string> {
  const unscoped = await executeEngram({ action: 'search', query, top_k: 5 });
  const scoped = project
    ? await executeEngram({ action: 'search', query, top_k: 5, project })
    : { content: '', is_error: false as boolean | undefined };
  if (/engram not available/iu.test(String(unscoped.content)) || (unscoped.is_error && /unavailable|ECONNREFUSED/i.test(String(unscoped.content)))) {
    return ENGRAM_UNAVAILABLE;
  }
  const parts = [unscoped, scoped]
    .filter(result => !engramMiss(result) && String(result.content).trim())
    .map(result => String(result.content));
  return [...new Set(parts)].join('\n\n');
}

export async function engramStore(fact: string, tags: string[] = ['grain-auto'], project?: string): Promise<void> {
  await executeEngram({ action: 'add', body: fact, tags, project });
}
