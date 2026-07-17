import { existsSync, statSync } from 'fs';
import { basename } from 'path';
import { agentLoop, type AgentWorkspaceEvent } from '../agent/loop.js';
import { loadConfig, saveConfig } from '../config.js';
import { listRuns } from '../kernel/index.js';
import { listSessions, workspaceKey } from '../session/store.js';
import * as renderer from '../tui/renderer.js';
import { resolveTheme, type GrainThemeName } from '../tui/theme.js';
import { getSessionStats, statusLineText } from '../tui/status.js';
import { interactiveSelect } from '../tui/select.js';
import { catalogWithCurrent, nextModel } from '../tui/models.js';
import { undoLast, changedFileCount } from '../agent/checkpoint.js';
import { executeWorkspaceScan } from '../tools/workspace.js';
import { executeGit } from '../tools/git.js';
import { setToolCwd } from '../tools/index.js';
import { handleWikiCommand } from '../commands/wiki.js';
import { handleAgentsCommand } from '../commands/agents.js';
import { openProviderPage, ensureWorkspaceSetup } from './setup.js';

export type WorkspaceMode = 'ask' | 'plan' | 'execute';
export interface WorkspaceOptions { prompt?: string; model?: string; provider?: string; autoApprove?: boolean; concise?: boolean; maxTurns?: number; attachments?: string[]; }
export interface ComposerInput { command?: string; argument: string; attachments: string[]; }

const HELP = [
  '/                     open the command palette',
  '/model                switch model (opens selector · /model next to cycle)',
  '/plan                 explain the approach before changing work',
  '/mode ask|plan|execute choose how Grain works',
  '/files                inspect this repository',
  '/diff                 show changed files from the latest run',
  '/wiki [build|verify]  use repository knowledge',
  '/history              resume-aware session history',
  '/agents <mode> <task> create a durable task graph',
  '/theme <name>         field, studio, arcade, or system',
  '/effort low|medium|high  reasoning effort for capable models',
  '/undo                 revert the last task’s file changes',
  '/settings             show connection and workspace settings',
  '@path                 attach a file to your next message',
  '/exit                 leave Grain',
].join('\n');

export function parseComposerInput(value: string): ComposerInput {
  const attachments: string[] = [];
  const text = value.replace(/(?:^|\s)@([^\s]+)/g, (_match, path: string) => { attachments.push(path); return ' '; }).replace(/\s{2,}/g, ' ').trim();
  if (!text.startsWith('/')) return { argument: text, attachments };
  const [command, ...rest] = text.slice(1).split(/\s+/);
  return { command: command.toLowerCase(), argument: rest.join(' '), attachments };
}

function workspaceHeader(mode: WorkspaceMode, detail = 'ready'): void {
  const theme = resolveTheme(loadConfig().tui?.theme);
  renderer.info(`GRAIN  (•ᴗ•)  ${mode.toUpperCase()} · ${detail} · ${theme.name}`);
  renderer.dim('Ask for work naturally. Type /help when you need a control.');
}

function attachmentPreview(paths: string[]): string[] {
  return paths.map(path => {
    if (!existsSync(path)) return `Attachment missing: ${path}`;
    const size = statSync(path).size;
    return `Attached ${basename(path)} · ${size} bytes`;
  });
}

type WorkspaceState = { mode: WorkspaceMode; model?: string };

// Commands surfaced in the "/" palette (name → one-line description).
const PALETTE_COMMANDS: Array<{ name: string; desc: string }> = [
  { name: 'model', desc: 'switch the model (opens selector)' },
  { name: 'plan', desc: 'explain the approach before changing work' },
  { name: 'mode', desc: 'ask · plan · execute' },
  { name: 'files', desc: 'inspect this repository' },
  { name: 'diff', desc: 'show changed files from the latest run' },
  { name: 'wiki', desc: 'use repository knowledge' },
  { name: 'history', desc: 'resume-aware session history' },
  { name: 'agents', desc: 'create a durable task graph' },
  { name: 'theme', desc: 'field · studio · arcade · system' },
  { name: 'effort', desc: 'reasoning effort: low · medium · high' },
  { name: 'undo', desc: 'revert the last task’s file changes' },
  { name: 'settings', desc: 'connection and workspace settings' },
  { name: 'help', desc: 'show all controls' },
  { name: 'exit', desc: 'leave Grain' },
];

/** Persist a model choice (provider + id) and reflect it in the live session. */
function applyModel(state: WorkspaceState, provider: string, model: string): void {
  const cfg = loadConfig();
  saveConfig({ ...cfg, provider, model });
  state.model = model;
  getSessionStats().provider = provider;
  getSessionStats().model = model;
  renderer.success(`Model → ${provider} / ${model}`);
}

async function openModelSelector(state: WorkspaceState): Promise<void> {
  const cfg = loadConfig();
  const choice = await interactiveSelect({
    title: 'Select model',
    items: catalogWithCurrent(cfg.provider, state.model || cfg.model || '').map(c => ({ label: c.label, hint: c.hint, value: c, current: c.current })),
  });
  if (choice) applyModel(state, choice.provider, choice.model);
}

async function openCommandPalette(state: WorkspaceState): Promise<'continue' | 'exit'> {
  const choice = await interactiveSelect({
    title: 'Commands',
    items: PALETTE_COMMANDS.map(c => ({ label: `/${c.name}`, hint: c.desc, value: c.name })),
  });
  if (!choice) return 'continue';
  return handleCommand({ command: choice, argument: '', attachments: [] }, state);
}

async function handleCommand(command: ComposerInput, state: WorkspaceState): Promise<'continue' | 'exit'> {
  switch (command.command) {
    case '': return openCommandPalette(state); // bare "/" opens the palette
    case 'help': renderer.info(`\n${HELP}`); return 'continue';
    case 'exit': case 'quit': return 'exit';
    case 'plan': state.mode = 'plan'; renderer.success('Plan mode is on. Grain will explain the approach before changing work.'); return 'continue';
    case 'mode': {
      if (!['ask', 'plan', 'execute'].includes(command.argument)) { renderer.info('Usage: /mode ask|plan|execute'); return 'continue'; }
      state.mode = command.argument as WorkspaceMode;
      renderer.success(`Mode: ${state.mode}.${state.mode === 'execute' ? ' Tool approvals are now automatic.' : ''}`);
      return 'continue';
    }
    case 'models':
    case 'model': {
      const cfg = loadConfig();
      if (command.argument === 'next') { const n = nextModel(cfg.provider, state.model || cfg.model || ''); applyModel(state, n.provider, n.model); return 'continue'; }
      if (command.argument) { applyModel(state, cfg.provider, command.argument); return 'continue'; }
      await openModelSelector(state);
      return 'continue';
    }
    case 'theme': {
      const theme = command.argument as GrainThemeName;
      if (!['field', 'studio', 'arcade', 'system'].includes(theme)) { renderer.info('Usage: /theme field|studio|arcade|system'); return 'continue'; }
      const config = loadConfig(); saveConfig({ ...config, tui: { ...config.tui!, theme, schemaVersion: 2 } }); renderer.success(`Theme: ${theme}.`); return 'continue';
    }
    case 'files': renderer.info((await executeWorkspaceScan({ path: '.', max_depth: 2 })).content); return 'continue';
    case 'diff': {
      const status = await executeGit({ action: 'status' });
      renderer.info(`${status.content}\n\nLatest run: ${listRuns().at(-1) || 'none'}`); return 'continue';
    }
    case 'history': {
      const sessions = await listSessions(workspaceKey());
      renderer.info(sessions.length ? sessions.slice(0, 8).map(session => `${session.id.slice(0, 8)}  ${session.title || 'conversation'}  ${session.updated_at}`).join('\n') : 'No previous conversations in this repository.'); return 'continue';
    }
    case 'settings': { const config = loadConfig(); renderer.info(`Provider: ${config.provider}\nModel: ${config.model || 'auto'}\nTheme: ${config.tui?.theme || 'field'}\nWorkspace: ${process.cwd()}`); return 'continue'; }
    case 'effort': {
      const val = command.argument as 'low' | 'medium' | 'high';
      if (!['low', 'medium', 'high'].includes(val)) { renderer.info('Usage: /effort low|medium|high'); return 'continue'; }
      const cfg = loadConfig(); saveConfig({ ...cfg, effort: val }); renderer.success(`Reasoning effort → ${val}.`); return 'continue';
    }
    case 'undo': {
      if (changedFileCount() === 0) { renderer.info('Nothing to undo — no file changes recorded for the last task.'); return 'continue'; }
      const { restored, deleted } = undoLast();
      renderer.success(`Undid last task: ${restored.length} file${restored.length === 1 ? '' : 's'} restored${deleted.length ? `, ${deleted.length} new file${deleted.length === 1 ? '' : 's'} removed` : ''}.`);
      return 'continue';
    }
    case 'wiki': {
      if (!command.argument) { renderer.info('Usage: /wiki build | /wiki verify | /wiki search <query>'); return 'continue'; }
      const [action, ...args] = command.argument.split(/\s+/);
      await handleWikiCommand(action, args.join(' ') || undefined); return 'continue';
    }
    case 'agents': {
      const [mode, ...task] = command.argument.split(/\s+/); if (!mode || !task.length) { renderer.info('Usage: /agents pair|plan|research|swarm <task>'); return 'continue'; }
      await handleAgentsCommand(mode, task.join(' ')); return 'continue';
    }
    default: renderer.info(`Unknown control: /${command.command}. Type /help.`); return 'continue';
  }
}

/** The day-to-day Grain entry point: a repository-scoped conversational workspace. */
export async function runWorkspace(options: WorkspaceOptions = {}): Promise<void> {
  setToolCwd(process.cwd());
  // Animated dither launch banner on a fresh interactive start (not when a task
  // was passed on the command line — that user wants to get straight to work).
  if (!options.prompt && process.stdout.isTTY) await renderer.launchBanner();
  await ensureWorkspaceSetup({ prompt: renderer.userPrompt, info: renderer.info, open: openProviderPage });
  const state: { mode: WorkspaceMode; model?: string; approvedRisks: Set<string> } = { mode: 'ask', model: options.model, approvedRisks: new Set() };
  const queuedAttachments = [...(options.attachments || [])];
  workspaceHeader(state.mode);
  let input: string | null | undefined = options.prompt;
  while (true) {
    if (input === undefined) {
      // Pi-style status line (tokens · context% · mode · model · effort) above the prompt.
      renderer.statusLine(statusLineText(getSessionStats(), state.mode, loadConfig().effort));
      input = await renderer.userPrompt('◇ ');
    }
    if (input === null) return;
    const composer = parseComposerInput(input);
    input = undefined;
    if (composer.command !== undefined) { if (await handleCommand(composer, state) === 'exit') return; workspaceHeader(state.mode); continue; }
    if (!composer.argument) {
      if (composer.attachments.length) renderer.info('Attachments need a message. Add what you want Grain to do with them.');
      continue;
    }
    const attachments = [...queuedAttachments.splice(0), ...composer.attachments];
    attachmentPreview(attachments).forEach(renderer.info);
    const feed: string[] = [];
    const event = (item: AgentWorkspaceEvent) => {
      if (item.type === 'tool') feed.push(`working · ${item.name}`);
      if (item.type === 'approval') feed.push(`${item.decision} · ${item.name}`);
      if (item.type === 'verification') feed.push(item.passed ? 'verification passed' : 'verification failed');
      if (item.type === 'status' && item.status === 'failed') feed.push(`failed · ${item.detail || 'task failed'}`);
    };
    renderer.info(`WORK FEED  starting · ${state.mode}`);
    try {
      await agentLoop({ prompt: composer.argument, resume: true, oneShot: true, provider: options.provider, model: state.model,
        autoApprove: options.autoApprove || state.mode === 'execute', concise: options.concise, maxTurns: options.maxTurns,
        attachments, workspaceKey: workspaceKey(), mode: state.mode, approvedRisks: state.approvedRisks, onEvent: event });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!feed.some(item => item.startsWith('failed ·'))) feed.push(`failed · ${message}`);
      renderer.error(`Task failed: ${message}`);
    }
    if (!process.stdin.isTTY) return;
    workspaceHeader(state.mode, feed.at(-1) || 'ready');
  }
}
