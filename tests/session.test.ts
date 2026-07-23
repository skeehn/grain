import { describe, test, expect } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createSession, addMessage, getMessages, getLastSession, sessionArchivePath } from '../src/session/store.js';

const sessionModule = join(import.meta.dir, '../src/session/store.ts');

async function runSessionProcess(home: string, source: string): Promise<string> {
  const child = Bun.spawn([process.execPath, '-e', source], { env: { ...process.env, GRAIN_HOME: home }, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (code !== 0) throw new Error(stderr || `session child exited ${code}`);
  return stdout;
}

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

  test('resumes the most recent session in the current workspace only', async () => {
    const projectA = await createSession('a', '/tmp/project-a');
    const projectB = await createSession('b', '/tmp/project-b');
    expect(await getLastSession('/tmp/project-a')).toBe(projectA);
    expect(await getLastSession('/tmp/project-b')).toBe(projectB);
  });

  test('messages are capped at 100 per session', async () => {
    const id = await createSession('cap');
    for (let i = 0; i < 105; i++) {
      await addMessage(id, 'user', [{ type: 'text', text: `m${i}` }]);
    }
    const msgs = await getMessages(id);
    expect(msgs).toHaveLength(100);
    expect((msgs[0].content[0] as any).text).toBe('m5'); // oldest 5 dropped
    const archived = readFileSync(sessionArchivePath(id)!, 'utf8').trim().split('\n').map(JSON.parse);
    expect(archived).toHaveLength(5);
    expect(JSON.parse(archived[0].content_json)[0].text).toBe('m0');
  });

  test('a long tool-only run is not stripped to nothing by truncation cleanup', async () => {
    const id = await createSession('tool-only');
    // 130 alternating tool_use / tool_result messages — the 100-message slice
    // is entirely assistant/tool_result, so unbounded cleanup would wipe it.
    for (let i = 0; i < 65; i++) {
      await addMessage(id, 'assistant', [{ type: 'tool_use', id: `t${i}`, name: 'bash', input: { command: 'ls' } }]);
      await addMessage(id, 'user', [{ type: 'tool_result', tool_use_id: `t${i}`, content: 'ok' }]);
    }
    const msgs = await getMessages(id);
    expect(msgs.length).toBeGreaterThan(80); // history preserved, not emptied
  });

  test('concurrent Grain processes do not overwrite each other sessions', async () => {
    const home = mkdtempSync(join(tmpdir(), 'grain-session-concurrency-'));
    const env = { ...process.env, GRAIN_HOME: home };
    const first = Bun.spawn([process.execPath, '-e', `const s=await import(${JSON.stringify(sessionModule)});await s.listSessions();await Bun.sleep(300);await s.createSession('A')`], { env });
    await Bun.sleep(75);
    const second = Bun.spawn([process.execPath, '-e', `const s=await import(${JSON.stringify(sessionModule)});await s.createSession('B')`], { env });
    expect(await second.exited).toBe(0);
    expect(await first.exited).toBe(0);
    const check = Bun.spawn([process.execPath, '-e', `const s=await import(${JSON.stringify(sessionModule)});console.log((await s.listSessions()).map(x=>x.title).sort().join(','))`], { env, stdout: 'pipe' });
    expect(await new Response(check.stdout).text()).toBe('A,B\n');
    expect(await check.exited).toBe(0);
  });

  test('migrates every legacy session without deleting the source database', async () => {
    const home = mkdtempSync(join(tmpdir(), 'grain-session-migration-'));
    const now = new Date().toISOString();
    const sessions = Array.from({ length: 60 }, (_, index) => ({
      id: crypto.randomUUID(), title: `legacy-${index}`, messages: [], created_at: now, updated_at: now,
    }));
    writeFileSync(join(home, 'sessions.json'), JSON.stringify({ sessions }));
    const output = await runSessionProcess(home, `const s=await import(${JSON.stringify(sessionModule)});console.log((await s.listSessions()).length)`);
    expect(output).toBe('60\n');
    expect(readFileSync(join(home, 'sessions.json'), 'utf8')).toContain('legacy-0');
  });

  test('isolates corrupt session files and salvages valid messages', async () => {
    const home = mkdtempSync(join(tmpdir(), 'grain-session-corrupt-'));
    const id = (await runSessionProcess(home, `const s=await import(${JSON.stringify(sessionModule)});const id=await s.createSession('salvage');await s.addMessage(id,'user',[{type:'text',text:'keep me'}]);console.log(id)`)).trim();
    const dir = join(home, 'sessions'); const path = join(dir, `${id}.json`);
    const record = JSON.parse(readFileSync(path, 'utf8'));
    record.messages.push({ id: crypto.randomUUID(), role: 'assistant', content_json: '{bad', created_at: new Date().toISOString() });
    writeFileSync(path, JSON.stringify(record));
    writeFileSync(join(dir, `${crypto.randomUUID()}.json`), '{broken');
    const output = await runSessionProcess(home, `const s=await import(${JSON.stringify(sessionModule)});console.log(JSON.stringify({messages:await s.getMessages(${JSON.stringify(id)}),ids:(await s.listSessions()).map(x=>x.id)}))`);
    expect(JSON.parse(output)).toEqual({ messages: [{ role: 'user', content: [{ type: 'text', text: 'keep me' }] }], ids: [id] });
  });
});
