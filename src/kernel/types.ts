export const RUN_EVENT_SCHEMA_VERSION = 1 as const;

export type RunStatus =
  | 'created'
  | 'running'
  | 'waiting_approval'
  | 'executing_tool'
  | 'verifying'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'needs_reconciliation';

export type RunEventType =
  | 'run_created'
  | 'status_changed'
  | 'model_requested'
  | 'model_completed'
  | 'usage_recorded'
  | 'tool_proposed'
  | 'policy_decided'
  | 'tool_started'
  | 'tool_completed'
  | 'verification_completed'
  | 'provider_error'
  | 'protocol_error'
  | 'run_completed';

export interface RunEvent<T = Record<string, unknown>> {
  schema_version: typeof RUN_EVENT_SCHEMA_VERSION;
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
