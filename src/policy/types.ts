export type ToolRisk = 'read_only' | 'workspace_write' | 'destructive' | 'network' | 'external_side_effect';
export type PolicyDecision = 'allow' | 'deny' | 'ask';

export interface PolicyContext {
  autoApprove: boolean;
  allowDestructive: boolean;
  benchmark: boolean;
  interactive: boolean;
}

export interface ToolPolicyResult {
  risk: ToolRisk;
  decision: PolicyDecision;
  reason: string;
}
