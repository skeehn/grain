import { join, resolve, isAbsolute } from 'path';
import { homedir } from 'os';
import { snapshotBeforeEdit } from '../agent/checkpoint.js';
import type { ExecutableTool, Tool, ToolResult } from '../providers/types.js';
import { bashTool, executeBash, destroyShell, setBashOutputSink } from './bash.js';
import { readTool, executeRead } from './read.js';
import { writeTool, executeWrite } from './write.js';
import { patchTool, executePatch } from './patch.js';
import { grepTool, executeGrep } from './grep.js';
import { engramTool, executeEngram } from './engram.js';
import { delegateTool, executeDelegate } from './delegate.js';
import { finishTool, executeFinish } from './finish.js';
import { workspaceScanTool, executeWorkspaceScan } from './workspace.js';
import { multiEditTool, executeMultiEdit } from './multi-edit.js';
import { gitTool, executeGit } from './git.js';
import { testRunnerTool, executeTestRunner } from './test-runner.js';
import { testFixLoopTool, executeTestFixLoop } from './test-fix-loop.js';
import { planTool, executePlan } from './plan.js';
import { repoMapTool, executeRepoMap } from './repo-map.js';
import { PluginRegistry } from '../plugins/registry.js';
import { ClaudeCodePlugin } from '../plugins/claude-code.js';
import { CodexPlugin } from '../plugins/codex.js';
import { OpenCodePlugin } from '../plugins/opencode.js';
import { HermesPlugin } from '../plugins/hermes.js';
import { createSpawnAgentTool } from './spawn-agent.js';
import { loadConfig } from '../config.js';
import { setWorkspaceRoot } from '../workspace/index.js';
import { wikiSearchTool, wikiGetTool, wikiProposeTool, executeWikiSearch, executeWikiGet, executeWikiPropose } from './wiki.js';
import { workRecallTool, workNoteTool, executeWorkRecall, executeWorkNote } from './work.js';
import { inspectTool, executeInspect } from './inspect.js';
import { searchTool, executeSearch } from './search.js';
import { askUserTool, setQuestionJournal, setQuestionPrompt } from './ask-user.js';
import { codeSearchTool } from './code-search.js';
import { setCodeIndexRoot } from './code-index.js';
import { runAgentsTool } from './run-agents.js';
import { screenshotTool } from './screenshot.js';
export * from './contract.js';

// Tool execution context — set once at agent loop start
let _toolCwd: string = process.cwd();
export function setToolCwd(cwd: string) { _toolCwd = cwd; setWorkspaceRoot(cwd); setCodeIndexRoot(cwd); }
export { destroyShell, setBashOutputSink };
export { setQuestionJournal, setQuestionPrompt };

// Plugin system initialization
let _pluginRegistry: PluginRegistry | null = null;
let _spawnAgentTool: ExecutableTool | null = null;

function getPluginRegistry(): PluginRegistry {
  if (!_pluginRegistry) {
    const config = loadConfig();
    const pluginsConfig = config.plugins || {
      plugins: {},
      routing: { prefer: "grain-native", fallback: [], routeByCapability: false },
    };
    
    _pluginRegistry = new PluginRegistry(pluginsConfig);

    // Register available plugins, honoring per-plugin config overrides.
    // Expand a leading ~ ourselves: spawn() without shell:true doesn't.
    const expandTilde = (p: string) =>
      p.startsWith('~/') || p === '~' ? join(homedir(), p.slice(1)) : p;
    const claudeCfg = pluginsConfig.plugins?.['claude-code'];
    const codexCfg = pluginsConfig.plugins?.['codex'];
    const opencodeCfg = pluginsConfig.plugins?.['opencode'];
    const hermesCfg = pluginsConfig.plugins?.['hermes'];
    _pluginRegistry.register(new ClaudeCodePlugin(expandTilde(claudeCfg?.binaryPath ?? 'claude'), claudeCfg?.defaultModel));
    _pluginRegistry.register(new CodexPlugin(expandTilde(codexCfg?.binaryPath ?? 'codex')));
    _pluginRegistry.register(new OpenCodePlugin(expandTilde(opencodeCfg?.binaryPath ?? 'opencode')));
    _pluginRegistry.register(new HermesPlugin(expandTilde(hermesCfg?.binaryPath ?? 'hermes')));
  }
  return _pluginRegistry;
}

function getSpawnAgentTool(): ExecutableTool {
  if (!_spawnAgentTool) {
    const registry = getPluginRegistry();
    _spawnAgentTool = createSpawnAgentTool(registry);
  }
  return _spawnAgentTool;
}

// Lazy initialization wrapper to defer plugin loading until first use
function getLazyTools(): Tool[] {
  const tools: Tool[] = [
    // Core (10) — essential for any coding task
    bashTool,        // Run shell commands
    readTool,        // Read files
    writeTool,       // Write files (with syntax check)
    patchTool,       // Targeted edits
    grepTool,        // Search content
    workspaceScanTool, // List files/structure
    gitTool,         // Git operations
    testRunnerTool,  // Run tests
    finishTool,      // Signal completion
    repoMapTool,     // Understand codebase structure
    inspectTool,
    searchTool,
    codeSearchTool,  // Ranked symbol/semantic code retrieval (native index)
    screenshotTool,  // Capture a UI for visual design critique
    askUserTool,

    // Power (6) — for complex tasks
    multiEditTool,   // Batch edits across files
    engramTool,      // Persistent memory
    delegateTool,    // Spawn sub-agents
    testFixLoopTool, // Run tests + return structured failures for fix loop
    planTool,        // Read/write .grain-plan.json — survives context compaction
    getSpawnAgentTool(), // Multi-agent orchestration (plugins)
    runAgentsTool,   // Parallel worktree-isolated grain sub-agents (DAG)
    wikiSearchTool,
    wikiGetTool,
    wikiProposeTool,
    workRecallTool,  // Search past tasks, outcomes, and notes
    workNoteTool,    // Persist a decision or constraint worth keeping
  ];
  return tools;
}

// Export TOOLS as a getter to ensure lazy init
export const TOOLS: Tool[] = getLazyTools();

// The tool set handed to a DELEGATED child: everything except the delegation
// tools, so a child can never spawn its own (unbounded, depth-less) children.
// Co-located with TOOLS to avoid a delegate.ts↔index.ts circular-init hazard.
export function getChildTools(): Tool[] {
  const forbidden = new Set(['delegate', 'spawn_agent', 'run_agents']);
  return TOOLS.filter(tool => tool && !forbidden.has(tool.name));
}

const executors: Record<string, (input: any) => Promise<ToolResult>> = {
  bash: (input: any) => executeBash(input, _toolCwd),
  read: executeRead,
  write: executeWrite,
  patch: executePatch,
  grep: executeGrep,
  workspace_scan: executeWorkspaceScan,
  git: executeGit,
  run_tests: executeTestRunner,
  test_fix_loop: (input: any) => executeTestFixLoop(input, _toolCwd),
  plan: (input: any) => Promise.resolve(executePlan(input, _toolCwd)),
  repo_map: executeRepoMap,
  inspect: executeInspect,
  search: executeSearch,
  code_search: async input => codeSearchTool.execute(input),
  screenshot: async input => screenshotTool.execute(input),
  run_agents: async input => runAgentsTool.execute(input),
  ask_user: async input => askUserTool.execute(input),
  multi_edit: executeMultiEdit,
  engram: executeEngram,
  delegate: executeDelegate,
  finish: (input: any) => executeFinish(input, _toolCwd),
  spawn_agent: async (input: any) => {
    const tool = getSpawnAgentTool();
    return await tool.execute(input);
  },
  wiki_search: executeWikiSearch,
  wiki_get: executeWikiGet,
  wiki_propose_update: executeWikiPropose,
  work_recall: executeWorkRecall,
  work_note: executeWorkNote,
};

export function registerDynamicTool(tool: Tool, executor: (input: any) => Promise<ToolResult>): void {
  const index = TOOLS.findIndex(existing => existing.name === tool.name);
  if (index >= 0) TOOLS[index] = tool;
  else TOOLS.push(tool);
  executors[tool.name] = executor;
}

export async function executeTool(name: string, input: any): Promise<ToolResult> {
  const executor = executors[name];
  if (!executor) {
    return { content: `Unknown tool: ${name}`, is_error: true };
  }
  // Snapshot a file's pre-edit state so a whole task can be reverted with /undo.
  if (name === 'write' || name === 'patch') {
    if (input?.path) snapshotBeforeEdit(resolvePath(input.path));
  } else if (name === 'multi_edit' && Array.isArray(input?.edits)) {
    for (const edit of input.edits) if (edit?.path) snapshotBeforeEdit(resolvePath(edit.path));
  }
  return executor(input);
}

function resolvePath(p: string): string { return isAbsolute(p) ? p : resolve(_toolCwd, p); }
