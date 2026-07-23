import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { appendCompaction, addMessage, branchSession, createSession, getMessages, getSessionEntries, listCompactions, sessionsDirectory } from '../src/session/store.js';
import { join } from 'path';

describe('session schema v2', () => {
  test('persists parent-linked entries and can create a conversation branch', async () => {
    const id = await createSession('branch');
    await addMessage(id, 'user', [{ type: 'text', text: 'root' }]);
    await addMessage(id, 'assistant', [{ type: 'text', text: 'old answer' }]);
    const entries = await getSessionEntries(id);
    expect(entries[1].parent_id).toBe(entries[0].id);
    await branchSession(id, entries[0].id);
    await addMessage(id, 'assistant', [{ type: 'text', text: 'new answer' }]);
    const active = await getMessages(id);
    expect(active.map(message => (message.content[0] as any).text)).toEqual(['root', 'new answer']);
    const stored = JSON.parse(readFileSync(join(sessionsDirectory(), `${id}.json`), 'utf8'));
    expect(stored.schema_version).toBe(2);
  });

  test('stores append-only compaction evidence with source pointers', async () => {
    const id = await createSession('compaction');
    await addMessage(id, 'user', [{ type: 'text', text: 'do work' }]);
    const entry = (await getSessionEntries(id))[0];
    const record = await appendCompaction(id, { summary: 'work summary', source_entry_ids: [entry.id], first_kept_entry_id: entry.id,
      tokens_before: 100, tokens_after: 20, files_read: [], files_modified: ['src/a.ts'], commands: ['bun test'],
      open_tasks: [], decisions: [], errors: [], verification: ['tests passed'], summary_model: 'deterministic', source_hash: 'abc' });
    expect(record.id).toMatch(/^[0-9a-f-]{36}$/);
    expect((await listCompactions(id))[0]).toMatchObject({ source_entry_ids: [entry.id], source_hash: 'abc' });
  });
});
