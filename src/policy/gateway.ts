import { randomUUID } from 'crypto';
import type { ToolResult } from '../providers/types.js';
import { executeTool } from '../tools/index.js';
import type { RunJournal } from '../kernel/journal.js';
import { decidePolicy } from './classifier.js';
import type { PolicyContext, ToolPolicyResult } from './types.js';

export interface GatewayOptions extends PolicyContext {
  journal?: RunJournal;
  approve?: (name: string, input: unknown, policy: ToolPolicyResult) => Promise<boolean>;
  /** Show a visual apply/diff before a workspace write is approved or executed. */
  preview?: (name: string, input: unknown) => void;
}

export class ToolGateway {
  constructor(private readonly options: GatewayOptions) {}

  async execute(name: string, input: any, toolUseId?: string): Promise<ToolResult> {
    const invocationId = randomUUID();
    const policy = decidePolicy(name, input, this.options);
    this.options.journal?.append('tool_proposed', { id: toolUseId || invocationId, invocation_id: invocationId, name, input, risk: policy.risk });
    this.options.preview?.(name, input);
    let allowed = policy.decision === 'allow';
    if (policy.decision === 'ask' && this.options.approve) allowed = await this.options.approve(name, input, policy);
    this.options.journal?.append('policy_decided', { invocation_id: invocationId, name, risk: policy.risk,
      decision: allowed ? 'allow' : 'deny', reason: policy.reason });
    if (!allowed) return { content: `Denied by policy: ${policy.reason}`, is_error: true };

    this.options.journal?.transition('executing_tool', { invocation_id: invocationId, tool: name });
    this.options.journal?.append('tool_started', { invocation_id: invocationId, name });
    try {
      const result = await executeTool(name, input);
      this.options.journal?.append('tool_completed', { invocation_id: invocationId, name,
        is_error: Boolean(result.is_error), content: typeof result.content === 'string' ? result.content : JSON.stringify(result.content) });
      this.options.journal?.transition('running');
      return result;
    } catch (error: any) {
      this.options.journal?.transition(policy.risk === 'read_only' ? 'failed' : 'needs_reconciliation', { error: error.message, invocation_id: invocationId });
      throw error;
    }
  }
}
