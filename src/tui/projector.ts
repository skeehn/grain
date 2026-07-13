import type { RunEvent } from '../kernel/types.js';
import type { TuiViewModel } from './types.js';

export function projectRun(events: RunEvent[], now = Date.now()): TuiViewModel {
  if (!events.length || events[0].type !== 'run_created') throw new Error('Cannot project an empty run');
  const metadata = events[0].payload as any;
  const modelRequests = events.filter(event => event.type === 'model_requested');
  const usage = events.filter(event => event.type === 'usage_recorded').reduce((total, event) => total + Number((event.payload as any).input_tokens || 0), 0);
  const manifest = [...modelRequests].reverse().find(event => (event.payload as any).context_manifest)?.payload as any;
  const statusEvent = [...events].reverse().find(event => event.type === 'status_changed' || event.type === 'run_completed');
  const answered = new Set(events.filter(event => event.type === 'user_answered').map(event => String((event.payload as any).question_id || '')));
  const questionEvent = [...events].reverse().find(event => event.type === 'user_questioned' && !answered.has(String((event.payload as any).question_id || '')));
  return {
    run: { id: metadata.run_id, status: (statusEvent?.payload as any)?.status || 'created', provider: metadata.provider,
      model: metadata.model, task: metadata.task, elapsedMs: Math.max(0, now - Date.parse(metadata.created_at)) },
    timeline: events.slice(1).map(event => ({ sequence: event.sequence, kind: event.type, label: event.type.replaceAll('_', ' '),
      detail: String((event.payload as any).tool || (event.payload as any).name || (event.payload as any).error || ''), status: (event.payload as any).status })),
    workspace: events.filter(event => ['filesystem_transaction_prepared', 'filesystem_transaction_committed', 'filesystem_transaction_rolled_back'].includes(event.type))
      .flatMap(event => ((event.payload as any).affected_paths || []).map((path: string) => ({ path, operation: event.type, status: (event.payload as any).state || 'recorded' }))),
    agents: events.filter(event => event.type === 'child_run_created' || event.type === 'child_run_completed').map(event => ({
      id: String((event.payload as any).child_run_id), role: String((event.payload as any).role || 'agent'), state: String((event.payload as any).state || 'running'), objective: String((event.payload as any).objective || ''),
    })),
    approvals: events.filter(event => event.type === 'tool_proposed').map(event => ({ id: String((event.payload as any).invocation_id || ''),
      tool: String((event.payload as any).name || ''), risk: String((event.payload as any).risk || ''),
      decision: (events.find(item => item.type === 'policy_decided' && (item.payload as any).invocation_id === (event.payload as any).invocation_id)?.payload as any)?.decision })),
    question: questionEvent ? { id: String((questionEvent.payload as any).question_id || ''), question: String((questionEvent.payload as any).question || ''), choices: Array.isArray((questionEvent.payload as any).choices) ? (questionEvent.payload as any).choices.map(String) : [] } : undefined,
    context: { usedTokens: usage || Number(manifest?.context_manifest?.estimatedInputTokens || 0),
      budgetTokens: Number(manifest?.context_manifest?.inputBudgetTokens || 0), sources: Number(manifest?.context_manifest?.selected?.length || 0) },
    diagnostics: { passed: events.filter(event => event.type === 'verification_completed' && (event.payload as any).passed).length,
      failed: events.filter(event => event.type === 'verification_completed' && !(event.payload as any).passed).length, pending: 0 },
  };
}
