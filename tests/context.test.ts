import { describe, test, expect } from 'bun:test';
import { compact, needsCompaction, countTokens } from '../src/agent/context.js';
import type { Message } from '../src/providers/types.js';

const user = (text: string): Message => ({ role: 'user', content: [{ type: 'text', text }] });
const assistant = (text: string): Message => ({ role: 'assistant', content: [{ type: 'text', text }] });
const toolTurn = (id: string): Message[] => [
  { role: 'assistant', content: [{ type: 'tool_use', id, name: 'bash', input: { command: 'ls' } }] },
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] },
];

describe('countTokens / needsCompaction', () => {
  test('estimates chars/4 and flags oversized histories', () => {
    const msgs = [user('a'.repeat(400))];
    expect(countTokens(msgs)).toBe(100);
    expect(needsCompaction(msgs)).toBe(false);
  });

  test('counts image blocks (otherwise invisible to chars/4)', () => {
    const withImage: Message = { role: 'user', content: [
      { type: 'text', text: 'a'.repeat(400) },
      { type: 'image', media_type: 'image/png', data: 'x' } as any,
    ] };
    // 100 (text) + 1500 (one image)
    expect(countTokens([withImage])).toBe(1600);
  });

  test('threshold follows the model budget, not a fixed 180K', () => {
    // ~50K-token history: fine for a 1M window, must compact for a 32K one.
    const big = [user('a'.repeat(200_000))]; // 50K tokens
    expect(needsCompaction(big, 1_048_576)).toBe(false);
    expect(needsCompaction(big, 32_768)).toBe(true);
  });

  test('system-prompt overhead counts toward the budget', () => {
    const msgs = [user('a'.repeat(400))]; // 100 tokens
    // budget 1000 → threshold 800; 100 alone is fine, +900 overhead trips it.
    expect(needsCompaction(msgs, 1000, 0)).toBe(false);
    expect(needsCompaction(msgs, 1000, 900)).toBe(true);
  });
});

// No two adjacent messages may share a role (Anthropic 400s otherwise).
function assertAlternatingRoles(msgs: Message[]): void {
  for (let i = 1; i < msgs.length; i++) {
    expect(msgs[i].role).not.toBe(msgs[i - 1].role);
  }
}

describe('compact', () => {
  test('short histories pass through untouched', () => {
    const msgs = [user('hi'), assistant('hello')];
    expect(compact(msgs)).toBe(msgs);
  });

  test('long histories collapse to summary + recent messages', () => {
    const msgs: Message[] = [];
    for (let i = 0; i < 30; i++) {
      msgs.push(user(`question ${i}`), assistant(`answer ${i}`));
    }
    const out = compact(msgs);
    expect(out.length).toBeLessThan(msgs.length);
    expect(out[0].role).toBe('user');
    expect((out[0].content[0] as any).text).toContain('CONTEXT SUMMARY');
    // The summary (user) must not sit next to another user turn → fold, not stack.
    assertAlternatingRoles(out);
  });

  test('never emits two consecutive user messages when kept history starts with a user turn', () => {
    // Alternating user/assistant, cut lands so the first kept turn is a plain
    // user message — the exact shape that used to stack two user turns and 400.
    const msgs: Message[] = [];
    for (let i = 0; i < 30; i++) {
      msgs.push(user(`q${i}`), assistant(`a${i}`));
    }
    const out = compact(msgs);
    assertAlternatingRoles(out);
    expect((out[0].content[0] as any).text).toContain('CONTEXT SUMMARY');
  });

  test('never leaves an orphaned tool_result as the first kept message', () => {
    // A leading prompt + N tool pairs makes the cut land on an assistant
    // (tool_use) boundary; the trailing assistant message shifts parity so
    // slice(-20) lands on a user (tool_result) boundary — the orphan case.
    const msgs: Message[] = [user('start the task')];
    for (let i = 0; i < 25; i++) {
      msgs.push(...toolTurn(`tu_${i}`));
    }
    msgs.push(assistant('all done'));
    const out = compact(msgs);

    // The seam is genuinely exercised: the orphaned tool_result content is
    // folded into the summary, and roles alternate across it.
    expect((out[0].content[0] as any).text).toContain('[earlier tool result]');
    expect(out[1].role).toBe('assistant');

    // First message must be the summary (plain user text, no tool_result)
    expect(out[0].role).toBe('user');
    expect(out[0].content.every(b => b.type === 'text')).toBe(true);

    // Every kept tool_result must have its tool_use in the kept slice
    const keptToolUseIds = new Set(
      out.flatMap(m => m.content).filter(b => b.type === 'tool_use').map((b: any) => b.id),
    );
    for (const msg of out) {
      for (const block of msg.content) {
        if (block.type === 'tool_result') {
          expect(keptToolUseIds.has((block as any).tool_use_id)).toBe(true);
        }
      }
    }
  });
});

import { boundToolResult } from '../src/agent/context.js';

describe('boundToolResult', () => {
  test('leaves small results untouched', () => {
    expect(boundToolResult('small output')).toBe('small output');
  });
  test('trims a huge result to head+tail with a marker', () => {
    const huge = 'A'.repeat(30_000) + 'MIDDLE' + 'B'.repeat(30_000);
    const out = boundToolResult(huge);
    expect(out.length).toBeLessThan(huge.length);
    expect(out).toContain('trimmed from the middle');
    expect(out.startsWith('A')).toBe(true);  // head preserved
    expect(out.endsWith('B')).toBe(true);     // tail preserved
  });
});
