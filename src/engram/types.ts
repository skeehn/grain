export const MEMORY_SCHEMA_VERSION = 1 as const;

export type MemoryType = 'fact' | 'preference' | 'procedure' | 'episode' | 'error' | 'repository_knowledge' | 'summary';
export type MemoryStatus = 'candidate' | 'validated' | 'promoted' | 'rejected' | 'stale' | 'superseded';
export type MemorySensitivity = 'public' | 'internal' | 'sensitive' | 'secret';

export interface MemoryScope {
  user?: string;
  workspace?: string;
  repository?: string;
  branch?: string;
  session?: string;
  global?: boolean;
}

export interface MemoryProvenance {
  sourceRunId?: string;
  sourceMessageIds?: string[];
  sourceUri?: string;
  sourceSpan?: { start?: number; end?: number };
  createdBy: 'grain' | 'user' | 'engram' | 'import';
  ingestionMethod?: string;
}

export interface MemoryValidationEvidence {
  runId: string;
  verifier: string;
  outcome: 'passed' | 'failed';
  detail?: string;
  timestamp: string;
}

export interface MemoryRecordV1 {
  schemaVersion: typeof MEMORY_SCHEMA_VERSION;
  id: string;
  content: string;
  contentHash: string;
  type: MemoryType;
  status: MemoryStatus;
  scope: MemoryScope;
  provenance: MemoryProvenance;
  confidence: number;
  validation: MemoryValidationEvidence[];
  sensitivity: MemorySensitivity;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  supersedes?: string;
  lastUsedAt?: string;
  retrievalCount: number;
  repositoryState?: { commit?: string; sourceBlobHashes?: Record<string, string> };
}

export type MemoryUpdateV1 = Partial<Pick<MemoryRecordV1,
  'content' | 'type' | 'status' | 'scope' | 'confidence' | 'validation' | 'sensitivity' | 'tags' | 'expiresAt' | 'supersedes' | 'repositoryState'>>;

export interface MemoryExportV1 {
  schemaVersion: 1;
  exportedAt: string;
  memories: MemoryRecordV1[];
  metadata?: Record<string, unknown>;
}

export interface EngramCapabilities {
  apiVersion: 'v1' | 'legacy';
  serverVersion?: string;
  memorySchemaVersions: number[];
  searchModes: Array<'lexical' | 'vector' | 'hybrid' | 'graph'>;
  supportsGovernance: boolean;
  supportsContextPacks: boolean;
  supportsIdempotency: boolean;
  supportsIndexStatus: boolean;
  supportsExport?: boolean;
  supportsIndexRebuild?: boolean;
}

export interface MemorySearchRequest {
  query: string;
  limit?: number;
  scope?: MemoryScope;
  types?: MemoryType[];
  statuses?: MemoryStatus[];
  modes?: EngramCapabilities['searchModes'];
  tokenBudget?: number;
  signal?: AbortSignal;
}

export interface MemorySearchResult {
  memory: MemoryRecordV1;
  score: number;
  mode?: string;
  explanation?: Record<string, number | string>;
}

export interface EngramStatus {
  available: boolean;
  degraded: boolean;
  transport: 'v1' | 'legacy-http' | 'unavailable';
  capabilities: EngramCapabilities;
  reason?: string;
  checkedAt: string;
}

export interface EngramStructuredError {
  code: string;
  message: string;
  retryable: boolean;
  requestId?: string;
  details?: unknown;
}

export class EngramClientError extends Error implements EngramStructuredError {
  readonly name = 'EngramClientError';
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
    readonly requestId?: string,
    readonly details?: unknown,
  ) { super(message); }
}
