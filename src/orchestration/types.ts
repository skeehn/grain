export type AgentRole = 'coordinator' | 'driver' | 'navigator' | 'researcher' | 'reviewer' | 'verifier';
export type TaskState = 'pending' | 'ready' | 'running' | 'waiting' | 'succeeded' | 'failed' | 'cancelled' | 'needs_reconciliation';
export type IsolationMode = 'shared_readonly' | 'worktree';

export type ExecutorKind = 'grain-native' | 'direct-api' | 'claude-code' | 'codex' | 'opencode' | 'grok' | 'hermes' | 'stdio';
export type AgentProfileMode = 'primary' | 'subagent' | 'all';
export type PermissionDecision = 'allow' | 'ask' | 'deny';

export interface AgentProfileV1 {
  schemaVersion: 1;
  id: string;
  description: string;
  mode: AgentProfileMode;
  executor: ExecutorKind;
  provider?: string;
  model?: string;
  prompt?: string;
  skills: string[];
  permissions: Record<string, PermissionDecision>;
  isolation: IsolationMode;
  budget: AgentBudget;
  recursion: { enabled: boolean; maxDepth: number; maxFanOut: number };
  command?: { binary: string; args?: string[]; output: 'json' | 'jsonl' | 'text' };
}

export interface WorkflowNodeV1 {
  id: string;
  profile: string;
  role: AgentRole;
  objective: string;
  expectedArtifact: string;
  dependencies: string[];
  write: boolean;
  verifier?: string;
  loop?: { on: 'failure'; target: string; maxIterations: number };
}

export interface WorkflowDefinitionV1 {
  schemaVersion: 1;
  id: string;
  description: string;
  nodes: WorkflowNodeV1[];
  limits: RunTreeLimits;
}

export interface RunTreeLimits {
  maxDepth: number;
  maxConcurrency: number;
  maxAgents: number;
  maxRepairIterations: number;
  maxTurns: number;
  maxTokens: number;
  maxCostUsd: number;
  timeoutMs: number;
  maxToolCalls: number;
}

export const DEFAULT_RUN_TREE_LIMITS: RunTreeLimits = {
  maxDepth: 2, maxConcurrency: 4, maxAgents: 32, maxRepairIterations: 5,
  maxTurns: 200, maxTokens: 2_000_000, maxCostUsd: 50, timeoutMs: 4 * 60 * 60_000, maxToolCalls: 1_000,
};

export const HARD_RUN_TREE_LIMITS: RunTreeLimits = {
  maxDepth: 4, maxConcurrency: 8, maxAgents: 32, maxRepairIterations: 20,
  maxTurns: 2_000, maxTokens: 20_000_000, maxCostUsd: 1_000, timeoutMs: 24 * 60 * 60_000, maxToolCalls: 10_000,
};

export interface AgentExpansionRequest {
  parentTaskId: string;
  objective: string;
  expectedArtifact: string;
  profile?: string;
  role: AgentRole;
  dependencies?: string[];
  write: boolean;
  budget?: Partial<AgentBudget>;
}

export interface AgentBudget { maxTurns: number; maxCostUsd: number; timeoutMs: number; }
export interface AgentUsage { turns: number; tokens: number; costUsd: number; wallTimeMs: number; toolCalls: number; }
export interface AgentAuthority { read: boolean; write: boolean; network: boolean; destructive: false; }

export interface AgentTask {
  id: string;
  parentId?: string;
  role: AgentRole;
  objective: string;
  expectedArtifact: string;
  state: TaskState;
  isolation: IsolationMode;
  dependencies: string[];
  model?: string;
  provider?: string;
  profile?: string;
  executor?: ExecutorKind;
  depth: number;
  budget: AgentBudget;
  authority: AgentAuthority;
  createdAt: string;
  updatedAt: string;
  attempts: number;
  lease?: { owner: string; acquiredAt: string; heartbeatAt: string; expiresAt: string };
  cancellationRequestedAt?: string;
  lastError?: string;
  result?: { summary: string; evidence: string[]; changedPaths: string[]; usage?: Partial<AgentUsage> };
}

export interface TaskGraph {
  id: string;
  mode: 'solo' | 'pair' | 'research' | 'plan' | 'swarm' | 'review-panel' | 'repair-loop' | 'migration-loop' | 'benchmark-loop' | 'recursive-delivery';
  tasks: AgentTask[];
  limits: RunTreeLimits;
  usage: AgentUsage;
  budgetExceeded?: string;
  createdAt: string;
}

export interface AgentMessage {
  id: string;
  graphId: string;
  from: string;
  to: string;
  kind: 'instruction' | 'evidence' | 'question' | 'answer' | 'steering' | 'cancellation';
  payload: unknown;
  createdAt: string;
  acknowledgedAt?: string;
}
