export type AgentRole = 'coordinator' | 'driver' | 'navigator' | 'researcher' | 'reviewer' | 'verifier';
export type TaskState = 'pending' | 'ready' | 'running' | 'waiting' | 'succeeded' | 'failed' | 'cancelled' | 'needs_reconciliation';
export type IsolationMode = 'shared_readonly' | 'worktree';

export interface AgentBudget { maxTurns: number; maxCostUsd: number; timeoutMs: number; }
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
  budget: AgentBudget;
  authority: AgentAuthority;
  createdAt: string;
  updatedAt: string;
  attempts: number;
  lease?: { owner: string; acquiredAt: string; heartbeatAt: string; expiresAt: string };
  cancellationRequestedAt?: string;
  lastError?: string;
  result?: { summary: string; evidence: string[]; changedPaths: string[] };
}

export interface TaskGraph { id: string; mode: 'solo' | 'pair' | 'research' | 'plan' | 'swarm' | 'review-panel' | 'repair-loop'; tasks: AgentTask[]; }

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
