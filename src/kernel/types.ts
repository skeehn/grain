export const RUN_EVENT_SCHEMA_VERSION = 2 as const;
export const SUPPORTED_RUN_EVENT_SCHEMA_VERSIONS = [1, 2] as const;
export type RunEventSchemaVersion = typeof SUPPORTED_RUN_EVENT_SCHEMA_VERSIONS[number];

export type RunStatus =
  | 'created'
  | 'running'
  | 'paused'
  | 'waiting_approval'
  | 'executing_tool'
  | 'verifying'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'needs_reconciliation';

export type RunEventType =
  | 'run_created'
  | 'run_paused'
  | 'run_resumed'
  | 'run_cancel_requested'
  | 'run_recovered'
  | 'status_changed'
  | 'model_requested'
  | 'model_stream_started'
  | 'model_completed'
  | 'usage_recorded'
  | 'tool_proposed'
  | 'policy_decided'
  | 'tool_started'
  | 'tool_completed'
  | 'filesystem_transaction_prepared'
  | 'filesystem_transaction_committed'
  | 'filesystem_transaction_rolled_back'
  | 'filesystem_transaction_reconciliation'
  | 'child_run_created'
  | 'child_run_heartbeat'
  | 'child_run_completed'
  | 'user_steered'
  | 'budget_updated'
  | 'budget_exhausted'
  | 'stagnation_detected'
  | 'verification_completed'
  | 'provider_error'
  | 'protocol_error'
  | 'run_completed';

export interface RunEvent<T = Record<string, unknown>> {
  schema_version: RunEventSchemaVersion;
  run_id: string;
  sequence: number;
  timestamp: string;
  type: RunEventType;
  previous_hash: string | null;
  hash: string;
  payload: T;
}

export interface RunMetadata {
  run_id: string;
  task: string;
  cwd: string;
  provider: string;
  model: string;
  policy_profile: string;
  created_at: string;
}

export interface RunState {
  metadata: RunMetadata;
  status: RunStatus;
  last_sequence: number;
  last_hash: string | null;
  pending_tool?: { id: string; name: string; input: unknown };
  error?: string;
}

export interface RunBudget {
  max_turns: number;
  max_input_tokens: number;
  max_output_tokens: number;
  max_cost_usd: number;
  max_wall_time_ms: number;
  max_tool_calls: number;
  max_child_runs: number;
  max_provider_retries: number;
}

export type ReconciliationResolution = 'mark_completed' | 'rollback' | 'retry' | 'cancel';
export type RunCommand =
  | { type: 'start' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'cancel'; force?: boolean }
  | { type: 'approve'; proposalId: string }
  | { type: 'deny'; proposalId: string; reason?: string }
  | { type: 'steer'; targetRunId: string; message: string }
  | { type: 'retry'; phaseId: string }
  | { type: 'reconcile'; invocationId: string; resolution: ReconciliationResolution };
