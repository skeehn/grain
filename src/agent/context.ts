import { spawn } from 'child_process';
import { homedir } from 'os';
import { join } from 'path';
import type { Message, ContentBlock } from '../providers/types.js';
import { loadConfig } from '../config.js';

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

const ENGRAM_HTTP = 'http://localhost:7474';

export async function engramRetrieve(query: string): Promise<string> {
  // Try HTTP first (faster, no subprocess overhead)
  try {
    const url = `${ENGRAM_HTTP}/search?q=${encodeURIComponent(query)}&limit=5`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (res.ok) {
      const results = await res.json() as Array<{ body: string; score: number; tags: string[] }>;
      if (results.length === 0) return '';
      return results
        .filter(r => r.score > 0.01)
        .slice(0, 5)
        .map(r => `• ${r.body}`)
        .join('\n');
    }
  } catch { /* fall through to CLI */ }

  // Fallback: CLI subprocess
  const engramBin = join(homedir(), 'bin', 'engram');
  const config = loadConfig();
  const dbPath = config.engram_db.replace('~', homedir());

  return new Promise((resolve) => {
    const proc = spawn(engramBin, ['-d', dbPath, 'search', query], {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    });

    let output = '';
    proc.stdout.on('data', (data: Buffer) => { output += data.toString(); });
    proc.on('close', () => resolve(output));
    proc.on('error', () => resolve(''));
  });
}

export async function engramStore(fact: string, tags: string[] = ['grain-auto']): Promise<void> {
  // Try HTTP first
  try {
    const response = await fetch(`${ENGRAM_HTTP}/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: fact, tags, node_type: 'fact' }),
      signal: AbortSignal.timeout(4000),
    });
    if (response.ok) return;
  } catch { /* fall through to CLI */ }

  // Fallback: CLI subprocess
  const engramBin = join(homedir(), 'bin', 'engram');
  const config = loadConfig();
  const dbPath = config.engram_db.replace('~', homedir());

  const tagArgs = tags.flatMap(t => ['--tags', t]);

  return new Promise((resolve) => {
    const proc = spawn(engramBin, ['-d', dbPath, 'add', fact, ...tagArgs], {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    });
    proc.on('close', () => resolve());
    proc.on('error', () => resolve());
  });
}
