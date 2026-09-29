import { execFileSync, spawnSync } from 'child_process';
import { existsSync, statSync } from 'fs';
import { resolve } from 'path';
import { agentLoop, type AgentUi, type AgentWorkspaceEvent } from '../agent/loop.js';
import { changedFileCount, undoLast } from '../agent/checkpoint.js';
import { loadConfig, saveConfig, normalizeProvider, CLI_AGENT_PROVIDERS, type GrainConfig } from '../config.js';
import { listRuns, readRunEvents, RunService } from '../kernel/index.js';
import { TaskGraphStore } from '../orchestration/store.js';
import { AgentScheduler } from '../orchestration/scheduler.js';
import { executeProfileGraph } from '../orchestration/profile-executor.js';
import { createTemplate } from '../commands/agents.js';
import { ScheduleStore, type ScheduledJob } from '../schedules/index.js';
import { listSessions, workspaceKey, getLastSession, listCompactions } from '../session/store.js';
import { executeEngram, formatEngramStats, formatEngramStatus } from '../tools/engram.js';
import { destroyShell, TOOLS, setToolCwd } from '../tools/index.js';
import { executeWorkspaceScan } from '../tools/workspace.js';
import { WikiEngine } from '../wiki/index.js';
import { parseComposerInput, type WorkspaceMode } from '../workspace/app.js';
import { openWorkspace, type WorkspaceState } from '../workspace/root.js';
import { homedir } from 'os';
import { getWorkspaceFS } from '../workspace/index.js';
import { ScrollingTerminal, WELCOME } from './terminal.js';
import { StringDecoder } from 'node:string_decoder';
import { projectRun } from './projector.js';
import { type GrainThemeName } from './theme.js';
import { LineEditor } from './editor.js';
import { MODEL_CATALOG, resolveModelSelection } from './models.js';
import { buildModelRegistry, invalidateModelRegistry, type ModelEntry } from '../providers/index.js';
import { filterItems, type OverlayItem } from './overlay.js';
import { getSessionStats, statusLineText } from './status.js';
import { addNote, listWork, recallWork } from '../commands/work.js';
import { loadAgentProfiles } from '../orchestration/profiles.js';
import type { AgentProfileV1 } from '../orchestration/types.js';

type TuiView = 'chat' | 'diff' | 'tools' | 'context' | 'memory' | 'work' | 'history' | 'agents' | 'jobs' | 'help';

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
  allowDestructive?: boolean;
  reflect?: boolean;
}

const VIEWS: TuiView[] = ['chat', 'diff', 'tools', 'context', 'memory', 'work', 'history', 'agents', 'jobs'];

export function resolveTuiConnection(options: Pick<TuiAppOptions, 'provider' | 'model'>, config: GrainConfig): { provider: string; model: string } {
  const provider = options.provider || config.provider;
  if (options.model && (options.model.includes(':') || (CLI_AGENT_PROVIDERS as readonly string[]).includes(options.model))) {
    return resolveModelSelection(options.model, provider);
  }
  return { provider, model: options.model || (options.provider && options.provider !== config.provider ? 'auto' : config.model) || 'auto' };
}

export function transcriptOutputView(): TuiView { return 'chat'; }
export function takeQueuedFollowUp(queue: string[]): string | undefined { return queue.shift(); }

export function classifyTuiTaskError(message: string): { status: 'cancelled' | 'failed'; label: 'warn' | 'error'; message: string } {
  return message === 'SIGINT'
    ? { status: 'cancelled', label: 'warn', message: 'Cancelled.' }
    : { status: 'failed', label: 'error', message };
}

/** Panel text is plain strings; infer just enough structure to style it. */
export function panelLineKind(text: string): LineKind {
  if (/^(APPLY  |@@ |diff --git )/u.test(text) || text === 'PENDING APPLY') return 'heading';
  if (text.startsWith('+') && !text.startsWith('+++')) return 'success';
  if (text.startsWith('-') && !text.startsWith('---')) return 'error';
  if (/^[A-Z][A-Z0-9 ·/-]+$/u.test(text.trim()) && text.trim().length > 2) return 'heading';
  if (/^\s*(×|error|failed)/i.test(text)) return 'error';
  if (/^\s*(✓|◆)/.test(text)) return 'success';
  if (/^\s*(!|△|warn)/i.test(text)) return 'warn';
  if (/^\s{2,}/.test(text)) return 'dim';
  return 'assistant';
}

export const HELP_LINES = [
  'MODELS',
  '  /model                       pick subscriptions, APIs, and local models',
  '  /model grok|codex|claude-code  child CLI (own tools) · grokbot = grok',
  '  /model xai:MODEL · openrouter:MODEL  Grain-native tools, diffs, /undo',
  '  /effort low|medium|high      reasoning effort where the model supports it',
  'WORK',
  '  type a task · /open PATH or /cd PATH · /attach PATH · /mode ask|plan|execute',
  '  /steer MESSAGE while running · /budget turns N · /undo last change',
  'WORK MEMORY',
  '  /note TEXT                   remember a decision or constraint',
  '  /work                        what you have done here, newest first',
  '  /recall QUERY [--all]        search past work; --all spans every repo',
  '  /wiki build|verify           regenerate repo docs · check they match the code',
  'INSPECT',
  '  /diff changes · /tools activity · /context explain · /files tree',
  '  /memory [status|search QUERY|inspect ID] · /history · /wiki ACTION',
  'ORCHESTRATE',
  '  /agent [NAME]                Grain-native main, or a subscription sub-agent',
  '  /agents MODE TASK · /workflow MODE TASK · /loop TASK · /jobs …',
  'MEMORY ADMIN',
  '  /memory edit ID CONTENT · /memory forget ID · /memory export|rebuild',
  'KEYS',
  '  @file Tab attach · Up/Down history · terminal scrollback · Ctrl+C cancel',
  '  Ctrl+D quit · bracketed paste for multiline input · /quit exit',
];

/** Transcript lines carry their role so the renderer can style them. */
export type LineKind = 'user' | 'assistant' | 'tool' | 'result' | 'success' | 'warn' | 'error' | 'info' | 'dim' | 'heading';

export interface TranscriptLine { kind: LineKind; text: string }

const GUTTER: Record<LineKind, string> = {
  user: '> ', assistant: '', tool: '+ ', result: '| ', success: '[ok] ',
  warn: '[!] ', error: '[error] ', info: '* ', dim: '  ', heading: '',
};

export function lineStyleRole(kind: LineKind): 'accent' | 'text' | 'muted' | 'success' | 'warning' | 'danger' | 'evidence' {
  switch (kind) {
    case 'user': return 'accent';
    case 'tool': return 'evidence';
    case 'success': return 'success';
    case 'warn': return 'warning';
    case 'error': return 'danger';
    case 'info': case 'dim': case 'result': return 'muted';
    case 'heading': return 'accent';
    default: return 'text';
  }
}

function clip(value: string, width: number): string {
  return value.length <= width ? value : `${value.slice(0, Math.max(0, width - 1))}…`;
}

/**
 * Wrap for the body panel, preserving interior whitespace on lines that fit.
 *
 * Collapsing runs of spaces unconditionally destroyed every aligned column the
 * panels produce — help tables, `git status`, `--stat` output, and any code the
 * agent prints. Only a line that genuinely overflows gets re-flowed.
 */
export function wrapTuiText(value: string, width: number): string[] {
  if (width < 2) return [''];
  const out: string[] = [];
  for (const source of value.replace(/\r/g, '').replace(/\t/g, '  ').split('\n')) {
    if (!source) { out.push(''); continue; }
    if (source.length <= width) { out.push(source); continue; }
    const indent = source.match(/^\s*/u)?.[0] || '';
    const words = source.trimStart().split(/\s+/u); let line = indent;
    for (const word of words) {
      const separator = line.trim().length ? ' ' : '';
      if (line.length + separator.length + word.length <= width) { line += separator + word; continue; }
      if (line.trim()) out.push(line);
      if (indent.length + word.length <= width) line = indent + word;
      else {
        let remaining = word;
        while (indent.length + remaining.length > width) {
          const room = Math.max(1, width - indent.length - 1);
          out.push(`${indent}${remaining.slice(0, room)}…`); remaining = remaining.slice(room);
        }
        line = indent + remaining;
      }
    }
    if (line.trim() || !out.length) out.push(line);
  }
  return out;
}

export function formatViewTabs(active: TuiView, width: number): string {
  const full = VIEWS.map(name => name === active ? `[${name.toUpperCase()}]` : name).join('  ');
  if (full.length <= width) return full;
  const neighbors = VIEWS.filter(name => name !== active);
  const compact = [`[${active.toUpperCase()}]`, ...neighbors.map(name => name.slice(0, 1).toUpperCase())].join(' ');
  return clip(compact, width);
}

export function projectName(state: { cwd?: string; projectRoot?: string; root?: string }): string {
  const path = state.projectRoot || state.root || state.cwd;
  if (!path) return 'folder';
  const name = path.split('/').filter(Boolean).at(-1) || path;
  return state.projectRoot || state.root ? name : `${name} · folder`;
}

export function collectWorkingTreeDiff(root: string): string {
  const statusText = execFileSync('git', ['status', '--short'], { cwd: root, encoding: 'utf8' });
  const stat = execFileSync('git', ['diff', '--stat'], { cwd: root, encoding: 'utf8' });
  const tracked = execFileSync('git', ['diff', '--no-ext-diff', '--unified=3'], { cwd: root, encoding: 'utf8', maxBuffer: 2_000_000 });
  const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' })
    .split('\n').filter(Boolean).slice(0, 50);
  const untrackedPatches = untracked.map(path => spawnSync('git', ['diff', '--no-index', '--unified=3', '--', '/dev/null', path], {
    cwd: root, encoding: 'utf8', maxBuffer: 2_000_000,
  }).stdout || '').filter(Boolean).join('\n');
  return [statusText && `STATUS\n${statusText}`, stat && `SUMMARY\n${stat}`, (tracked || untrackedPatches) && `PATCH\n${tracked}${untrackedPatches}`]
    .filter(Boolean).join('\n') || 'Working tree clean.';
}

async function runWorkspaceTui(options: TuiAppOptions): Promise<void> {
  if (options.model) options = { ...options, ...resolveTuiConnection(options, loadConfig()) };
  const terminal = new ScrollingTerminal();
  terminal.setTheme(loadConfig().tui?.theme);
  let view: TuiView = 'chat'; const editor = new LineEditor(); let busy = false; let closed = false;
  let status = 'ready'; let currentRunId: string | undefined; let mode: WorkspaceMode = 'ask';
  let workspace: WorkspaceState = openWorkspace(process.cwd());
  setToolCwd(workspace.projectRoot || workspace.cwd);
  let lastPanel: string[] | undefined;
  let lastView = 'chat';
  let commandBusy = false;
  let taskPromise: Promise<void> | undefined;
  const panels = new Map<TuiView, string[]>(); panels.set('help', HELP_LINES);
  const approvedRisks = new Set<string>();
  let promptResolver: ((answer: string | null) => void) | undefined;
  let promptRejecter: ((error: Error) => void) | undefined;
  let activeController: AbortController | undefined;
  const steeringQueue: string[] = [];
  const applyDiffLog: string[] = [];
  const pendingAttachments: string[] = [...(options.attachments || [])];
  let activeProfile: AgentProfileV1 | undefined;
  const render = () => {
    if (closed) return;
    if (view !== 'chat') {
      const lines = panels.get(view);
      if (lines && (lines !== lastPanel || view !== lastView)) terminal.block(view.toUpperCase(), lines.join('\n'));
      lastPanel = lines;
    }
    lastView = view;
    if (promptResolver) terminal.prompt('? ', editor.value(), editor.cursorIndex());
    else if (!busy && !commandBusy) terminal.prompt('grain> ', editor.value(), editor.cursorIndex());
  };

  const add = (kind: LineKind, message: unknown) => {
    if (closed) return;
    view = 'chat';
    const text = typeof message === 'string' ? message : JSON.stringify(message, null, 2);
    terminal.line(GUTTER[kind] + text, lineStyleRole(kind));
    render();
  };

  let toolStarted = 0;
  let streamedLines = 0;
  const ui: AgentUi = {
    stream: text => { if (!closed) terminal.stream(text); },
    streamToolLine: line => {
      if (closed) return;
      if (streamedLines++ < 200) terminal.line('| ' + line);
      else if (streamedLines === 201) terminal.line('| ... further output saved in run journal');
    },
    tool: (name, input) => {
      toolStarted = Date.now(); streamedLines = 0;
      status = 'tool: ' + name;
      const pending = input && typeof input === 'object' && '_streaming' in input;
      terminal.block(name, pending ? 'Preparing tool call...' : JSON.stringify(input, null, 2)?.slice(0, 1000) || '');
    },
    result: (output, isError) => {
      if (!streamedLines) {
        const text = typeof output === 'string' ? output : JSON.stringify(output, null, 2);
        const lines = text.split('\n');
        terminal.line(lines.slice(0, 20).map(line => '| ' + line).join('\n'));
        if (lines.length > 20) terminal.line('| ... ' + (lines.length - 20) + ' more lines saved in run journal');
      }
      terminal.line('+-- ' + (isError ? 'failed' : 'done') + ' (' + ((Date.now() - toolStarted) / 1000).toFixed(1) + 's)', isError ? 'danger' : 'success');
    },
    success: message => add('success', message), newLine: () => terminal.line(), clearLine: () => terminal.clearPrompt(),
    warn: message => add('warn', message), error: message => add('error', message), info: message => add('info', message),
    dim: message => add('dim', message),
    retryNotice: (attempt, max, seconds) => add('info', 'retrying ' + attempt + '/' + max + ' in ' + seconds + 's'),
    spinner: label => { status = label || 'thinking'; terminal.line('(o.o) ' + status, 'muted'); return { stop() {} }; },
    userPrompt: label => new Promise((resolvePrompt, rejectPrompt) => {
      if (closed || activeController?.signal.aborted) { rejectPrompt(new Error('SIGINT')); return; }
      promptResolver = resolvePrompt; promptRejecter = rejectPrompt;
      editor.clear(); terminal.line(label || 'Your answer'); render();
    }),
  };

  const refreshView = async (target: TuiView) => {
    view = target;
    try {
      if (target === 'diff') {
        const pending = applyDiffLog.length ? ['PENDING APPLY', ...applyDiffLog, ''] : [];
        if (!workspace.projectRoot) panels.set(target, pending.length ? pending : ['Not a git project. /open PATH to a repository for diffs.']);
        else {
          panels.set(target, [...pending, ...collectWorkingTreeDiff(workspace.projectRoot).split('\n')].slice(0, 500));
        }
      } else if (target === 'tools') {
        const recent = currentRunId ? readRunEvents(currentRunId).filter(event => event.type === 'tool_started' || event.type === 'tool_completed').slice(-20)
          .map(event => `${event.type === 'tool_completed' ? '◆' : '◇'} ${(event.payload as any).name || (event.payload as any).tool}`) : [];
        panels.set(target, ['AVAILABLE TOOLS', ...TOOLS.map(tool => `  ${tool.name} — ${tool.description}`), '', 'RECENT', ...(recent.length ? recent : ['  none'])]);
      } else if (target === 'context') {
        const event = currentRunId ? [...readRunEvents(currentRunId)].reverse().find(item => item.type === 'model_requested') : undefined;
        const manifest = (event?.payload as any)?.context_manifest;
        const sessionId = await getLastSession(workspace.projectRoot ? workspaceKey(workspace.projectRoot) : `folder:${workspaceKey(workspace.cwd)}`);
        const compactions = sessionId ? await listCompactions(sessionId) : [];
        panels.set(target, [...(manifest ? JSON.stringify(manifest, null, 2).split('\n') : ['No model context has been packed in this task yet.']),
          '', 'COMPACTIONS', ...(compactions.length ? compactions.slice(-10).map(item =>
            `${item.id.slice(0, 8)}  ${item.tokens_before}→${item.tokens_after} tokens  ${item.source_entry_ids.length} sources`) : ['  none'])]);
      } else if (target === 'memory') {
        const connection = await executeEngram({ action: 'status' }); const stats = await executeEngram({ action: 'stats' });
        const nodes = await executeEngram({ action: 'list', project: workspace.projectRoot });
        panels.set(target, [...formatEngramStatus(String(connection.content)).split('\n'), '', ...formatEngramStats(String(stats.content)).split('\n'),
          '', 'PROJECT MEMORY', ...String(nodes.content).split('\n').slice(0, 100)]);
      } else if (target === 'work') {
        panels.set(target, workspace.projectRoot ? listWork(40, true).split('\n')
          : ['Folder mode — /note still stores memory. /open PATH to record a git work log.']);
      } else if (target === 'history') {
        const sessions = await listSessions(workspace.projectRoot ? workspaceKey(workspace.projectRoot) : `folder:${workspaceKey(workspace.cwd)}`);
        panels.set(target, sessions.length ? sessions.map(session => `${session.id.slice(0, 8)}  ${session.title || 'conversation'}  ${session.updated_at}`) : ['No conversation history.']);
      } else if (target === 'agents') {
        const graphs = new TaskGraphStore().list();
        panels.set(target, graphs.length ? graphs.flatMap(graph => [`${graph.id.slice(0, 8)}  ${graph.mode}`, ...graph.tasks.map(task => `  ${task.state.padEnd(20)} ${task.role} · ${task.objective}`)]) : ['No durable agent graphs.']);
      } else if (target === 'jobs') {
        const jobs = new ScheduleStore().list();
        panels.set(target, jobs.length ? jobs.flatMap(job => [`${job.enabled ? '◆' : '○'} ${job.name}  ${job.cron}`, `  ${job.workspace}`, `  ${job.prompt}`, `  last: ${job.lastRunAt || 'never'}${job.lastError ? ` · ${job.lastError}` : ''}`]) : ['No scheduled jobs.', '', '/jobs add NAME CRON -- TASK']);
      } else if (target === 'help') panels.set(target, HELP_LINES);
    } catch (error) { panels.set(target, [`Failed to load ${target}: ${error instanceof Error ? error.message : String(error)}`]); }
    render();
  };

  const runTask = async (prompt: string, attachments: string[] = [], job?: ScheduledJob) => {
    if (busy) {
      steeringQueue.push(prompt);
      if (currentRunId) {
        try { new RunService().steer(currentRunId, prompt); }
        catch (error) { add('warn', `Queued locally; durable steering failed: ${error instanceof Error ? error.message : String(error)}`); return; }
      }
      add('info', 'Queued for the next safe turn boundary.'); return;
    }
    applyDiffLog.length = 0;
    busy = true; status = 'starting'; view = 'chat'; add('user', prompt);
    activeController = new AbortController();
    const root = job?.workspace || workspace.projectRoot; const previous = process.cwd();
    const folder = workspace.cwd;
    try {
      if (job) process.chdir(job.workspace);
      if (activeProfile && !['grain-native', 'direct-api'].includes(activeProfile.executor)) {
        if (!root) throw new Error('Open a Git project before running an external coding-agent profile.');
        const write = activeProfile.permissions.write === 'allow' || activeProfile.permissions.write === 'ask';
        if (write && activeProfile.permissions.write === 'ask') {
          const approved = await ui.userPrompt(`Allow ${activeProfile.id} to write in an isolated worktree? [y/N] `);
          if (!/^y(?:es)?$/iu.test(approved || '')) throw new Error('Profile write was not approved.');
        }
        const scheduler = new AgentScheduler(); const graph = scheduler.createGraph('solo');
        const driver = scheduler.addTask(graph, { role: write ? 'driver' : 'researcher', objective: prompt,
          expectedArtifact: write ? 'isolated verified patch' : 'evidence-backed response', write, profile: activeProfile.id,
          executor: activeProfile.executor, provider: activeProfile.provider, model: activeProfile.model, budget: activeProfile.budget });
        if (write) scheduler.addTask(graph, { role: 'verifier', objective: `Independently verify: ${prompt}`,
          expectedArtifact: 'verification verdict with evidence', dependencies: [driver.id], profile: activeProfile.id,
          executor: activeProfile.executor, provider: activeProfile.provider, model: activeProfile.model, budget: activeProfile.budget });
        const graphStore = new TaskGraphStore(); graphStore.save(graph); status = `agent · ${activeProfile.id}`;
        const execution = await executeProfileGraph(graph, root, graphStore, activeController.signal); currentRunId = execution.runId;
        if (activeController.signal.aborted) throw new Error('SIGINT');
        const failed = execution.graph.tasks.filter(task => task.state !== 'succeeded');
        if (failed.length) throw new Error(failed.map(task => `${task.role}: ${task.lastError || task.state}`).join(' | '));
        for (const task of execution.graph.tasks) add(task.role === 'verifier' ? 'success' : 'assistant', task.result?.summary || task.state);
        if (write) add('success', `Verified patch is isolated in graph ${graph.id.slice(0, 8)}. Inspect it with grain agents show ${graph.id}, then merge with grain agents merge ${graph.id}.`);
        status = 'ready'; return;
      }
      const profilePrompt = activeProfile?.prompt ? `${activeProfile.prompt}\n\nUser objective:\n${prompt}` : prompt;
      await agentLoop({ prompt: profilePrompt, resume: true, oneShot: true, provider: activeProfile?.provider || options.provider,
        model: activeProfile?.model || options.model,
        autoApprove: options.autoApprove || mode === 'execute', concise: options.concise, maxTurns: options.maxTurns,
        attachments, workspaceKey: root ? workspaceKey(root) : `folder:${workspaceKey(folder)}`, mode, approvedRisks, ui,
        workspaceRoot: root, cwd: folder, allowWrites: Boolean(root) || folder !== homedir(),
        generalChat: !root, signal: activeController.signal,
        allowDestructive: options.allowDestructive, reflect: options.reflect,
        drainSteering: () => steeringQueue.splice(0),
        onEvent: (event: AgentWorkspaceEvent) => {
          if (event.type === 'run') currentRunId = event.runId;
          if (event.type === 'status') status = event.detail || event.status;
          if (event.type === 'tool') status = `tool · ${event.name}`;
          if (event.type === 'apply_diff') {
            applyDiffLog.push(...event.unified.split('\n'));
            if (applyDiffLog.length > 800) applyDiffLog.splice(0, applyDiffLog.length - 800);
          }
          render();
        } });
      status = 'ready';
      if (job) new ScheduleStore().markRun(job.id, { runId: currentRunId });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error); const failure = classifyTuiTaskError(message);
      status = failure.status; add(failure.label, failure.message);
      if (job) new ScheduleStore().markRun(job.id, { runId: currentRunId, error: message });
      // Being rate-limited or out of credit is the most common way a session
      // stalls. Offer the full picker rather than demanding a model id from
      // memory — switching to a subscription or local model is usually one key.
      if (/429|quota|rate.?limit|throttl|credit balance|usage limit|insufficient/i.test(message) && !job) {
        add('info', 'That provider is unavailable right now. Choose another model to continue.');
        await openModelPicker();
      }
    } finally {
      if (job) process.chdir(previous); activeController = undefined; busy = false;
      if (!closed) terminal.line(statusLineText(getSessionStats(), mode, loadConfig().effort), 'muted'); render();
      // A run can finish before it reaches another turn boundary. Preserve the
      // queued instruction by starting it as the next resumable conversation.
      const followUp = takeQueuedFollowUp(steeringQueue);
      if (followUp && !closed) queueMicrotask(() => { if (!closed) startTask(followUp); });
    }
  };

  const startTask = (prompt: string, attachments: string[] = [], job?: ScheduledJob) => {
    const alreadyRunning = busy;
    const promise = runTask(prompt, attachments, job).catch(error => add('error', String(error)));
    if (!alreadyRunning) taskPromise = promise;
  };

  /** Numbered lists stay readable in native terminal scrollback. */
  const pick = async <T,>(title: string, items: OverlayItem<T>[], filter = ''): Promise<{ value: T | null; item?: OverlayItem<T> }> => {
    let visible = filterItems(items, filter);
    while (!closed) {
      terminal.block(title, visible.slice(0, 40).map((item, index) =>
        String(index + 1).padStart(2) + '. ' + (item.current ? '* ' : '') + item.label + (item.disabled ? ' [unavailable]' : '') + '  ' + (item.fix || item.hint || '')
      ).join('\n') || 'No matches');
      if (visible.length > 40) terminal.line('Showing 40 of ' + visible.length + '. Type a name to narrow the list.');
      const answer = (await ui.userPrompt('Choose a number, or type to filter (blank cancels)'))?.trim();
      if (!answer) return { value: null };
      if (/^\d+$/u.test(answer)) {
        const item = visible[Number(answer) - 1];
        if (item) return { value: item.value, item };
        add('warn', 'Choose a listed number.'); continue;
      }
      const matches = filterItems(items, answer);
      if (matches.length === 1) return { value: matches[0].value, item: matches[0] };
      if (!matches.length) { add('warn', 'No match for "' + answer + '".'); continue; }
      visible = matches;
    }
    return { value: null };
  };

  const openFileMention = async () => {
    const mention = editor.mention();
    if (!mention) return false;
    const composer = editor.value(); const cursor = editor.cursorIndex();
    setToolCwd(workspace.projectRoot || workspace.cwd);
    let files: string[] = [];
    try { files = getWorkspaceFS().list('.', 5).filter(path => path && !path.endsWith('/')).slice(0, 400); }
    catch { files = []; }
    if (!files.length) { add('warn', 'No project files to attach.'); return true; }
    try {
      const chosen = await pick('Attach a file  (@path)', files.map(path => ({ label: path, value: path })), mention.query);
      editor.setValue(composer, cursor);
      if (chosen.value) editor.replaceMention(chosen.value);
    } catch (error) { editor.setValue(composer, cursor); if (!(error instanceof Error && error.message === 'SIGINT')) throw error; }
    render();
    return true;
  };

  const applyModelSelection = (provider: string, model: string) => {
    const resolved = normalizeProvider(provider);
    const config = loadConfig();
    saveConfig({ ...config, provider: resolved, model });
    options.provider = resolved; options.model = model;
    const stats = getSessionStats(); stats.provider = resolved; stats.model = model;
    add('success', `Model: ${resolved} · ${model}`);
    if ((CLI_AGENT_PROVIDERS as readonly string[]).includes(resolved)) {
      add('info', 'This agent runs with its own tools and login. Grain-native tools, diffs, and /undo follow the working tree.');
    } else {
      add('info', 'Grain-native: this model uses Grain tools. Delegate claude-code, codex, or grok as sub-agents when useful.');
    }
  };

  const openModelPicker = async () => {
    const config = loadConfig();
    const connection = resolveTuiConnection(options, config);
    status = 'loading models'; render();
    let entries: ModelEntry[] = [];
    try { entries = await buildModelRegistry({ workspaceRoot: workspace.projectRoot || workspace.cwd }); }
    catch (error) { add('warn', `Live catalog unavailable: ${error instanceof Error ? error.message : String(error)}`); }
    status = busy ? status : 'ready';
    const items: OverlayItem<ModelEntry | null>[] = entries.length
      ? entries.map(entry => ({
          label: entry.label,
          hint: entry.hint,
          value: entry,
          disabled: !entry.available,
          fix: entry.fix,
          current: entry.provider === connection.provider && entry.model === connection.model,
        }))
      : MODEL_CATALOG.map(choice => ({
          label: `${choice.provider} · ${choice.model}`, hint: choice.hint,
          value: { id: `${choice.provider}:${choice.model}`, provider: choice.provider, model: choice.model,
            label: choice.label, hint: choice.hint, kind: 'api', available: true } as ModelEntry,
          current: choice.provider === connection.provider && choice.model === connection.model,
        }));
    const chosen = await pick('Choose a model — subscriptions first, then APIs and local', items);
    if (!chosen.value) return;
    const entry = chosen.value;
    if (!entry.available) {
      add('warn', `${entry.label} is not usable yet.\n${entry.fix || 'Configure this provider, then reopen /model.'}`);
      return;
    }
    applyModelSelection(entry.provider, entry.model);
  };

  const applyAgentProfile = (selected: AgentProfileV1) => {
    activeProfile = selected.id === 'default' ? undefined : selected;
    add('success', `Agent: ${selected.id} · ${selected.executor} · ${selected.provider || 'inherited'}/${selected.model || 'auto'}`);
    if (selected.executor === 'grain-native' || selected.executor === 'direct-api') {
      add('info', 'Main agent is Grain-native. Subscriptions (claude-code, codex, grok) are available as sub-agents via delegate.');
    } else {
      add('info', 'This profile runs a subscription CLI as the session agent. /model still selects Grain-native models when you switch back with /agent default.');
    }
  };

  const openAgentPicker = async () => {
    const profiles = loadAgentProfiles(workspace.projectRoot);
    const items: OverlayItem<AgentProfileV1>[] = profiles.map(profile => ({
      label: profile.id,
      hint: `${profile.executor} · ${profile.provider || 'inherited'}/${profile.model || 'auto'}`,
      value: profile,
      current: (activeProfile?.id || 'default') === profile.id,
    }));
    const chosen = await pick('Choose an agent — Grain-native main, or a subscription CLI', items);
    if (chosen.value) applyAgentProfile(chosen.value);
  };

  const handleCommand = async (value: string) => {
    const parsed = parseComposerInput(value); const command = parsed.command || ''; const arg = parsed.argument;
    if (!command) { await refreshView('help'); return; }
    if (busy && !['help', 'steer', 'tools', 'context', 'settings'].includes(command)) {
      add('warn', 'A task is running. Ctrl+C cancels it; /steer MESSAGE queues an instruction.'); return;
    }
    if (command === 'plan') { mode = 'plan'; add('success', 'Mode: plan'); return; }
    if (command === 'exit' || command === 'quit') { cleanup(); return; }
    if (command === 'help') { await refreshView('help'); return; }
    if (VIEWS.includes(command as TuiView) && !arg) { await refreshView(command as TuiView); return; }
    if (command === 'mode') {
      if (!['ask', 'plan', 'execute'].includes(arg)) add('warn', 'Usage: /mode ask|plan|execute');
      else { mode = arg as WorkspaceMode; add('success', `Mode: ${mode}`); } return;
    }
    if (command === 'model') {
      const config = loadConfig();
      if (!arg) { await openModelPicker(); return; }
      if (arg === 'refresh') { invalidateModelRegistry(); add('info', 'Model catalog refreshed.'); await openModelPicker(); return; }
      const selected = resolveModelSelection(arg, options.provider || config.provider, workspace.projectRoot);
      applyModelSelection(selected.provider, selected.model);
      return;
    }
    if (command === 'note') {
      if (!arg.trim()) { add('warn', 'Usage: /note WHAT YOU WANT TO REMEMBER'); return; }
      try { add('success', await addNote(arg.trim())); }
      catch (error) { add('error', error instanceof Error ? error.message : String(error)); }
      return;
    }
    if (command === 'work' || command === 'worklog') {
      if (!workspace.projectRoot) { add('info', 'No git project — notes go to /note (engram). /open PATH for a work log.'); return; }
      try { panels.set('work', listWork(40, true).split('\n')); view = 'work'; render(); }
      catch (error) { add('error', error instanceof Error ? error.message : String(error)); }
      return;
    }
    if (command === 'recall') {
      if (!arg.trim()) { add('warn', 'Usage: /recall QUERY [--all]  (--all searches every repository)'); return; }
      if (!workspace.projectRoot) { add('warn', 'Open a project to search its work log, or /memory search QUERY.'); return; }
      const allRepos = /(^|\s)--all(\s|$)/u.test(arg);
      status = 'recalling'; render();
      try {
        const found = await recallWork(arg.replace(/(^|\s)--all(\s|$)/u, ' ').trim(), { allRepos });
        panels.set('work', found.split('\n')); view = 'work';
      } catch (error) { add('error', error instanceof Error ? error.message : String(error)); }
      status = busy ? status : 'ready'; render(); return;
    }
    if (command === 'agent') {
      const profiles = loadAgentProfiles(workspace.projectRoot);
      if (!arg) { await openAgentPicker(); return; }
      const wanted = normalizeProvider(arg);
      const selected = profiles.find(profile => profile.id === wanted || profile.id === arg);
      if (!selected) { add('warn', `Unknown agent profile: ${arg}. Try grok, codex, claude-code, openrouter, xai, or default.`); return; }
      applyAgentProfile(selected); return;
    }
    if (command === 'workflow' || command === 'loop') {
      const [requestedMode, ...words] = command === 'loop' ? ['repair-loop', ...arg.split(/\s+/u)] : arg.split(/\s+/u);
      const objective = words.join(' ').trim();
      const modes = ['solo', 'pair', 'research', 'plan', 'swarm', 'review-panel', 'repair-loop', 'migration-loop', 'benchmark-loop', 'recursive-delivery'];
      if (!modes.includes(requestedMode) || !objective) { add('warn', `Usage: /${command} ${command === 'loop' ? 'TASK' : 'MODE TASK'}`); return; }
      const graph = createTemplate(requestedMode as any, objective); new TaskGraphStore().save(graph);
      add('success', `Created ${graph.mode} workflow ${graph.id.slice(0, 8)} with ${graph.tasks.length} tasks.`); await refreshView('agents'); return;
    }
    if (command === 'budget') {
      const [field, raw] = arg.split(/\s+/u); const config = loadConfig(workspace.projectRoot);
      if (!arg) { add('info', `Session turns: ${options.maxTurns || 'agent default'}\nRun-tree defaults: ${JSON.stringify(config.orchestration || {}) || 'built-in safe limits'}`); return; }
      if (field !== 'turns' || !Number.isInteger(Number(raw)) || Number(raw) < 1) { add('warn', 'Usage: /budget turns N'); return; }
      options.maxTurns = Math.min(200, Number(raw)); add('success', `Turn budget: ${options.maxTurns}`); return;
    }
    if (command === 'steer') {
      if (!arg.trim()) { add('warn', 'Usage: /steer MESSAGE'); return; }
      if (!busy) { add('warn', 'No active run. Send the message normally to start a task.'); return; }
      steeringQueue.push(arg.trim());
      if (currentRunId) try { new RunService().steer(currentRunId, arg.trim()); } catch (error) { add('warn', String(error)); return; }
      add('info', 'Steering queued for the next safe boundary.'); return;
    }
    if (command === 'attach') {
      const path = resolve(arg);
      if (!arg || !existsSync(path) || !statSync(path).isFile()) { add('warn', `Not a file: ${arg || '(missing path)'}`); return; }
      pendingAttachments.push(path); add('success', `Attached for next message: ${path}`); return;
    }
    if (command === 'theme') {
      if (!['field', 'studio', 'arcade', 'system'].includes(arg)) { add('warn', 'Usage: /theme field|studio|arcade|system'); return; }
      const config = loadConfig(); saveConfig({ ...config, tui: { ...config.tui!, theme: arg as GrainThemeName, schemaVersion: 2 } }); terminal.setTheme(arg as GrainThemeName); add('success', `Theme: ${arg}`); return;
    }
    if (command === 'effort') {
      if (!['low', 'medium', 'high'].includes(arg)) { add('warn', 'Usage: /effort low|medium|high'); return; }
      const config = loadConfig(); saveConfig({ ...config, effort: arg as 'low' | 'medium' | 'high' }); add('success', `Reasoning effort: ${arg}`); return;
    }
    if (command === 'settings') {
      const config = loadConfig(); const connection = resolveTuiConnection(options, config);
      add('info', `Provider: ${connection.provider}\nModel: ${connection.model}\nEffort: ${config.effort || 'default'}\nTheme: ${config.tui?.theme}\nFolder: ${workspace.cwd}\nProject: ${workspace.projectRoot || '(none — /open PATH)'}\nRun: ${currentRunId || 'none'}`); return;
    }
    if (command === 'files') {
      const result = await executeWorkspaceScan({ path: '.', max_depth: workspace.projectRoot ? 3 : 1 }); add('info', result.content); return;
    }
    if (command === 'undo') {
      if (!changedFileCount()) { add('info', 'Nothing to undo from the latest task.'); return; }
      const undone = undoLast(); add('success', `Undid ${undone.restored.length} modified and ${undone.deleted.length} new files.`); await refreshView('diff'); return;
    }
    if (command === 'context' && arg === 'explain') { await refreshView('context'); return; }
    if (command === 'memory' && arg) {
      const [action, ...parts] = arg.split(/\s+/); const argument = parts.join(' ');
      const normalized = ['status', 'inspect', 'forget', 'search', 'edit', 'export', 'rebuild'].includes(action) ? action : 'search';
      const query = normalized === 'search' && action !== 'search' ? arg : argument;
      const [memoryId, ...memoryBodyParts] = parts;
      const result = normalized === 'status' ? await executeEngram({ action: 'status' })
        : normalized === 'inspect' ? await executeEngram({ action: 'get', query: argument })
        : normalized === 'forget' ? await executeEngram({ action: 'delete', query: argument })
        : normalized === 'edit' ? await executeEngram({ action: 'edit', query: memoryId, body: memoryBodyParts.join(' ') })
        : normalized === 'export' ? await executeEngram({ action: 'export', project: workspace.projectRoot || workspace.cwd })
        : normalized === 'rebuild' ? await executeEngram({ action: 'rebuild' })
        : await executeEngram({ action: 'search', query, project: workspace.projectRoot });
      panels.set('memory', String(result.content).split('\n')); view = 'memory'; render(); return;
    }
    if (command === 'wiki') {
      if (!workspace.projectRoot) { add('warn', 'Open a project before using its wiki.'); return; }
      const [action = 'search', ...parts] = arg.split(/\s+/); const argument = parts.join(' '); const wiki = new WikiEngine();
      try {
        if (action === 'build') { const page = wiki.build(); add('success', `Built ${page.path} from ${page.sources.length} sources.`); }
        else if (action === 'verify') { const result = wiki.verify(); add(result.valid ? 'success' : 'warn', result.valid ? 'Wiki provenance is current.' : result.stale.map(item => `${item.page}: ${item.source} — ${item.reason}`).join('\n')); }
        else if (action === 'search') { const pages = wiki.search(argument); add('info', pages.length ? pages.map(page => `${page.id}  ${page.title}  ${page.status}`).join('\n') : 'No wiki results.'); }
        else if (action === 'show') { const page = wiki.get(argument); add('info', page?.body || `Wiki page not found: ${argument}`); }
        else add('warn', 'Usage: /wiki build|verify|search QUERY|show ID');
      } catch (error) { add('error', error instanceof Error ? error.message : String(error)); }
      return;
    }
    if (command === 'agents' && arg) {
      const [agentMode, ...objectiveParts] = arg.split(/\s+/); const objective = objectiveParts.join(' ');
      if (!['solo', 'pair', 'research', 'plan', 'swarm', 'review-panel', 'repair-loop', 'migration-loop', 'benchmark-loop', 'recursive-delivery'].includes(agentMode) || !objective) { add('warn', 'Usage: /agents pair|plan|research|swarm|recursive-delivery TASK'); return; }
      const graph = createTemplate(agentMode as any, objective); new TaskGraphStore().save(graph); add('success', `Created ${graph.mode} graph ${graph.id.slice(0, 8)} with ${graph.tasks.length} tasks.`); await refreshView('agents'); return;
    }
    if (command === 'open' || command === 'cd') {
      const path = resolve(arg || '.');
      if (!existsSync(path) || !statSync(path).isDirectory()) { add('error', `Not a directory: ${path}`); return; }
      process.chdir(path);
      workspace = openWorkspace(path);
      setToolCwd(workspace.projectRoot || workspace.cwd);
      if (workspace.projectRoot) add('success', `Opened project ${workspace.projectRoot}`);
      else add('success', `Working in ${workspace.cwd} (folder — git optional)`);
      return;
    }
    if (command === 'jobs') {
      const store = new ScheduleStore(); const [action = 'list', name, ...rest] = arg.split(/\s+/);
      try {
        if (action === 'add') {
          const separator = rest.indexOf('--'); if (!name || separator < 1 || separator === rest.length - 1) throw new Error('Usage: /jobs add NAME CRON -- TASK');
          const cron = rest.slice(0, separator).join(' '); const prompt = rest.slice(separator + 1).join(' ');
          if (!workspace.projectRoot) throw new Error('Open a project before scheduling a coding task');
          store.add({ name, cron, prompt, workspace: workspace.projectRoot });
        } else if (action === 'remove') store.remove(name);
        else if (action === 'enable') store.setEnabled(name, true);
        else if (action === 'disable') store.setEnabled(name, false);
        else if (action === 'run') {
          const job = store.list().find(item => item.name === name || item.id === name); if (!job) throw new Error(`Unknown scheduled job: ${name}`);
          startTask(job.prompt, [], job);
        }
        await refreshView('jobs');
      } catch (error) { add('error', error instanceof Error ? error.message : String(error)); }
      return;
    }
    add('warn', `Unknown command: /${command}. Use /help.`);
  };

  const submit = async () => {
    const value = editor.commit().trim();
    terminal.clearPrompt();
    if (promptResolver) {
      const resolvePrompt = promptResolver;
      promptResolver = undefined; promptRejecter = undefined;
      terminal.line('> ' + value); resolvePrompt(value); return;
    }
    if (!value) { render(); return; }
    if (value.startsWith('/')) {
      if (commandBusy) { add('warn', 'Wait for the current command to finish.'); return; }
      commandBusy = true;
      terminal.line('> ' + value, 'accent');
      try { await handleCommand(value); }
      catch (error) { add('error', error instanceof Error ? error.message : String(error)); }
      finally { commandBusy = false; render(); }
    } else {
      const parsed = parseComposerInput(value);
      if (!parsed.argument) { pendingAttachments.push(...parsed.attachments); add('info', 'Attached. Add a message describing the task.'); return; }
      if (busy && (pendingAttachments.length || parsed.attachments.length)) {
        editor.setValue(value); add('warn', 'Wait for the task to finish before submitting attachments.'); return;
      }
      startTask(parsed.argument, [...pendingAttachments.splice(0), ...parsed.attachments]);
    }
  };

  const cancel = () => {
    const answering = Boolean(promptRejecter);
    if (promptRejecter) {
      const reject = promptRejecter; promptResolver = undefined; promptRejecter = undefined;
      reject(new Error('SIGINT'));
    }
    if (busy) {
      steeringQueue.length = 0;
      activeController?.abort(); destroyShell(); add('warn', 'Cancelling...');
    } else if (!answering) cleanup();
    else render();
  };
  const decoder = new StringDecoder('utf8');
  const inputHandler = (data: Buffer) => {
    const raw = decoder.write(data);
    if (raw === '\x04' && !editor.value()) { cancel(); return; }
    if (/^\x1b\[(?:5~|6~|1;2A|1;2B)$/.test(raw)) return;
    editor.feedAll(raw, action => {
      if (closed) return;
      if (action === 'cancel') { cancel(); return; }
      if (action === 'clear') { editor.clear(); return; }
      if (action === 'tab' && !promptResolver && !commandBusy && !busy) {
        if (editor.mention()) void openFileMention().catch(error => add('error', String(error)));
        return;
      }
      if (action === 'submit') void submit().catch(error => add('error', String(error)));
    });
    render();
  };

  const resize = () => render();
  let resolveClosed: () => void;
  const done = new Promise<void>(resolve => { resolveClosed = resolve; });
  const wasRaw = Boolean(process.stdin.isRaw);
  const cleanup = () => {
    if (closed) return;
    closed = true;
    promptRejecter?.(new Error('SIGINT')); promptResolver = undefined; promptRejecter = undefined;
    steeringQueue.length = 0;
    activeController?.abort(); destroyShell();
    process.stdout.off('resize', resize); process.stdin.off('data', inputHandler); process.stdin.off('end', cleanup);
    process.off('SIGTERM', cleanup); process.off('SIGINT', cancel); process.off('exit', cleanup);
    try { process.stdin.setRawMode(wasRaw); } catch {}
    process.stdin.pause();
    terminal.close(); process.stdout.write('\x1b[?2004l\x1b[0m\x1b[?25h');
    resolveClosed();
  };
  try {
    process.stdin.setRawMode(true);
    process.stdout.write('\x1b[?2004h');
    process.stdin.resume(); process.stdin.on('data', inputHandler); process.stdin.on('end', cleanup);
    process.stdout.on('resize', resize); process.on('SIGTERM', cleanup);
    process.on('SIGINT', cancel); process.on('exit', cleanup);
    terminal.block('hello, friend', WELCOME);
    const connection = resolveTuiConnection(options, loadConfig());
    terminal.line(connection.provider + ' / ' + connection.model + '   ' + workspace.cwd);
    terminal.line('Type a task. Enter sends. /help for commands. Ctrl+C cancels. Ctrl+D exits.');
    render();
    if (options.prompt) startTask(options.prompt, pendingAttachments.splice(0));
    await done;
    await taskPromise;
  } finally { cleanup(); }
}

async function runJournalViewer(options: TuiAppOptions): Promise<void> {
  const runId = options.runId || listRuns().at(-1);
  if (!runId) throw new Error('No runs available. Start a task first.');
  const view = projectRun(readRunEvents(runId));
  const terminal = new ScrollingTerminal();
  terminal.block('RUN ' + runId, [view.run.task, view.run.provider + ' / ' + view.run.model + ' - ' + view.run.status,
    ...view.timeline.map(item => item.sequence + '. ' + item.label + ' ' + (item.detail || ''))].join('\n'));
  terminal.line('Full journal: grain runs events ' + runId);
}

export async function runTui(options: TuiAppOptions = {}): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Interactive chat requires a terminal; use grain -p "TASK" for line output');
  if (options.runId) await runJournalViewer(options); else await runWorkspaceTui(options);
}
