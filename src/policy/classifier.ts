import type { PolicyContext, ToolPolicyResult, ToolRisk } from './types.js';

// `ask_user` is a user-interaction prompt with no workspace/network side effects —
// it must never require approval (that would ask the user to approve being asked),
// and must not be policy-denied in non-interactive mode where it returns a graceful
// "user input required" result on its own.
const READ_ONLY = new Set(['read', 'grep', 'workspace_scan', 'repo_map', 'inspect', 'search', 'code_search', 'screenshot', 'run_tests', 'test_fix_loop', 'wiki_search', 'wiki_get', 'work_recall', 'ask_user']);
const WRITES = new Set(['write', 'patch', 'multi_edit', 'plan', 'wiki_propose_update', 'work_note', 'run_agents']);
const NETWORK = /\b(curl|wget|ssh|scp|rsync|npm\s+publish|git\s+push|gh\s+pr|docker\s+push)\b/i;
const DESTRUCTIVE = /(^|[;&|]\s*|\b)(rm|rmdir|shred|mkfs|dd)\b|git\s+(reset\s+--hard|clean|checkout\s+--)|DROP\s+(TABLE|DATABASE)|truncate\s+/i;
const INDIRECT = /\$\(|`|>\s*\/|\beval\b|\bsource\b/i;
// Privilege escalation and fork bombs stay destructive even inside otherwise
// "safe" compound commands, so the compound-command default below can't run them.
const PRIVILEGE = /\b(sudo|doas)\b/i;
const FORK_BOMB = /\(\s*\)\s*\{[^}]*\|[^}]*&\s*\}/;

export function classifyTool(name: string, input: any): ToolRisk {
  if (/^mcp__[^_]+__(resource_read|prompt_get)$/.test(name)) return 'read_only';
  if (name.startsWith('mcp__')) return 'external_side_effect';
  if (READ_ONLY.has(name)) return 'read_only';
  if (WRITES.has(name)) return 'workspace_write';
  if (name === 'finish' || name === 'engram') return name === 'finish' ? 'read_only' : 'external_side_effect';
  if (name === 'delegate' || name === 'spawn_agent') return 'external_side_effect';
  if (name === 'git') {
    if (input?.action === 'status') return 'read_only';
    if (input?.action === 'rollback') return 'destructive';
    return 'workspace_write';
  }
  if (name === 'bash') {
    const command = String(input?.command || '');
    if (DESTRUCTIVE.test(command) || INDIRECT.test(command) || PRIVILEGE.test(command) || FORK_BOMB.test(command)) return 'destructive';
    if (NETWORK.test(command)) return 'network';
    if (/\b(mv|cp|mkdir|touch|chmod|chown|git\s+(add|commit)|sed\s+-i)\b|(^|\s)>[^>]/i.test(command)) return 'workspace_write';
    if (/^[\w./-]+(?:\s+[\w@%+=:,./-]+)*\s*$/.test(command)) return 'read_only';
    // Compound/piped commands (|, ;, &&, globs) that matched NONE of the
    // dangerous patterns above — find|wc, sort|uniq, awk, jq pipelines — are
    // ordinary workspace work: allowed under --yes, ask otherwise. (The old
    // default of 'destructive' denied every pipeline in non-interactive mode.)
    return 'workspace_write';
  }
  return 'destructive';
}

export function decidePolicy(name: string, input: any, context: PolicyContext): ToolPolicyResult {
  const risk = classifyTool(name, input);
  if (risk === 'read_only') return { risk, decision: 'allow', reason: 'read-only operation' };
  // In Terminal-Bench bridge mode bash never runs on the Grain host: bash.ts
  // serializes the command to Harbor, which executes it under the task's
  // disposable container and network policy. Applying host command policy a
  // second time breaks legitimate benchmark work such as redirection, package
  // installation, and task cleanup without adding host protection.
  if (context.benchmark && name === 'bash') return { risk, decision: 'allow', reason: 'Harbor-isolated benchmark container' };
  if (risk === 'workspace_write') {
    if (context.autoApprove) return { risk, decision: 'allow', reason: '--yes authorizes workspace writes' };
    return { risk, decision: context.interactive ? 'ask' : 'deny', reason: 'workspace write requires approval' };
  }
  if (risk === 'destructive') {
    if (context.allowDestructive) return { risk, decision: 'allow', reason: '--allow-destructive explicitly set' };
    return { risk, decision: context.interactive ? 'ask' : 'deny', reason: 'destructive operation requires explicit approval' };
  }
  return { risk, decision: context.interactive ? 'ask' : 'deny', reason: `${risk} operation requires explicit approval` };
}
