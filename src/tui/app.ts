import { execFileSync, spawnSync } from 'child_process';
import { existsSync, statSync } from 'fs';
import { resolve } from 'path';
import { agentLoop, type AgentUi, type AgentWorkspaceEvent } from '../agent/loop.js';
import { changedFileCount, undoLast } from '../agent/checkpoint.js';
import { loadConfig, saveConfig, type GrainConfig } from '../config.js';
import { listRuns, readRunEvents, RunEngine, RunJournal, RunService } from '../kernel/index.js';
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
import { resolveWorkspace } from '../workspace/root.js';
import { detectTerminalCapabilities } from './capabilities.js';
import { DifferentialRenderer } from './differential.js';
import { blankFrame, putText } from './frame.js';
import { layoutRun } from './layout.js';
import { projectRun } from './projector.js';
import { resolveTheme, type GrainThemeName } from './theme.js';
import { LineEditor } from './editor.js';
import { MODEL_CATALOG, resolveModelSelection } from './models.js';
import { buildModelRegistry, invalidateModelRegistry, type ModelEntry } from '../providers/index.js';
import { applyOverlayKey, paintOverlay, type OverlayItem, type OverlayState } from './overlay.js';
import { fmtTokens, getSessionStats, statusLineText } from './status.js';
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
}

const VIEWS: TuiView[] = ['chat', 'diff', 'tools', 'context', 'memory', 'work', 'history', 'agents', 'jobs'];

export function resolveTuiConnection(options: Pick<TuiAppOptions, 'provider' | 'model'>, config: GrainConfig): { provider: string; model: string } {
  return { provider: options.provider || config.provider, model: options.model || config.model || 'auto' };
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
  if (/^[A-Z][A-Z0-9 ·/-]+$/u.test(text.trim()) && text.trim().length > 2) return 'heading';
  if (/^\s*(×|error|failed)/i.test(text)) return 'error';
  if (/^\s*(✓|◆)/.test(text)) return 'success';
  if (/^\s*(!|△|warn)/i.test(text)) return 'warn';
  if (/^\s{2,}/.test(text)) return 'dim';
  return 'assistant';
}

export const HELP_LINES = [
  'MODELS',
  '  /model                       pick from every model you can actually run',
  '  /model claude-code:opus      Claude through your subscription (no API credit)',
  '  /model codex                 OpenAI Codex through your subscription',
  '  /model openrouter:MODEL_ID   any OpenRouter model · /model ollama:MODEL local',
  '  /effort low|medium|high      reasoning effort where the model supports it',
  'WORK',
  '  type a task · /open PATH project · /attach PATH · /mode ask|plan|execute',
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
  '  /agent [NAME] · /agents MODE TASK · /workflow MODE TASK · /loop TASK',
  '  /jobs [add|run|remove] …',
  'MEMORY ADMIN',
  '  /memory edit ID CONTENT · /memory forget ID · /memory export|rebuild',
  'KEYS',
  '  Tab views · PgUp/PgDn scroll · Ctrl+L clear · Ctrl+C cancel, then quit',
];

/** Transcript lines carry their role so the renderer can style them. */
export type LineKind = 'user' | 'assistant' | 'tool' | 'result' | 'success' | 'warn' | 'error' | 'info' | 'dim' | 'heading';

export interface TranscriptLine { kind: LineKind; text: string }

const GUTTER: Record<LineKind, string> = {
  user: '❯ ', assistant: '  ', tool: '· ', result: '  ', success: '✓ ',
  warn: '! ', error: '× ', info: '· ', dim: '  ', heading: '',
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

function projectName(root?: string): string {
  if (!root) return 'general chat';
  const parts = root.split('/').filter(Boolean); return parts.at(-1) || root;
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
  let capabilities = detectTerminalCapabilities();
  let renderer = new DifferentialRenderer(capabilities);
  let theme = resolveTheme(loadConfig().tui?.theme);
  let view: TuiView = 'chat'; const editor = new LineEditor(); let busy = false; let closed = false;
  let status = 'ready'; let currentRunId: string | undefined; let mode: WorkspaceMode = 'ask';
  let workspace = resolveWorkspace(process.cwd());
  if (workspace.root) setToolCwd(workspace.root);
  const transcript: TranscriptLine[] = [
    { kind: 'info', text: 'Grain is ready. Type a task, /model to choose a model, or /help for controls.' },
  ];
  const panels = new Map<TuiView, string[]>(); panels.set('help', HELP_LINES);
  const approvedRisks = new Set<string>();
  let promptResolver: ((answer: string | null) => void) | undefined; let promptLabel = '';
  let activeController: AbortController | undefined;
  let streamLine = -1;
  let scrollOffset = 0;          // lines scrolled up from the bottom; 0 follows the tail
  let overlay: OverlayState<unknown> | undefined;
  let spinnerTick = 0;
  const steeringQueue: string[] = [];
  const pendingAttachments: string[] = [...(options.attachments || [])];
  let activeProfile: AgentProfileV1 | undefined;
  const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

  const render = () => {
    if (closed) return;
    capabilities = detectTerminalCapabilities();
    const frame = blankFrame(capabilities.columns, capabilities.rows);
    frame.cells.forEach(cell => { cell.style.background = theme.canvas; cell.style.foreground = theme.text; });
    const width = frame.width; const height = frame.height;
    const connection = resolveTuiConnection(options, loadConfig());

    // ── Header: who you are talking to, and where.
    putText(frame, 0, 0, ' '.repeat(width), { background: theme.panel });
    putText(frame, 0, 1, 'grain', { foreground: theme.accent, background: theme.panel, bold: true });
    const place = `${projectName(workspace.root)}${workspace.root ? '' : ''}`;
    let cursor = putText(frame, 0, 7, clip(place, Math.floor(width / 3)), { foreground: theme.text, background: theme.panel, bold: true });
    if (activeProfile) cursor = putText(frame, 0, cursor + 2, clip(`@${activeProfile.id}`, 18), { foreground: theme.evidence, background: theme.panel });
    const connectionLabel = `${connection.provider} · ${connection.model}`;
    if (width > 52) {
      putText(frame, 0, Math.max(cursor + 2, width - connectionLabel.length - 2), clip(connectionLabel, width - cursor - 3),
        { foreground: theme.evidence, background: theme.panel });
    }

    const tabs = formatViewTabs(view, width - 2);
    putText(frame, 1, 1, clip(tabs, width - 2), { foreground: theme.muted, background: theme.canvas });
    putText(frame, 2, 0, '─'.repeat(width), { foreground: theme.line });

    // ── Body.
    const bodyHeight = Math.max(1, height - 6); const bodyWidth = Math.max(8, width - 4);
    const source: TranscriptLine[] = view === 'chat' ? transcript
      : (panels.get(view) || [`/${view} to refresh this view`]).map(text => ({ kind: panelLineKind(text), text }));
    const lines = source.flatMap(line => wrapTuiText(line.text, bodyWidth).map(text => ({ kind: line.kind, text })));
    const maxScroll = Math.max(0, lines.length - bodyHeight);
    if (scrollOffset > maxScroll) scrollOffset = maxScroll;
    const end = lines.length - scrollOffset;
    lines.slice(Math.max(0, end - bodyHeight), end).forEach((line, index) => {
      const role = lineStyleRole(line.kind);
      putText(frame, 3 + index, 2, clip(line.text, bodyWidth),
        { foreground: theme[role], background: theme.canvas, bold: line.kind === 'user' || line.kind === 'heading' });
    });
    if (scrollOffset > 0) {
      const marker = `↑ ${scrollOffset} more · PgDn to follow`;
      putText(frame, 3 + bodyHeight - 1, Math.max(2, width - marker.length - 2), marker, { foreground: theme.warning, background: theme.canvas });
    }

    // ── Status: work state on the left, session accounting on the right.
    putText(frame, height - 3, 0, '─'.repeat(width), { foreground: theme.line });
    putText(frame, height - 2, 0, ' '.repeat(width), { background: theme.panel });
    const state = busy ? status : promptResolver ? promptLabel : status;
    const badge = busy ? `${SPINNER[spinnerTick % SPINNER.length]} ` : promptResolver ? '? ' : '● ';
    let statusCursor = putText(frame, height - 2, 1, badge, { foreground: busy ? theme.warning : promptResolver ? theme.accent : theme.success, background: theme.panel });
    statusCursor = putText(frame, height - 2, statusCursor, clip(`${mode.toUpperCase()}  ${state}`, Math.floor(width * 0.55)),
      { foreground: busy ? theme.warning : theme.muted, background: theme.panel, bold: busy });
    const accounting = sessionAccounting();
    if (accounting && width > 60) {
      putText(frame, height - 2, Math.max(statusCursor + 2, width - accounting.length - 2), clip(accounting, width - statusCursor - 3),
        { foreground: theme.muted, background: theme.panel });
    }

    // ── Composer.
    const prefix = promptResolver ? '? ' : '› ';
    putText(frame, height - 1, 0, ' '.repeat(width), { background: theme.panel });
    putText(frame, height - 1, 0, prefix, { foreground: theme.accent, background: theme.panel, bold: true });
    const composer = editor.displayValue();
    putText(frame, height - 1, prefix.length, clip(composer, width - prefix.length), { foreground: theme.text, background: theme.panel });
    if (!composer && !promptResolver) {
      putText(frame, height - 1, prefix.length, clip('describe a task, or / for commands', width - prefix.length - 1),
        { foreground: theme.muted, background: theme.panel });
    }
    frame.cursor = { row: height - 1, column: Math.min(width - 1, prefix.length + editor.cursorColumn()), visible: true };

    if (overlay) paintOverlay(frame, overlay, theme);
    renderer.render(frame);
  };

  /** `↑12.4k ↓3.1k · 18.2%/200k · $0.04` — only the parts that are known. */
  const sessionAccounting = (): string => {
    const stats = getSessionStats();
    if (!stats.upTokens && !stats.downTokens) return '';
    const parts = [`↑${fmtTokens(stats.upTokens)} ↓${fmtTokens(stats.downTokens)}`];
    if (stats.contextWindow) parts.push(`${Math.min(100, (stats.lastInputTokens / stats.contextWindow) * 100).toFixed(0)}%/${fmtTokens(stats.contextWindow)}`);
    if (stats.costUsd) parts.push(`$${stats.costUsd.toFixed(2)}`);
    return parts.join(' · ');
  };

  const add = (kind: LineKind, message: unknown) => {
    view = transcriptOutputView();
    streamLine = -1;
    scrollOffset = 0;
    const text = typeof message === 'string' ? message : JSON.stringify(message, null, 2);
    const gutter = GUTTER[kind];
    transcript.push(...text.split('\n').map((line, index) => ({
      kind, text: `${index === 0 ? gutter : ' '.repeat(gutter.length)}${line}`,
    })));
    if (transcript.length > 2000) transcript.splice(0, transcript.length - 2000);
    render();
  };

  const ui: AgentUi = {
    stream: text => {
      scrollOffset = 0;
      if (streamLine < 0) { transcript.push({ kind: 'assistant', text: '  ' }); streamLine = transcript.length - 1; }
      const chunks = text.replace(/\r/g, '').split('\n'); transcript[streamLine].text += chunks.shift() || '';
      for (const chunk of chunks) { transcript.push({ kind: 'assistant', text: `  ${chunk}` }); streamLine = transcript.length - 1; }
      render();
    },
    streamToolLine: line => add('result', line),
    tool: (name, _input) => { status = `tool · ${name}`; add('tool', name); },
    result: (output, isError) => add(isError ? 'error' : 'result', output),
    success: message => add('success', message), newLine: () => add('dim', ''), clearLine: () => {},
    warn: message => add('warn', message), error: message => add('error', message), info: message => add('info', message), dim: message => add('dim', message),
    retryNotice: (attempt, max, seconds) => add('info', `retrying ${attempt}/${max} in ${seconds}s`),
    spinner: label => { status = label || 'thinking'; render(); return { stop: () => { status = 'working'; render(); } }; },
    userPrompt: label => new Promise(resolvePrompt => {
      promptLabel = label || 'Your answer'; promptResolver = resolvePrompt; editor.clear(); status = 'waiting for input'; render();
    }),
  };

  const refreshView = async (target: TuiView) => {
    view = target; const root = workspace.root;
    try {
      if (target === 'diff') {
        if (!root) panels.set(target, ['No project is open. Use /open PATH first.']);
        else {
          panels.set(target, collectWorkingTreeDiff(root).split('\n').slice(0, 500));
        }
      } else if (target === 'tools') {
        const recent = currentRunId ? readRunEvents(currentRunId).filter(event => event.type === 'tool_started' || event.type === 'tool_completed').slice(-20)
          .map(event => `${event.type === 'tool_completed' ? '◆' : '◇'} ${(event.payload as any).name || (event.payload as any).tool}`) : [];
        panels.set(target, ['AVAILABLE TOOLS', ...TOOLS.map(tool => `  ${tool.name} — ${tool.description}`), '', 'RECENT', ...(recent.length ? recent : ['  none'])]);
      } else if (target === 'context') {
        const event = currentRunId ? [...readRunEvents(currentRunId)].reverse().find(item => item.type === 'model_requested') : undefined;
        const manifest = (event?.payload as any)?.context_manifest;
        const sessionId = await getLastSession(root ? workspaceKey(root) : 'general');
        const compactions = sessionId ? await listCompactions(sessionId) : [];
        panels.set(target, [...(manifest ? JSON.stringify(manifest, null, 2).split('\n') : ['No model context has been packed in this task yet.']),
          '', 'COMPACTIONS', ...(compactions.length ? compactions.slice(-10).map(item =>
            `${item.id.slice(0, 8)}  ${item.tokens_before}→${item.tokens_after} tokens  ${item.source_entry_ids.length} sources`) : ['  none'])]);
      } else if (target === 'memory') {
        const connection = await executeEngram({ action: 'status' }); const stats = await executeEngram({ action: 'stats' });
        const nodes = await executeEngram({ action: 'list', project: root });
        panels.set(target, [...formatEngramStatus(String(connection.content)).split('\n'), '', ...formatEngramStats(String(stats.content)).split('\n'),
          '', 'PROJECT MEMORY', ...String(nodes.content).split('\n').slice(0, 100)]);
      } else if (target === 'work') {
        panels.set(target, workspace.root ? listWork(40, true).split('\n')
          : ['No project is open. Use /open PATH to work in a repository.']);
      } else if (target === 'history') {
        const sessions = await listSessions(root ? workspaceKey(root) : undefined);
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
    busy = true; status = 'starting'; view = 'chat'; add('user', prompt);
    activeController = new AbortController();
    const root = job?.workspace || workspace.root; const previous = process.cwd();
    if (job) process.chdir(job.workspace);
    try {
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
        const execution = await executeProfileGraph(graph, root, graphStore); currentRunId = execution.runId;
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
        attachments, workspaceKey: root ? workspaceKey(root) : 'general', mode, approvedRisks, ui,
        workspaceRoot: root, generalChat: !root, signal: activeController.signal,
        drainSteering: () => steeringQueue.splice(0),
        onEvent: (event: AgentWorkspaceEvent) => {
          if (event.type === 'run') currentRunId = event.runId;
          if (event.type === 'status') status = event.detail || event.status;
          if (event.type === 'tool') status = `tool · ${event.name}`;
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
      if (job) process.chdir(previous); activeController = undefined; busy = false; streamLine = -1; render();
      // A run can finish before it reaches another turn boundary. Preserve the
      // queued instruction by starting it as the next resumable conversation.
      const followUp = takeQueuedFollowUp(steeringQueue);
      if (followUp && !closed) queueMicrotask(() => { void runTask(followUp); });
    }
  };

  /** Open a modal list and resolve when the user picks or dismisses it. */
  const pick = <T,>(title: string, items: OverlayItem<T>[]): Promise<{ value: T | null; item?: OverlayItem<T> }> =>
    new Promise(resolvePick => {
      const current = Math.max(0, items.findIndex(item => item.current));
      overlay = {
        title, items: items as OverlayItem<unknown>[], filter: '', index: current,
        resolve: (value, item) => { overlay = undefined; render(); resolvePick({ value: value as T | null, item: item as OverlayItem<T> | undefined }); },
      } as OverlayState<unknown>;
      render();
    });

  const applyModelSelection = (provider: string, model: string) => {
    const config = loadConfig();
    saveConfig({ ...config, provider, model });
    options.provider = provider; options.model = model;
    const stats = getSessionStats(); stats.provider = provider; stats.model = model;
    add('success', `Model: ${provider} · ${model}`);
  };

  const openModelPicker = async () => {
    const config = loadConfig();
    const connection = resolveTuiConnection(options, config);
    status = 'loading models'; render();
    let entries: ModelEntry[] = [];
    try { entries = await buildModelRegistry({ workspaceRoot: workspace.root }); }
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
    if (entry.kind === 'subscription') {
      add('info', 'This agent runs with its own tools and its own login — no API credit is used.');
    }
  };

  const handleCommand = async (value: string) => {
    const parsed = parseComposerInput(value); const command = parsed.command || ''; const arg = parsed.argument;
    if (!command) { await refreshView('help'); return; }
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
      const selected = resolveModelSelection(arg, options.provider || config.provider, workspace.root);
      applyModelSelection(selected.provider, selected.model);
      return;
    }
    if (command === 'note') {
      if (!arg.trim()) { add('warn', 'Usage: /note WHAT YOU WANT TO REMEMBER'); return; }
      if (!workspace.root) { add('warn', 'Open a project first — notes live in the repository.'); return; }
      try { add('success', await addNote(arg.trim())); }
      catch (error) { add('error', error instanceof Error ? error.message : String(error)); }
      return;
    }
    if (command === 'work' || command === 'worklog') {
      if (!workspace.root) { add('warn', 'Open a project first — the work record lives in the repository.'); return; }
      try { panels.set('work', listWork(40, true).split('\n')); view = 'work'; render(); }
      catch (error) { add('error', error instanceof Error ? error.message : String(error)); }
      return;
    }
    if (command === 'recall') {
      if (!arg.trim()) { add('warn', 'Usage: /recall QUERY [--all]  (--all searches every repository)'); return; }
      if (!workspace.root) { add('warn', 'Open a project first.'); return; }
      const allRepos = /(^|\s)--all(\s|$)/u.test(arg);
      status = 'recalling'; render();
      try {
        const found = await recallWork(arg.replace(/(^|\s)--all(\s|$)/u, ' ').trim(), { allRepos });
        panels.set('work', found.split('\n')); view = 'work';
      } catch (error) { add('error', error instanceof Error ? error.message : String(error)); }
      status = busy ? status : 'ready'; render(); return;
    }
    if (command === 'agent') {
      const profiles = loadAgentProfiles(workspace.root);
      if (!arg) { add('info', ['AGENT PROFILES', ...profiles.map(profile =>
        `  ${profile.id}${activeProfile?.id === profile.id ? '  [active]' : ''} · ${profile.executor} · ${profile.provider || 'inherited'}/${profile.model || 'auto'}`), '',
        'Select with /agent NAME'].join('\n')); return; }
      const selected = profiles.find(profile => profile.id === arg);
      if (!selected) { add('warn', `Unknown agent profile: ${arg}`); return; }
      activeProfile = selected; add('success', `Agent: ${selected.id} · ${selected.executor} · ${selected.provider || 'inherited'}/${selected.model || 'auto'}`); return;
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
      const [field, raw] = arg.split(/\s+/u); const config = loadConfig(workspace.root);
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
      const config = loadConfig(); saveConfig({ ...config, tui: { ...config.tui!, theme: arg as GrainThemeName, schemaVersion: 2 } }); theme = resolveTheme(arg as GrainThemeName); render(); return;
    }
    if (command === 'effort') {
      if (!['low', 'medium', 'high'].includes(arg)) { add('warn', 'Usage: /effort low|medium|high'); return; }
      const config = loadConfig(); saveConfig({ ...config, effort: arg as 'low' | 'medium' | 'high' }); add('success', `Reasoning effort: ${arg}`); return;
    }
    if (command === 'settings') {
      const config = loadConfig(); const connection = resolveTuiConnection(options, config);
      add('info', `Provider: ${connection.provider}\nModel: ${connection.model}\nEffort: ${config.effort || 'default'}\nTheme: ${config.tui?.theme}\nWorkspace: ${workspace.root || 'general chat'}\nRun: ${currentRunId || 'none'}`); return;
    }
    if (command === 'files') {
      if (!workspace.root) { add('warn', 'No project is open. Use /open PATH.'); return; }
      const result = await executeWorkspaceScan({ path: '.', max_depth: 3 }); add('info', result.content); return;
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
        : normalized === 'export' ? await executeEngram({ action: 'export', project: workspace.root })
        : normalized === 'rebuild' ? await executeEngram({ action: 'rebuild' })
        : await executeEngram({ action: 'search', query, project: workspace.root });
      panels.set('memory', String(result.content).split('\n')); view = 'memory'; render(); return;
    }
    if (command === 'wiki') {
      if (!workspace.root) { add('warn', 'Open a project before using its wiki.'); return; }
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
    if (command === 'open') {
      const path = resolve(arg || '.');
      if (!existsSync(path) || !statSync(path).isDirectory()) { add('error', `Not a directory: ${path}`); return; }
      process.chdir(path); workspace = resolveWorkspace(path);
      if (!workspace.root) { add('warn', `${path} has no project marker; remaining in general chat.`); }
      else { process.chdir(workspace.root); setToolCwd(workspace.root); add('success', `Opened ${workspace.root}`); }
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
      } catch (error) { add('error', error instanceof Error ? error.message : String(error)); }
      return;
    }
    add('warn', `Unknown command: /${command}. Use /help.`);
  };

  const submit = async () => {
    const value = editor.commit().trim(); render();
    if (promptResolver) { const resolvePrompt = promptResolver; promptResolver = undefined; promptLabel = ''; resolvePrompt(value); return; }
    if (!value) return;
    if (value.startsWith('/')) await handleCommand(value);
    else { const parsed = parseComposerInput(value); const attachments = [...pendingAttachments.splice(0), ...parsed.attachments]; void runTask(parsed.argument, attachments); }
  };

  const bodyHeight = () => Math.max(1, detectTerminalCapabilities().rows - 6);

  const inputHandler = (data: Buffer) => {
    const raw = data.toString('utf8');

    // A modal owns the keyboard for its lifetime; the composer never sees these.
    if (overlay) { applyOverlayKey(overlay, raw, Math.max(4, bodyHeight() - 4)); render(); return; }

    // Scrollback: reading back through a long run must not require a mouse.
    if (raw === '\x1b[5~') { scrollOffset += Math.max(1, bodyHeight() - 2); render(); return; }
    if (raw === '\x1b[6~') { scrollOffset = Math.max(0, scrollOffset - Math.max(1, bodyHeight() - 2)); render(); return; }
    if (raw === '\x1b[1;2A') { scrollOffset += 1; render(); return; }   // shift-up
    if (raw === '\x1b[1;2B') { scrollOffset = Math.max(0, scrollOffset - 1); render(); return; } // shift-down

    const actions = editor.feedAll(raw);
    for (const action of actions) {
      if (action === 'cancel') {
        if (busy) { status = activeController?.signal.aborted ? 'forcing cancellation' : 'cancelling'; activeController?.abort(); destroyShell(); }
        else if (!promptResolver) cleanup();
        else status = 'answer the active prompt or press Enter';
        render(); continue;
      }
      if (action === 'clear') { transcript.splice(0); scrollOffset = 0; }
      if (action === 'tab' && !promptResolver) { const index = VIEWS.indexOf(view); scrollOffset = 0; void refreshView(VIEWS[(index + 1) % VIEWS.length]); continue; }
      if (action === 'submit') { void submit(); continue; }
    }
    render();
  };

  const resize = () => { capabilities = detectTerminalCapabilities(); renderer = new DifferentialRenderer(capabilities); process.stdout.write('\x1b[2J'); render(); };
  const alternate = options.alternateScreen !== false;
  // Animate the working indicator only while there is work — an idle Grain
  // should not repaint the screen ten times a second.
  const animation = setInterval(() => { if (busy && !closed) { spinnerTick++; render(); } }, capabilities.reducedMotion ? 500 : 110);
  animation.unref?.();
  const cleanup = () => {
    if (closed) return; closed = true; clearInterval(animation); activeController?.abort(); destroyShell(); process.stdout.off('resize', resize); process.stdin.off('data', inputHandler);
    try { process.stdin.setRawMode(false); } catch {} process.stdin.pause(); process.off('SIGTERM', cleanup); process.off('exit', cleanup);
    process.stdout.write(`\x1b[?2004l\x1b[0m\x1b[?25h${alternate ? '\x1b[?1049l' : '\n'}`);
  };
  if (alternate) process.stdout.write('\x1b[?1049h'); process.stdout.write('\x1b[?2004h\x1b[2J\x1b[?25h');
  process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.on('data', inputHandler); process.stdout.on('resize', resize); process.on('SIGTERM', cleanup); process.on('exit', cleanup);
  render();
  if (options.prompt) void runTask(options.prompt, pendingAttachments.splice(0));
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
