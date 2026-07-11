import type { Tool } from '../providers/types.js';
import type { ContextCandidate, ContextPackResult, ModelCapabilities, PackedContextItem } from './types.js';

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
    ? availableTools.filter(tool => !toolNames || toolNames.includes(tool.name))
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
  let used = 0;

  for (const candidate of ordered) {
    const estimatedTokens = estimateTokens(candidate.content);
    const remaining = budget - used;
    if (estimatedTokens <= remaining) {
      selected.push({ ...candidate, estimatedTokens, truncated: false });
      used += estimatedTokens;
    } else if (candidate.required && remaining >= 128) {
      const content = truncateToTokens(candidate.content, remaining);
      const actual = estimateTokens(content);
      selected.push({ ...candidate, content, estimatedTokens: actual, truncated: true });
      used += actual;
    } else {
      omitted.push({ id: candidate.id, kind: candidate.kind, reason: 'context_budget_exhausted', estimatedTokens });
    }
  }

  return {
    items: selected,
    tools,
    manifest: {
      schemaVersion: 1, provider: capabilities.provider, model: capabilities.model,
      contextWindow: capabilities.contextWindow, reservedOutputTokens: reserve,
      inputBudgetTokens: budget, estimatedInputTokens: used, selected,
      omitted, tools: tools.map(tool => tool.name),
    },
  };
}
