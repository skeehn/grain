import type { ToolResult } from '../providers/types.js';

export type ToolOutcomeStatus = 'completed' | 'failed' | 'cancelled' | 'timed_out' | 'needs_reconciliation';
export interface EvidenceReference { kind: 'file' | 'command' | 'diagnostic' | 'run' | 'wiki'; reference: string; hash?: string; }
export interface SideEffectRecord { kind: string; target: string; transactionId?: string; }
export interface TypedToolError { code: string; message: string; retryable: boolean; detail?: unknown; }
export interface ToolUsage { durationMs?: number; bytesRead?: number; bytesWritten?: number; }
export interface ToolOutcome<T> { status: ToolOutcomeStatus; data?: T; error?: TypedToolError; evidence: EvidenceReference[]; sideEffects: SideEffectRecord[]; usage?: ToolUsage; }
export interface ToolContext { invocationId: string; runId?: string; workspaceRoot: string; signal?: AbortSignal; }
export interface ToolDefinitionV2<I, O> { name: string; version: number; inputSchema: Record<string, unknown>; outputSchema: Record<string, unknown>; execute(input: I, context: ToolContext): Promise<ToolOutcome<O>>; }

export function outcomeToLegacy<T>(outcome: ToolOutcome<T>): ToolResult {
  if (outcome.status !== 'completed') return { content: JSON.stringify(outcome.error || { code: outcome.status, message: outcome.status }), is_error: true };
  return { content: typeof outcome.data === 'string' ? outcome.data : JSON.stringify({ data: outcome.data, evidence: outcome.evidence, sideEffects: outcome.sideEffects }, null, 2) };
}
