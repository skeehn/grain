import { describe, test, expect } from 'bun:test';
import { compact, needsCompaction, countTokens } from '../src/agent/context.js';
import type { Message } from '../src/providers/types.js';

function toolTurn(i: number): Message[] {
  return [
    {
      role: 'assistant',
      content: [{ type: 'tool_use', id: `tu_${i}`, name: 'bash', input: { command: `echo ${i}` } }],
    },
    {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: `tu_${i}`, content: `out ${i}` }],
    },
  ];
}

describe('compact', () => {
  test('returns messages unchanged when short', () => {
    const msgs: Message[] = [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }];
    expect(compact(msgs)).toBe(msgs);
  });

  test('never leaves an orphaned tool_result at the start of kept history', () => {
    // Leading prompt + 15 tool turns + trailing assistant text = 32 messages.
    // slice(-20) then cuts mid-pair, landing on a user tool_result message.
    const msgs: Message[] = [
      { role: 'user', content: [{ type: 'text', text: 'do the task' }] },
      ...Array.from({ length: 15 }, (_, i) => toolTurn(i)).flat(),
      { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
    ];
    const out = compact(msgs);

    // First message is the plain-text user summary
    expect(out[0].role).toBe('user');
    expect(out[0].content[0].type).toBe('text');

    // Every tool_result in kept history must reference a tool_use that is
    // also present (in a preceding assistant message).
    const toolUseIds = new Set(
      out.flatMap(m => m.content).filter(b => b.type === 'tool_use').map((b: any) => b.id),
    );
    for (const m of out) {
      for (const b of m.content) {
        if (b.type === 'tool_result') {
          expect(toolUseIds.has((b as any).tool_use_id)).toBe(true);
        }
      }
    }

    // Roles must alternate at the summary seam (Bedrock rejects user,user)
    expect(out[1].role).toBe('assistant');

    // The orphaned tool result's content is preserved in the summary text
    const summaryText = (out[0].content[0] as any).text as string;
    expect(summaryText).toContain('[earlier tool result]');
  });

  test('summary captures files written and commands run', () => {
    const msgs: Message[] = [
      { role: 'user', content: [{ type: 'text', text: 'start' }] },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'w1', name: 'write', input: { path: 'src/app.ts', content: 'x' } }],
      },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'w1', content: 'ok' }] },
      ...Array.from({ length: 12 }, (_, i) => toolTurn(i)).flat(),
    ];
    const out = compact(msgs);
    const summaryText = (out[0].content[0] as any).text as string;
    expect(summaryText).toContain('src/app.ts');
  });
});

describe('needsCompaction / countTokens', () => {
  test('small histories do not need compaction', () => {
    expect(needsCompaction([{ role: 'user', content: [{ type: 'text', text: 'hi' }] }])).toBe(false);
  });

  test('token count scales with content length', () => {
    const small = countTokens([{ role: 'user', content: [{ type: 'text', text: 'abcd' }] }]);
    const large = countTokens([{ role: 'user', content: [{ type: 'text', text: 'a'.repeat(4000) }] }]);
    expect(small).toBe(1);
    expect(large).toBe(1000);
  });
});
