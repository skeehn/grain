import { describe, test, expect } from 'bun:test';
import { createSession, addMessage, getMessages, getLastSession } from '../src/session/store.js';

describe('session store', () => {
  test('createSession returns a UUID and getMessages starts empty', async () => {
    const id = await createSession('test session');
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await getMessages(id)).toEqual([]);
  });

  test('addMessage + getMessages round-trips content blocks', async () => {
    const id = await createSession();
    await addMessage(id, 'user', [{ type: 'text', text: 'hello' }]);
    await addMessage(id, 'assistant', [
      { type: 'text', text: 'hi' },
      { type: 'tool_use', id: 'tu_1', name: 'read', input: { path: 'a.txt' } },
    ]);
    const msgs = await getMessages(id);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('user');
    expect(msgs[0].content[0]).toEqual({ type: 'text', text: 'hello' });
    expect(msgs[1].content[1]).toMatchObject({ type: 'tool_use', name: 'read' });
  });

  test('addMessage to unknown session is a no-op', async () => {
    await addMessage('nonexistent-id', 'user', [{ type: 'text', text: 'x' }]);
    expect(await getMessages('nonexistent-id')).toEqual([]);
  });

  test('getLastSession returns most recently updated session', async () => {
    const a = await createSession('a');
    const b = await createSession('b');
    // updating a makes it most recent even though b was created later
    await Bun.sleep(5);
    await addMessage(a, 'user', [{ type: 'text', text: 'bump' }]);
    expect(await getLastSession()).toBe(a);
  });

  test('messages are capped at 100 per session', async () => {
    const id = await createSession('cap');
    for (let i = 0; i < 105; i++) {
      await addMessage(id, 'user', [{ type: 'text', text: `m${i}` }]);
    }
    const msgs = await getMessages(id);
    expect(msgs).toHaveLength(100);
    expect((msgs[0].content[0] as any).text).toBe('m5'); // oldest 5 dropped
  });
});
