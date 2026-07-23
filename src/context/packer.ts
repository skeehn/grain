import type { Tool } from '../providers/types.js';
import type { ContextCandidate, ContextPackResult, ModelCapabilities, PackedContextItem } from './types.js';
import { createHash } from 'crypto';

export function estimateTokens(value: string): number {
  return Math.max(1, Math.ceil(value.length / 4));
}

function truncateToTokens(value: string, tokens: number): string {
  const chars = Math.max(0, tokens * 4);
  if (value.length <= chars) return value;
  return `${value.slice(0, Math.max(0, chars - 32))}\n[context truncated by Grain]`;
}

export function packContext(
  capabilities: ModelCapabilities,
  candidates: ContextCandidate[],
  availableTools: Tool[],
): ContextPackResult {
  const reserve = Math.min(capabilities.maxOutputTokens, Math.max(512, Math.floor(capabilities.contextWindow * 0.2)));
  const budget = Math.max(1_024, capabilities.contextWindow - reserve);
  const toolNames = capabilities.preferredToolNames;
  const tools = capabilities.supportsTools
    ? availableTools.filter(tool => !toolNames || toolNames.includes(tool.name) || tool.name.startsWith('mcp__'))
    : [];
  const toolCandidate: ContextCandidate | undefined = tools.length ? {
    id: 'tool-schemas', kind: 'tool_schema', priority: 95, required: true,
    content: JSON.stringify(tools.map(({ name, description, input_schema }) => ({ name, description, input_schema }))),
    source: 'runtime-tool-registry',
  } : undefined;

  const ordered = [...candidates, ...(toolCandidate ? [toolCandidate] : [])]
    .sort((a, b) => Number(!!b.required) - Number(!!a.required) || b.priority - a.priority || a.id.localeCompare(b.id));
  const selected: PackedContextItem[] = [];
  const omitted: ContextPackResult['manifest']['omitted'] = [];
  const allocation: ContextPackResult['manifest']['allocation'] = {
    instruction: 0, conversation: 0, tool_schema: 0, workspace: 0, wiki: 0, memory: 0, verification: 0,
  };
  const softCaps: Partial<Record<ContextCandidate['kind'], number>> = {
    memory: Math.floor(budget * 0.10), workspace: Math.floor(budget * 0.30), wiki: Math.floor(budget * 0.30),
    verification: Math.floor(budget * 0.20),
  };
  let used = 0;

  for (const candidate of ordered) {
    const estimatedTokens = estimateTokens(candidate.content);
    const remaining = budget - used;
    const kindCap = softCaps[candidate.kind];
    if (!candidate.required && kindCap !== undefined && allocation[candidate.kind] + estimatedTokens > kindCap) {
      omitted.push({ id: candidate.id, kind: candidate.kind, reason: `${candidate.kind}_allocation_exhausted`, estimatedTokens,
        sourceIds: candidate.sourceIds, sourceHash: candidate.sourceHash });
      continue;
    }
    if (estimatedTokens <= remaining) {
      selected.push({ ...candidate, sourceHash: candidate.sourceHash || createHash('sha256').update(candidate.content).digest('hex'),
        estimatedTokens, truncated: false, decisionReason: candidate.required ? 'required' : 'priority_selected' });
      used += estimatedTokens;
      allocation[candidate.kind] += estimatedTokens;
    } else if (candidate.required && remaining >= 128) {
      const content = truncateToTokens(candidate.content, remaining);
      const actual = estimateTokens(content);
      selected.push({ ...candidate, content, sourceHash: candidate.sourceHash || createHash('sha256').update(candidate.content).digest('hex'),
        estimatedTokens: actual, truncated: true, decisionReason: 'required_truncated_to_budget' });
      used += actual;
      allocation[candidate.kind] += actual;
    } else {
      omitted.push({ id: candidate.id, kind: candidate.kind, reason: 'context_budget_exhausted', estimatedTokens,
        sourceIds: candidate.sourceIds, sourceHash: candidate.sourceHash });
    }
  }

  return {
    items: selected,
    tools,
    manifest: {
      schemaVersion: 2, provider: capabilities.provider, model: capabilities.model,
      contextWindow: capabilities.contextWindow, reservedOutputTokens: reserve,
      inputBudgetTokens: budget, estimatedInputTokens: used, selected,
      omitted, tools: tools.map(tool => tool.name), tokenEstimator: { name: 'chars-per-token', version: '1:4' },
      allocation, compactionIds: candidates.flatMap(candidate => candidate.sourceIds || []).filter(id => id.startsWith('compaction:')),
    },
  };
}
