import type { Tool } from '../providers/types.js';

export type ContextKind = 'instruction' | 'conversation' | 'tool_schema' | 'workspace' | 'wiki' | 'memory' | 'verification';

export interface ModelCapabilities {
  provider: string;
  model: string;
  contextWindow: number;
  maxOutputTokens: number;
  supportsTools: boolean;
  supportsParallelTools: boolean;
  supportsImages: boolean;
  supportsReasoning: boolean;
  supportsStructuredOutput: boolean;
  supportsPromptCaching: boolean;
  preferredToolNames?: string[];
}

export interface ContextCandidate {
  id: string;
  kind: ContextKind;
  content: string;
  priority: number;
  required?: boolean;
  source?: string;
  freshness?: string;
  sourceIds?: string[];
  sourceHash?: string;
  /** Retrieved memory and repository text is data, never model instruction. */
  untrusted?: boolean;
  ranking?: Record<string, number>;
}

export interface PackedContextItem extends ContextCandidate {
  estimatedTokens: number;
  truncated: boolean;
  decisionReason: string;
}

export interface ContextManifest {
  schemaVersion: 2;
  provider: string;
  model: string;
  contextWindow: number;
  reservedOutputTokens: number;
  inputBudgetTokens: number;
  estimatedInputTokens: number;
  selected: PackedContextItem[];
  omitted: Array<{ id: string; kind: ContextKind; reason: string; estimatedTokens: number; sourceIds?: string[]; sourceHash?: string }>;
  tools: string[];
  tokenEstimator: { name: string; version: string };
  allocation: Record<ContextKind, number>;
  compactionIds: string[];
}

export interface ContextPackResult {
  manifest: ContextManifest;
  items: PackedContextItem[];
  tools: Tool[];
}
