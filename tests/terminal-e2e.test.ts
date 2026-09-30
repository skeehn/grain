import { describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const repo = process.cwd();
type Step = { wait: string; send: string; columns?: number };
const sse = (delta: unknown) => `data: ${JSON.stringify({ choices: [{ index: 0, delta }] })}\n\n`;
const answer = (text: string) => new Response(sse({ content: text }) + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
const call = (name: string, input: unknown, id = name) => new Response(sse({ tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: JSON.stringify(input) } }] }) + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });

async function scenario(respond: (body: any) => Response, steps: Step[], cliScript?: string, extensions = false) {
  const dir = mkdtempSync(join(tmpdir(), 'grain-terminal-e2e-'));
  const home = join(dir, 'state'); const folder = join(dir, 'project');
  mkdirSync(home); mkdirSync(folder);
  if (extensions) {
    mkdirSync(join(home, 'skills/launch-copy'), { recursive: true });
    writeFileSync(join(home, 'skills/launch-copy/SKILL.md'), '---\nname: launch-copy\ndescription: Use for launch copy marketing tasks.\n---\nSKILL_E2E_MARKER: Never invent product prices.\n');
    writeFileSync(join(home, 'mcp.json'), JSON.stringify({ servers: { fixture: { command: process.execPath, args: [join(repo, 'tests/fixtures/mcp-server.ts')], trust: { enabled: true, allowTools: ['echo'] } } } }));
  }
  writeFileSync(join(folder, 'sum.cjs'), 'module.exports = (a, b) => a - b;\n');
  writeFileSync(join(folder, 'brief.md'), '# Launch brief\nAudience: independent designers.\nProduct: offline mood boards.\nPrice: not yet decided.\n');
  if (cliScript) {
    mkdirSync(join(dir, 'bin'));
    writeFileSync(join(dir, 'bin/codex'), `#!${process.execPath}\n${cliScript}`, { mode: 0o755 });
    const git = (...args: string[]) => execFileSync('git', args, { cwd: folder });
    git('init', '-q'); git('add', '.'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'baseline');
  }
  const requests: any[] = [];
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
    const body = await req.json(); requests.push(body); return respond(body);
  } });
  writeFileSync(join(home, 'config.json'), JSON.stringify({ provider: cliScript ? 'codex' : 'fixture', model: cliScript ? 'auto' : 'test-model', providers: {
    fixture: { kind: 'openai-compatible', baseUrl: `http://127.0.0.1:${server.port}/v1/chat/completions`, apiKeyEnv: 'GRAIN_FIXTURE_KEY', defaultModel: 'test-model' },
  } }));
  const command = process.env.GRAIN_E2E_BINARY ? [process.env.GRAIN_E2E_BINARY] : [process.execPath, join(repo, 'src/cli.ts')];
  const child = Bun.spawn([Bun.which('python3')!, join(repo, 'tests/fixtures/pty-driver.py'), ...command], {
    cwd: folder, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, GRAIN_HOME: home, GRAIN_FIXTURE_KEY: 'fixture-only',
      PATH: cliScript ? `${join(dir, 'bin')}:${process.env.PATH}` : process.env.PATH,
      ENGRAM_URL: 'http://127.0.0.1:1', TERM: 'xterm-256color', NO_COLOR: '1', GRAIN_PTY_TIMEOUT_SECONDS: '25', GRAIN_PTY_STEPS: JSON.stringify(steps) },
  });
  try {
    const [code, text, errors] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(code, `${errors}\n${text}`).toBe(0);
    expect(text).not.toContain('\x1b[?1049h'); expect(text).not.toContain('\x1b[2J');
    const journals = readdirSync(join(home, 'runs'), { recursive: true }).filter(file => String(file).endsWith('.jsonl'))
      .map(file => readFileSync(join(home, 'runs', String(file)), 'utf8')).join('\n');
    const artifacts = Object.fromEntries(readdirSync(folder).filter(file => file.endsWith('.md')).map(file => [file, readFileSync(join(folder, file), 'utf8')]));
    return { text, requests, source: readFileSync(join(folder, 'sum.cjs'), 'utf8'), journals, artifacts };
  } finally { child.kill(); server.stop(true); rmSync(dir, { recursive: true, force: true }); }
}

describe('real terminal, HTTP provider, and filesystem end to end', () => {
  test('bare grain loads a portable skill and brokers an approved MCP tool on its first turn', async () => {
    let turn = 0;
    const result = await scenario(body => {
      if (turn++ === 0) {
        return call('mcp__fixture__echo', { value: 'MCP_E2E_MARKER' });
      }
      return answer('MCP_AND_SKILL_COMPLETE');
    }, [
      { wait: 'grain>', send: 'Use launch-copy skill and the MCP echo tool for this marketing task.\r' },
      { wait: '[N]o', send: 'y\r' },
      { wait: 'MCP_AND_SKILL_COMPLETE', send: '' },
      { wait: 'grain>', send: '/quit\r' },
    ], undefined, true);
    expect(result.requests[0].messages[0].content).toContain('SKILL_E2E_MARKER');
    expect(result.requests[0].tools.map((tool: any) => tool.function.name)).toContain('mcp__fixture__echo');
    expect(result.requests[0].tools.map((tool: any) => tool.function.name)).not.toContain('mcp__fixture__blocked');
    expect(result.requests[1].messages.at(-1).content).toContain('MCP_E2E_MARKER');
    expect(result.journals).toContain('mcp__fixture__echo'); expect(result.journals).toContain('succeeded');
  }, 30_000);
  test('failed subscription subprocess edits remain undoable', async () => {
    const result = await scenario(() => answer('unused'), [
      { wait: 'grain>', send: 'Edit sum.cjs\r' },
      { wait: 'grain>', send: '/undo\r' },
      { wait: 'grain>', send: '/quit\r' },
    ], `import { writeFileSync } from 'node:fs';
writeFileSync('sum.cjs', 'partially edited');
console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'Partial progress'}}));
process.stderr.write('fixture child failed'); process.exitCode=1;`);
    expect(result.journals).toContain('failed');
    expect(result.source).toBe('module.exports = (a, b) => a - b;\n');
    expect(result.text).toContain('Undid 1 modified');
  }, 30_000);

  test('reads source notes and saves and reviews a marketing artifact without Git', async () => {
    let turn = 0;
    const copy = '# Launch copy\nOffline mood boards for independent designers.\n\nJoin the waitlist. Pricing will be announced.\n';
    const result = await scenario(body => {
      switch (turn++) {
        case 0: return call('read', { path: 'brief.md' });
        case 1:
          expect(body.messages.at(-1).content).toContain('Price: not yet decided');
          return call('write', { path: 'launch.md', content: copy });
        case 2: return call('read', { path: 'launch.md' });
        default:
          expect(body.messages.at(-1).content).toContain('Join the waitlist');
          return answer('DRAFT_REVIEWED. No pricing claims added.');
      }
    }, [
      { wait: 'grain>', send: '/mode execute\r' },
      { wait: 'grain>', send: 'Use brief.md to draft launch.md, then read it back. Do not publish.\r' },
      { wait: 'DRAFT_REVIEWED', send: '' },
      { wait: 'grain>', send: '/quit\r' },
    ]);
    expect(turn).toBe(4);
    expect(result.artifacts['launch.md']).toBe(copy);
    expect(result.artifacts['brief.md']).toContain('Price: not yet decided');
    expect(result.journals).toContain('succeeded');
  }, 30_000);
  test('reads, patches, tests, handles a tool error, and undoes in a non-git folder', async () => {
    let turn = 0;
    const result = await scenario(body => {
      const last = body.messages.at(-1);
      switch (turn++) {
        case 0: return call('read', { path: 'sum.cjs' });
        case 1:
          expect(last.content).toContain('a - b');
          return call('patch', { path: 'sum.cjs', old_string: 'a - b', new_string: 'a + b' });
        case 2:
          expect(last.content).toContain('Patched');
          return call('bash', { command: 'node -e "if(require(\'./sum.cjs\')(2,3)!==5)process.exit(1); console.log(\'SUM_TEST_OK\')"' });
        case 3:
          expect(last.content).toContain('SUM_TEST_OK');
          return call('read', { path: 'missing.cjs' }, 'missing');
        case 4:
          expect(last.content).toContain('Error reading file');
          return answer('Repair verified. Missing file handled.');
        default: return answer('Unexpected extra turn');
      }
    }, [
      { wait: 'grain>', send: '/mode execute\r' },
      { wait: 'grain>', send: 'Repair sum.cjs, test it, and check missing.cjs\r', columns: 42 },
      { wait: 'Repair verified.', send: '' },
      { wait: 'grain>', send: '/undo\r' },
      { wait: 'grain>', send: '/quit\r' },
    ]);
    expect(turn).toBe(5); expect(result.source).toContain('a - b');
    expect(result.text).toContain('SUM_TEST_OK'); expect(result.text).toContain('Undid 1 modified');
    expect(result.journals).toContain('tool_completed'); expect(result.journals).toContain('succeeded');
    expect(result.requests[0].tools.map((item: any) => item.function.name)).toContain('patch');
  }, 30_000);

  test('cancels a stalled stream then accepts another task', async () => {
    let turn = 0;
    const result = await scenario(() => turn++ === 0
      ? new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(sse({ content: 'STALL_READY' }))); } }), { headers: { 'content-type': 'text/event-stream' } })
      : answer('RECOVERED_AFTER_CANCEL'), [
      { wait: 'grain>', send: 'Wait for cancellation\r' },
      { wait: 'STALL_READY', send: '\x03' },
      { wait: 'grain>', send: 'Answer again\r' },
      { wait: 'RECOVERED_AFTER_CANCEL', send: '' },
      { wait: 'grain>', send: '\x04' },
    ]);
    expect(result.journals).toContain('cancelled'); expect(result.text).toContain('RECOVERED_AFTER_CANCEL');
  }, 30_000);

  test('Ctrl+C dismisses an approval without writing and multiline paste survives', async () => {
    let turn = 0;
    const result = await scenario(() => turn++ === 0
      ? call('patch', { path: 'sum.cjs', old_string: 'a - b', new_string: 'a + b' })
      : answer('PASTE_RECEIVED'), [
      { wait: 'grain>', send: 'Fix sum.cjs\r' },
      { wait: '[N]o', send: '\x03' },
      { wait: 'grain>', send: '\x1b[200~Explain this:\n  function hi() {\n    return 1;\n  }\x1b[201~\r' },
      { wait: 'PASTE_RECEIVED', send: '' },
      { wait: 'grain>', send: '/quit\r' },
    ]);
    expect(result.source).toContain('a - b');
    expect(result.requests.at(-1).messages.at(-1).content).toContain('\n  function hi() {\n    return 1;');
    expect(result.journals).toContain('cancelled');
  }, 30_000);

  test('provider failure returns to chat and the next task can succeed', async () => {
    let turn = 0;
    const result = await scenario(() => turn++ === 0 ? new Response('{"error":{"message":"fixture outage"}}', { status: 400 }) : answer('RECOVERED_AFTER_ERROR'), [
      { wait: 'grain>', send: 'Try a task\r' }, { wait: 'grain>', send: 'Try again\r' },
      { wait: 'RECOVERED_AFTER_ERROR', send: '' }, { wait: 'grain>', send: '/quit\r' },
    ]);
    expect(result.journals).toContain('failed'); expect(result.journals).toContain('succeeded');
  }, 30_000);
});
