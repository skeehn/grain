import * as readline from 'node:readline';
import { AgentMailbox } from './mailbox.js';
import { DurableAgentRuntime } from './runtime.js';
import { TaskGraphStore } from './store.js';
import { formatAgentDashboard } from '../tui/renderer.js';

export type DashboardAction =
  | { type: 'quit' }
  | { type: 'move'; delta: -1 | 1 }
  | { type: 'cancel' }
  | { type: 'steer'; message: string }
  | { type: 'refresh' };

export function parseDashboardKey(key: string): DashboardAction | undefined {
  if (key === 'q' || key === '\u0003') return { type: 'quit' };
  if (key === 'j' || key === '\u001b[B') return { type: 'move', delta: 1 };
  if (key === 'k' || key === '\u001b[A') return { type: 'move', delta: -1 };
  if (key === 'c') return { type: 'cancel' };
  if (key === 'r') return { type: 'refresh' };
  return undefined;
}

export async function watchAgentGraph(graphId: string, store = new TaskGraphStore()): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Agent watch requires an interactive terminal');
  const mailbox = new AgentMailbox(graphId);
  const runtime = new DurableAgentRuntime(store);
  let selected = 0;
  let closed = false;
  const render = () => {
    const graph = store.load(graphId);
    selected = Math.max(0, Math.min(selected, Math.max(0, graph.tasks.length - 1)));
    const task = graph.tasks[selected];
    process.stdout.write(`\x1b[2J\x1b[H${formatAgentDashboard(graph, mailbox.list())}\n\n`);
    process.stdout.write(`SELECTED  ${selected + 1}/${graph.tasks.length}  ${task?.role || 'none'}  ${task?.id || ''}\n`);
    process.stdout.write('CONTROLS  j/k or arrows select · c cancel · s steer · r refresh · q quit\n');
  };
  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    process.stdin.setRawMode(false);
    process.stdin.pause();
    process.stdin.removeListener('data', onData);
    process.stdout.write('\x1b[?25h\n');
  };
  const promptSteering = async () => {
    process.stdin.setRawMode(false);
    const answer = await new Promise<string>(resolve => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question('\nSteering message: ', value => { rl.close(); resolve(value.trim()); });
    });
    process.stdin.setRawMode(true);
    if (answer) {
      const task = store.load(graphId).tasks[selected];
      if (task) mailbox.send({ graphId, from: 'user', to: task.id, kind: 'steering', payload: { message: answer } });
    }
    render();
  };
  const onData = async (buffer: Buffer) => {
    const key = buffer.toString('utf8');
    if (key === 's') { await promptSteering(); return; }
    const action = parseDashboardKey(key);
    if (!action) return;
    if (action.type === 'quit') { cleanup(); return; }
    if (action.type === 'move') selected += action.delta;
    if (action.type === 'cancel') {
      const task = store.load(graphId).tasks[selected];
      if (task && !['succeeded', 'failed', 'cancelled'].includes(task.state)) runtime.cancel(graphId, task.id);
    }
    render();
  };
  process.stdout.write('\x1b[?25l');
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', onData);
  const timer = setInterval(render, 500);
  render();
  await new Promise<void>(resolve => {
    const check = setInterval(() => { if (closed) { clearInterval(check); resolve(); } }, 50);
  });
}
