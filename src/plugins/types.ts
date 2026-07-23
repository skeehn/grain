/**
 * Agent Plugin System
 * 
 * Allows grain to discover and orchestrate external coding agents like
 * Claude Code, Codex, Aider, OpenCode, etc.
 */

export type AgentCapability =
  | "code-review"
  | "feature-dev"
  | "refactoring"
  | "bug-fixing"
  | "testing"
  | "documentation"
  | "debugging"
  | "optimization";

export type AgentMode = "oneshot" | "interactive" | "background";

export interface AgentTask {
  /** Natural language task description */
  prompt: string;
  
  /** Working directory for the agent */
  workdir: string;
  
  /** Additional files/context to include */
  context?: string[];
  
  /** Execution mode */
  mode: AgentMode;
  
  /** Constraints */
  constraints?: {
    maxTurns?: number;
    maxBudgetUSD?: number;
    allowedTools?: string[];
    timeoutSeconds?: number;
  };
  
  /** Resume an existing session */
  sessionId?: string;
  provider?: string;
  model?: string;
  skills?: string[];

  /** Runtime-only cancellation and liveness hooks; never persisted. */
  signal?: AbortSignal;
  onHeartbeat?: () => void;
  sandbox?: 'read-only' | 'workspace-write';
}

export interface AgentResult {
  /** Whether the task completed successfully */
  success: boolean;
  
  /** Agent output / summary */
  output: string;
  
  /** Files that were modified */
  filesModified?: string[];
  
  /** Session ID for resumption */
  sessionId?: string;
  
  /** Cost in USD */
  costUSD?: number;
  
  /** Duration in milliseconds */
  durationMs?: number;
  
  /** Exit reason */
  exitReason?: "completed" | "error" | "timeout" | "max_turns" | "max_budget";
  
  /** Raw metadata from the agent */
  metadata?: Record<string, any>;
}

export interface AgentPlugin {
  /** Unique agent name (e.g., "claude-code", "codex") */
  name: string;
  
  /** Plugin version */
  version: string;
  
  /** What this agent is good at */
  capabilities: AgentCapability[];
  
  /** Supported execution modes */
  supportsPrintMode: boolean;
  supportsInteractive: boolean;
  supportsPTY: boolean;
  
  /** Check if the agent binary is installed */
  isInstalled(): Promise<boolean>;
  
  /** Get installed agent version */
  getVersion(): Promise<string>;
  
  /** Execute a task with this agent */
  execute(task: AgentTask): Promise<AgentResult>;
}

export interface PluginConfig {
  enabled: boolean;
  binaryPath?: string;
  defaultModel?: string;
  maxBudgetPerTask?: number;
  preferredFor?: AgentCapability[];
}

export interface RoutingStrategy {
  /** Preferred agent for general tasks */
  prefer?: string;
  
  /** Fallback agents in order of preference */
  fallback?: string[];
  
  /** Route based on task capabilities */
  routeByCapability?: boolean;
  
  /** Custom routing rules */
  rules?: RoutingRule[];
}

export interface RoutingRule {
  /** Regex pattern to match against task prompt */
  pattern: string;
  
  /** Agent to use when pattern matches */
  agent: string;
  
  /** Priority (higher = checked first) */
  priority?: number;
}

export interface PluginsConfig {
  plugins: Record<string, PluginConfig>;
  routing: RoutingStrategy;
}
