import { execFileSync } from 'child_process';
import { existsSync, statSync } from 'fs';
import { resolve } from 'path';
import { agentLoop, type AgentUi, type AgentWorkspaceEvent } from '../agent/loop.js';
import { changedFileCount, undoLast } from '../agent/checkpoint.js';
import { loadConfig, saveConfig } from '../config.js';
import { listRuns, readRunEvents, RunEngine, RunJournal } from '../kernel/index.js';
import { TaskGraphStore } from '../orchestration/store.js';
import { createTemplate } from '../commands/agents.js';
import { ScheduleStore, type ScheduledJob } from '../schedules/index.js';
import { listSessions, workspaceKey } from '../session/store.js';
import { executeEngram } from '../tools/engram.js';
import { destroyShell, TOOLS, setToolCwd } from '../tools/index.js';
import { executeWorkspaceScan } from '../tools/workspace.js';
import { WikiEngine } from '../wiki/index.js';
import { parseComposerInput, type WorkspaceMode } from '../workspace/app.js';
import { resolveWorkspace } from '../workspace/root.js';
import { detectTerminalCapabilities } from './capabilities.js';
import { DifferentialRenderer } from './differential.js';
import { blankFrame, putText } from './frame.js';
import { layoutRun } from './layout.js';
import { projectRun } from './projector.js';
import { resolveTheme, type GrainThemeName } from './theme.js';

type TuiView = 'chat' | 'diff' | 'tools' | 'context' | 'memory' | 'history' | 'agents' | 'jobs' | 'help';

export interface TuiAppOptions {
  runId?: string;
  alternateScreen?: boolean;
  prompt?: string;
  model?: string;
  provider?: string;
  autoApprove?: boolean;
  concise?: boolean;
  maxTurns?: number;
  attachments?: string[];
}

const VIEWS: TuiView[] = ['chat', 'diff', 'tools', 'context', 'memory', 'history', 'agents', 'jobs'];
const HELP = [
  '/chat                      return to the conversation',
  '/diff /tools /context      inspect the current coding run',
  '/memory /history /agents   inspect durable state',
  '/files                     inspect the open project',
  '/wiki build|verify|search QUERY',
  '/agents MODE TASK          create a durable agent graph',
  '/jobs                      list scheduled jobs',
  '/jobs add NAME CRON -- TASK',
  '/jobs remove|enable|disable NAME',
  '/jobs run NAME             run a scheduled job now',
  '/open PATH                 open a project from general chat',
  '/model ID                  change the configured model',
  '/effort low|medium|high    set reasoning effort',
  '/settings                  show active configuration',
  '/undo                      revert the last task changes',
  '/mode ask|plan|execute     change approval behavior',
  '/theme field|studio|arcade|system',
  'Tab                        cycle inspector views',
  'Ctrl+L                     clear chat · Ctrl+C quit when idle',
].join('\n');

function clip(value: string, width: number): string {
  return value.length <= width ? value : `${value.slice(0, Math.max(0, width - 1))}…`;
}

function wrap(value: string, width: number): string[] {
  const out: string[] = [];
  for (const source of value.replace(/\r/g, '').split('\n')) {
    if (!source) { out.push(''); continue; }
    let line = source;
    while (line.length > width) { out.push(line.slice(0, width)); line = line.slice(width); }
    out.push(line);
  }
  return out;
}

function projectName(root?: string): string {
  if (!root) return 'general chat';
  const parts = root.split('/').filter(Boolean); return parts.at(-1) || root;
}

async function runWorkspaceTui(options: TuiAppOptions): Promise<void> {
  let capabilities = detectTerminalCapabilities();
  let renderer = new DifferentialRenderer(capabilities);
  let theme = resolveTheme(loadConfig().tui?.theme);
  let view: TuiView = 'chat'; let input = ''; let busy = false; let closed = false;
  let status = 'ready'; let currentRunId: string | undefined; let mode: WorkspaceMode = 'ask';
  let workspace = resolveWorkspace(process.cwd());
  if (workspace.root) setToolCwd(workspace.root);
  const transcript: string[] = ['Grain is ready. Type a task, or /help for controls.'];
  const panels = new Map<TuiView, string[]>(); panels.set('help', HELP.split('\n'));
  const approvedRisks = new Set<string>();
  let promptResolver: ((answer: string | null) => void) | undefined; let promptLabel = '';
  let activeController: AbortController | undefined;
  let streamLine = -1;

  const render = () => {
    if (closed) return;
    capabilities = detectTerminalCapabilities();
    const frame = blankFrame(capabilities.columns, capabilities.rows);
    frame.cells.forEach(cell => { cell.style.background = theme.canvas; cell.style.foreground = theme.text; });
    const width = frame.width; const height = frame.height;
    const config = loadConfig(); const header = ` GRAIN  ${projectName(workspace.root)}  ${workspace.mode.toUpperCase()}  ${config.provider}/${config.model || 'auto'} `;
    putText(frame, 0, 0, header.padEnd(width), { foreground: theme.text, background: theme.panel, bold: true });
    const tabs = VIEWS.map(name => name === view ? `[${name.toUpperCase()}]` : name).join('  ');
    putText(frame, 1, 1, clip(tabs, width - 2), { foreground: theme.accent, background: theme.canvas, bold: true });
    putText(frame, 2, 0, '─'.repeat(width), { foreground: theme.line });
    const bodyHeight = Math.max(1, height - 6); const bodyWidth = Math.max(8, width - 4);
    const source = view === 'chat' ? transcript : (panels.get(view) || [`/${view} to refresh this view`]);
    const lines = source.flatMap(line => wrap(line, bodyWidth));
    lines.slice(-bodyHeight).forEach((line, index) => putText(frame, 3 + index, 2, clip(line, bodyWidth),
      { foreground: /^×|error|failed/i.test(line) ? theme.danger : /^◆|✓/.test(line) ? theme.success : theme.text }));
    const state = busy ? status : promptResolver ? promptLabel : status;
    putText(frame, height - 3, 0, '─'.repeat(width), { foreground: theme.line, background: theme.panel });
    putText(frame, height - 2, 1, clip(`${mode.toUpperCase()} · ${state} · Tab views · /help`, width - 2), { foreground: busy ? theme.warning : theme.muted, background: theme.panel });
    const prefix = promptResolver ? '? ' : '› ';
    putText(frame, height - 1, 0, `${prefix}${input}`.padEnd(width), { foreground: theme.text, background: theme.panel });
    frame.cursor = { row: height - 1, column: Math.min(width - 1, prefix.length + input.length), visible: true };
    renderer.render(frame);
  };

  const add = (label: string, message: unknown) => {
    streamLine = -1;
    const text = typeof message === 'string' ? message : JSON.stringify(message, null, 2);
    transcript.push(...text.split('\n').map((line, index) => `${index === 0 ? label : ' '.repeat(label.length)}${line}`));
    if (transcript.length > 1500) transcript.splice(0, transcript.length - 1500);
    render();
  };

  const ui: AgentUi = {
    stream: text => {
      if (streamLine < 0) { transcript.push('assistant › '); streamLine = transcript.length - 1; }
      const chunks = text.replace(/\r/g, '').split('\n'); transcript[streamLine] += chunks.shift() || '';
      for (const chunk of chunks) { transcript.push(chunk); streamLine = transcript.length - 1; }
      render();
    },
    streamToolLine: line => add('  │ ', line),
    tool: (name, _input) => { status = `tool · ${name}`; add('◇ ', name); },
    result: (output, isError) => add(isError ? '× ' : '  ', output),
    success: message => add('◆ ', message), newLine: () => add('', ''), clearLine: () => {},
    warn: message => add('△ ', message), error: message => add('× ', message), info: message => add('· ', message), dim: message => add('  ', message),
    retryNotice: (attempt, max, seconds) => add('↻ ', `retrying ${attempt}/${max} in ${seconds}s`),
    spinner: label => { status = label || 'thinking'; render(); return { stop: () => { status = 'working'; render(); } }; },
    userPrompt: label => new Promise(resolvePrompt => {
      promptLabel = label || 'Your answer'; promptResolver = resolvePrompt; input = ''; status = 'waiting for input'; render();
    }),
  };

  const refreshView = async (target: TuiView) => {
    view = target; const root = workspace.root;
    try {
      if (target === 'diff') {
        if (!root) panels.set(target, ['No project is open. Use /open PATH first.']);
        else {
          const statusText = execFileSync('git', ['status', '--short'], { cwd: root, encoding: 'utf8' });
          const stat = execFileSync('git', ['diff', '--stat'], { cwd: root, encoding: 'utf8' });
          const diff = execFileSync('git', ['diff', '--no-ext-diff', '--unified=3'], { cwd: root, encoding: 'utf8', maxBuffer: 2_000_000 });
          const combined = [statusText && `STATUS\n${statusText}`, stat && `SUMMARY\n${stat}`, diff && `PATCH\n${diff}`].filter(Boolean).join('\n');
          panels.set(target, (combined || 'Working tree clean.').split('\n').slice(0, 500));
        }
      } else if (target === 'tools') {
        const recent = currentRunId ? readRunEvents(currentRunId).filter(event => event.type === 'tool_started' || event.type === 'tool_completed').slice(-20)
          .map(event => `${event.type === 'tool_completed' ? '◆' : '◇'} ${(event.payload as any).name || (event.payload as any).tool}`) : [];
        panels.set(target, ['AVAILABLE TOOLS', ...TOOLS.map(tool => `  ${tool.name} — ${tool.description}`), '', 'RECENT', ...(recent.length ? recent : ['  none'])]);
      } else if (target === 'context') {
        const event = currentRunId ? [...readRunEvents(currentRunId)].reverse().find(item => item.type === 'model_requested') : undefined;
        const manifest = (event?.payload as any)?.context_manifest;
        panels.set(target, manifest ? JSON.stringify(manifest, null, 2).split('\n') : ['No model context has been packed in this task yet.']);
      } else if (target === 'memory') {
        const stats = await executeEngram({ action: 'stats' }); const nodes = await executeEngram({ action: 'list', project: root });
        panels.set(target, ['MEMORY STATUS', ...String(stats.content).split('\n'), '', 'PROJECT MEMORY', ...String(nodes.content).split('\n').slice(0, 100)]);
      } else if (target === 'history') {
        const sessions = await listSessions(root ? workspaceKey(root) : undefined);
        panels.set(target, sessions.length ? sessions.map(session => `${session.id.slice(0, 8)}  ${session.title || 'conversation'}  ${session.updated_at}`) : ['No conversation history.']);
      } else if (target === 'agents') {
        const graphs = new TaskGraphStore().list();
        panels.set(target, graphs.length ? graphs.flatMap(graph => [`${graph.id.slice(0, 8)}  ${graph.mode}`, ...graph.tasks.map(task => `  ${task.state.padEnd(20)} ${task.role} · ${task.objective}`)]) : ['No durable agent graphs.']);
      } else if (target === 'jobs') {
        const jobs = new ScheduleStore().list();
        panels.set(target, jobs.length ? jobs.flatMap(job => [`${job.enabled ? '◆' : '○'} ${job.name}  ${job.cron}`, `  ${job.workspace}`, `  ${job.prompt}`, `  last: ${job.lastRunAt || 'never'}${job.lastError ? ` · ${job.lastError}` : ''}`]) : ['No scheduled jobs.', '', '/jobs add NAME CRON -- TASK']);
      } else if (target === 'help') panels.set(target, HELP.split('\n'));
    } catch (error) { panels.set(target, [`Failed to load ${target}: ${error instanceof Error ? error.message : String(error)}`]); }
    render();
  };

  const runTask = async (prompt: string, attachments: string[] = [], job?: ScheduledJob) => {
    if (busy) { add('△ ', 'A task is already running.'); return; }
    busy = true; status = 'starting'; view = 'chat'; add('you › ', prompt);
    activeController = new AbortController();
    const root = job?.workspace || workspace.root; const previous = process.cwd();
    if (job) process.chdir(job.workspace);
    try {
      await agentLoop({ prompt, resume: true, oneShot: true, provider: options.provider, model: options.model,
        autoApprove: options.autoApprove || mode === 'execute', concise: options.concise, maxTurns: options.maxTurns,
        attachments, workspaceKey: root ? workspaceKey(root) : 'general', mode, approvedRisks, ui,
        workspaceRoot: root, generalChat: !root, signal: activeController.signal,
        onEvent: (event: AgentWorkspaceEvent) => {
          if (event.type === 'run') currentRunId = event.runId;
          if (event.type === 'status') status = event.detail || event.status;
          if (event.type === 'tool') status = `tool · ${event.name}`;
          render();
        } });
      status = 'ready';
      if (job) new ScheduleStore().markRun(job.id, { runId: currentRunId });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error); status = 'failed'; add('× ', message);
      if (job) new ScheduleStore().markRun(job.id, { runId: currentRunId, error: message });
      if (/429|quota|rate.?limit|throttl/i.test(message) && !job) {
        const replacement = await ui.userPrompt('Rate-limited. Enter another model ID, or press Enter to keep the current model: ');
        if (replacement?.trim()) {
          const config = loadConfig(); saveConfig({ ...config, model: replacement.trim() }); options.model = replacement.trim();
          add('◆ ', `Model switched to ${replacement.trim()}. Retry your message when ready.`);
        } else add('△ ', 'Model unchanged. Retry when the provider is available.');
      }
    } finally { if (job) process.chdir(previous); activeController = undefined; busy = false; streamLine = -1; render(); }
  };

  const handleCommand = async (value: string) => {
    const parsed = parseComposerInput(value); const command = parsed.command || ''; const arg = parsed.argument;
    if (!command) { await refreshView('help'); return; }
    if (command === 'exit' || command === 'quit') { cleanup(); return; }
    if (command === 'help') { await refreshView('help'); return; }
    if (VIEWS.includes(command as TuiView) && !arg) { await refreshView(command as TuiView); return; }
    if (command === 'mode') {
      if (!['ask', 'plan', 'execute'].includes(arg)) add('△ ', 'Usage: /mode ask|plan|execute');
      else { mode = arg as WorkspaceMode; add('◆ ', `Mode: ${mode}`); } return;
    }
    if (command === 'model') {
      if (!arg) { add('△ ', 'Usage: /model MODEL_ID'); return; }
      const config = loadConfig(); saveConfig({ ...config, model: arg }); options.model = arg; add('◆ ', `Model: ${arg}`); return;
    }
    if (command === 'theme') {
      if (!['field', 'studio', 'arcade', 'system'].includes(arg)) { add('△ ', 'Usage: /theme field|studio|arcade|system'); return; }
      const config = loadConfig(); saveConfig({ ...config, tui: { ...config.tui!, theme: arg as GrainThemeName, schemaVersion: 2 } }); theme = resolveTheme(arg as GrainThemeName); render(); return;
    }
    if (command === 'effort') {
      if (!['low', 'medium', 'high'].includes(arg)) { add('△ ', 'Usage: /effort low|medium|high'); return; }
      const config = loadConfig(); saveConfig({ ...config, effort: arg as 'low' | 'medium' | 'high' }); add('◆ ', `Reasoning effort: ${arg}`); return;
    }
    if (command === 'settings') {
      const config = loadConfig(); add('· ', `Provider: ${config.provider}\nModel: ${config.model || 'auto'}\nEffort: ${config.effort || 'default'}\nTheme: ${config.tui?.theme}\nWorkspace: ${workspace.root || 'general chat'}\nRun: ${currentRunId || 'none'}`); return;
    }
    if (command === 'files') {
      if (!workspace.root) { add('△ ', 'No project is open. Use /open PATH.'); return; }
      const result = await executeWorkspaceScan({ path: '.', max_depth: 3 }); add('· ', result.content); return;
    }
    if (command === 'undo') {
      if (!changedFileCount()) { add('· ', 'Nothing to undo from the latest task.'); return; }
      const undone = undoLast(); add('◆ ', `Undid ${undone.restored.length} modified and ${undone.deleted.length} new files.`); await refreshView('diff'); return;
    }
    if (command === 'memory' && arg) {
      const result = await executeEngram({ action: 'search', query: arg, project: workspace.root }); panels.set('memory', String(result.content).split('\n')); view = 'memory'; render(); return;
    }
    if (command === 'wiki') {
      if (!workspace.root) { add('△ ', 'Open a project before using its wiki.'); return; }
      const [action = 'search', ...parts] = arg.split(/\s+/); const argument = parts.join(' '); const wiki = new WikiEngine();
      try {
        if (action === 'build') { const page = wiki.build(); add('◆ ', `Built ${page.path} from ${page.sources.length} sources.`); }
        else if (action === 'verify') { const result = wiki.verify(); add(result.valid ? '◆ ' : '△ ', result.valid ? 'Wiki provenance is current.' : result.stale.map(item => `${item.page}: ${item.source} — ${item.reason}`).join('\n')); }
        else if (action === 'search') { const pages = wiki.search(argument); add('· ', pages.length ? pages.map(page => `${page.id}  ${page.title}  ${page.status}`).join('\n') : 'No wiki results.'); }
        else if (action === 'show') { const page = wiki.get(argument); add('· ', page?.body || `Wiki page not found: ${argument}`); }
        else add('△ ', 'Usage: /wiki build|verify|search QUERY|show ID');
      } catch (error) { add('× ', error instanceof Error ? error.message : String(error)); }
      return;
    }
    if (command === 'agents' && arg) {
      const [agentMode, ...objectiveParts] = arg.split(/\s+/); const objective = objectiveParts.join(' ');
      if (!['solo', 'pair', 'research', 'plan', 'swarm', 'review-panel', 'repair-loop'].includes(agentMode) || !objective) { add('△ ', 'Usage: /agents pair|plan|research|swarm TASK'); return; }
      const graph = createTemplate(agentMode as any, objective); new TaskGraphStore().save(graph); add('◆ ', `Created ${graph.mode} graph ${graph.id.slice(0, 8)} with ${graph.tasks.length} tasks.`); await refreshView('agents'); return;
    }
    if (command === 'open') {
      const path = resolve(arg || '.');
      if (!existsSync(path) || !statSync(path).isDirectory()) { add('× ', `Not a directory: ${path}`); return; }
      process.chdir(path); workspace = resolveWorkspace(path);
      if (!workspace.root) { add('△ ', `${path} has no project marker; remaining in general chat.`); }
      else { process.chdir(workspace.root); setToolCwd(workspace.root); add('◆ ', `Opened ${workspace.root}`); }
      return;
    }
    if (command === 'jobs') {
      const store = new ScheduleStore(); const [action = 'list', name, ...rest] = arg.split(/\s+/);
      try {
        if (action === 'add') {
          const separator = rest.indexOf('--'); if (!name || separator < 1 || separator === rest.length - 1) throw new Error('Usage: /jobs add NAME CRON -- TASK');
          const cron = rest.slice(0, separator).join(' '); const prompt = rest.slice(separator + 1).join(' ');
          if (!workspace.root) throw new Error('Open a project before scheduling a coding task');
          store.add({ name, cron, prompt, workspace: workspace.root });
        } else if (action === 'remove') store.remove(name);
        else if (action === 'enable') store.setEnabled(name, true);
        else if (action === 'disable') store.setEnabled(name, false);
        else if (action === 'run') {
          const job = store.list().find(item => item.name === name || item.id === name); if (!job) throw new Error(`Unknown scheduled job: ${name}`);
          void runTask(job.prompt, [], job);
        }
        await refreshView('jobs');
      } catch (error) { add('× ', error instanceof Error ? error.message : String(error)); }
      return;
    }
    add('△ ', `Unknown command: /${command}. Use /help.`);
  };

  const submit = async () => {
    const value = input.trim(); input = ''; render();
    if (promptResolver) { const resolvePrompt = promptResolver; promptResolver = undefined; promptLabel = ''; resolvePrompt(value); return; }
    if (!value) return;
    if (value.startsWith('/')) await handleCommand(value);
    else { const parsed = parseComposerInput(value); void runTask(parsed.argument, [...(options.attachments || []), ...parsed.attachments]); }
  };

  const inputHandler = (data: Buffer) => {
    const keys = data.toString('utf8');
    // Arrow/function keys arrive as ESC-prefixed sequences. Ignore the whole
    // sequence instead of accidentally inserting its trailing bytes.
    if (keys.startsWith('\u001b') && keys.length > 1) return;
    for (const key of keys) {
      if (key === '\u0003') {
        if (busy) { status = activeController?.signal.aborted ? 'forcing cancellation' : 'cancelling'; activeController?.abort(); destroyShell(); }
        else if (!promptResolver) cleanup();
        else status = 'answer the active prompt or press Enter';
        continue;
      }
      if (key === '\u000c') { transcript.splice(0); continue; }
      if (key === '\t' && !promptResolver) { const index = VIEWS.indexOf(view); void refreshView(VIEWS[(index + 1) % VIEWS.length]); continue; }
      if (key === '\r' || key === '\n') { void submit(); continue; }
      if (key === '\u007f' || key === '\b') input = input.slice(0, -1);
      else if (key === '\u001b') { view = 'chat'; input = ''; }
      else if (key >= ' ') input += key;
    }
    render();
  };

  const resize = () => { capabilities = detectTerminalCapabilities(); renderer = new DifferentialRenderer(capabilities); process.stdout.write('\x1b[2J'); render(); };
  const alternate = options.alternateScreen !== false;
  const cleanup = () => {
    if (closed) return; closed = true; activeController?.abort(); destroyShell(); clearInterval(jobTimer); process.stdout.off('resize', resize); process.stdin.off('data', inputHandler);
    try { process.stdin.setRawMode(false); } catch {} process.stdin.pause(); process.off('SIGTERM', cleanup); process.off('exit', cleanup);
    process.stdout.write(`\x1b[0m\x1b[?25h${alternate ? '\x1b[?1049l' : '\n'}`);
  };
  if (alternate) process.stdout.write('\x1b[?1049h'); process.stdout.write('\x1b[2J\x1b[?25h');
  process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.on('data', inputHandler); process.stdout.on('resize', resize); process.on('SIGTERM', cleanup); process.on('exit', cleanup);
  const jobTimer = setInterval(() => {
    if (busy || promptResolver) return;
    const due = new ScheduleStore().due(); if (due[0]) void runTask(due[0].prompt, [], due[0]);
  }, 30_000); jobTimer.unref();
  render();
  if (options.prompt) void runTask(options.prompt, options.attachments || []);
  try { await new Promise<void>(resolveClosed => { const timer = setInterval(() => { if (closed) { clearInterval(timer); resolveClosed(); } }, 50); }); }
  finally { cleanup(); }
}

async function runJournalViewer(options: TuiAppOptions): Promise<void> {
  const runId = options.runId || listRuns().at(-1); if (!runId) throw new Error('No runs available. Start a task first.');
  let capabilities = detectTerminalCapabilities(); let renderer = new DifferentialRenderer(capabilities);
  let theme = resolveTheme(loadConfig().tui?.theme); let tick = 0; let closed = false; let cancelArmed = false;
  const alternate = options.alternateScreen !== false; const journal = RunJournal.open(runId); const engine = new RunEngine(journal);
  const render = () => { try { renderer.render(layoutRun(projectRun(readRunEvents(runId)), capabilities, theme, tick++)); } catch {} };
  const resize = () => { capabilities = detectTerminalCapabilities(); renderer = new DifferentialRenderer(capabilities); process.stdout.write('\x1b[2J'); render(); };
  const cleanup = () => { if (closed) return; closed = true; clearInterval(timer); process.stdout.off('resize', resize); process.stdin.off('data', input);
    try { process.stdin.setRawMode(false); } catch {} process.stdin.pause(); process.off('exit', cleanup); process.stdout.write(`\x1b[0m\x1b[?25h${alternate ? '\x1b[?1049l' : '\n'}`); };
  const input = (data: Buffer) => { const key = data.toString('utf8'); try {
    if (key === 'q') { cleanup(); return; } const current = engine.state();
    if (current.status === 'waiting_input' && current.pending_question && /^[1-6]$/.test(key)) { const choice = current.pending_question.choices[Number(key) - 1]; if (choice) engine.dispatch({ type: 'answer', questionId: current.pending_question.id, answer: choice }); }
    if (key === 'p') engine.dispatch({ type: current.status === 'paused' ? 'resume' : 'pause' });
    if (key === 't') { const names: GrainThemeName[] = ['field', 'studio', 'arcade', 'system']; theme = resolveTheme(names[(names.indexOf(theme.name) + 1) % names.length]); }
    if (key === '\u0003') { if (cancelArmed) engine.dispatch({ type: 'cancel', force: true }); else { cancelArmed = true; engine.dispatch({ type: 'cancel' }); } }
  } catch {} render(); };
  if (alternate) process.stdout.write('\x1b[?1049h'); process.stdout.write('\x1b[2J\x1b[?25l'); process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.on('data', input); process.stdout.on('resize', resize); process.on('exit', cleanup);
  const timer = setInterval(render, capabilities.reducedMotion ? 500 : 125); render();
  try { await new Promise<void>(resolveClosed => { const done = setInterval(() => { if (closed) { clearInterval(done); resolveClosed(); } }, 50); }); } finally { cleanup(); }
}

export async function runTui(options: TuiAppOptions = {}): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Full-screen TUI requires an interactive terminal; use --classic for line output');
  if (options.runId) await runJournalViewer(options); else await runWorkspaceTui(options);
}
