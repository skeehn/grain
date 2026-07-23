import { describe, expect, test } from 'bun:test';
import { compactWithRecord } from '../src/agent/context.js';
import type { Message } from '../src/providers/types.js';

describe('durable compaction ledger', () => {
  test('records source hashes, tool evidence, and token reduction', () => {
    const messages: Message[] = [{ role: 'user', content: [{ type: 'text', text: 'implement it' }] }];
    for (let index = 0; index < 12; index++) {
      messages.push({ role: 'assistant', content: [{ type: 'tool_use', id: `t${index}`, name: index === 0 ? 'write' : 'bash',
        input: index === 0 ? { path: 'src/app.ts', content: 'x' } : { command: `echo ${index}` } }] });
      messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: `t${index}`, content: `ok ${'evidence '.repeat(300)}` }] });
    }
    const ids = messages.map((_, index) => `entry-${index}`);
    const result = compactWithRecord(messages, ids);
    expect(result.record?.source_entry_ids[0]).toBe('entry-0');
    expect(result.record?.files_modified).toContain('src/app.ts');
    expect(result.record?.source_hash).toHaveLength(64);
    expect(result.record!.tokens_after).toBeLessThan(result.record!.tokens_before);
  });
});
