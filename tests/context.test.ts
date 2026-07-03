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
});

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
  });

  test('never leaves an orphaned tool_result as the first kept message', () => {
    // Build a history of alternating tool_use / tool_result pairs so any
    // fixed-size cut lands between a pair.
    const msgs: Message[] = [user('start the task')];
    for (let i = 0; i < 25; i++) {
      msgs.push(...toolTurn(`tu_${i}`));
    }
    const out = compact(msgs);

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
