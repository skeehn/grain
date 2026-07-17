import { existsSync, statSync } from 'fs';
import { basename } from 'path';
import { agentLoop, type AgentWorkspaceEvent } from '../agent/loop.js';
import { loadConfig, saveConfig } from '../config.js';
import { listRuns } from '../kernel/index.js';
import { listSessions, workspaceKey } from '../session/store.js';
import * as renderer from '../tui/renderer.js';
import { resolveTheme, type GrainThemeName } from '../tui/theme.js';
import { getSessionStats, statusLineText } from '../tui/status.js';
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
  '/plan                 explain the approach before changing work',
  '/mode ask|plan|execute choose how Grain works',
  '/files                inspect this repository',
  '/diff                 show changed files from the latest run',
  '/wiki [build|verify]  use repository knowledge',
  '/history              resume-aware session history',
  '/agents <mode> <task> create a durable task graph',
  '/model <name>         select a model for this workspace',
  '/theme <name>         field, studio, arcade, or system',
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

async function handleCommand(command: ComposerInput, state: { mode: WorkspaceMode; model?: string }): Promise<'continue' | 'exit'> {
  switch (command.command) {
    case 'help': renderer.info(`\n${HELP}`); return 'continue';
    case 'exit': case 'quit': return 'exit';
    case 'plan': state.mode = 'plan'; renderer.success('Plan mode is on. Grain will explain the approach before changing work.'); return 'continue';
    case 'mode': {
      if (!['ask', 'plan', 'execute'].includes(command.argument)) { renderer.info('Usage: /mode ask|plan|execute'); return 'continue'; }
      state.mode = command.argument as WorkspaceMode;
      renderer.success(`Mode: ${state.mode}.${state.mode === 'execute' ? ' Tool approvals are now automatic.' : ''}`);
      return 'continue';
    }
    case 'model': if (!command.argument) renderer.info('Usage: /model <name>'); else { state.model = command.argument; renderer.success(`Model: ${state.model}.`); } return 'continue';
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
      // Pi-style status line (tokens · context% · mode · model) above the prompt.
      renderer.statusLine(statusLineText(getSessionStats(), state.mode));
      input = await renderer.userPrompt('◇ ');
    }
    if (input === null) return;
    const composer = parseComposerInput(input);
    input = undefined;
    if (composer.command) { if (await handleCommand(composer, state) === 'exit') return; workspaceHeader(state.mode); continue; }
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
