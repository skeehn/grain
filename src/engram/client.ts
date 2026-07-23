import { createHash, randomUUID } from 'crypto';
import type {
  EngramCapabilities, EngramStatus, MemoryExportV1, MemoryRecordV1, MemoryScope, MemorySearchRequest, MemorySearchResult, MemoryUpdateV1,
} from './types.js';
import { EngramClientError } from './types.js';

const LEGACY_CAPABILITIES: EngramCapabilities = {
  apiVersion: 'legacy', memorySchemaVersions: [], searchModes: ['hybrid'], supportsGovernance: false,
  supportsContextPacks: false, supportsIdempotency: false, supportsIndexStatus: false,
  supportsExport: false, supportsIndexRebuild: false,
};
const V1_DEFAULTS: EngramCapabilities = {
  apiVersion: 'v1', memorySchemaVersions: [1], searchModes: ['lexical', 'vector', 'hybrid', 'graph'],
  supportsGovernance: true, supportsContextPacks: true, supportsIdempotency: true, supportsIndexStatus: true,
  supportsExport: true, supportsIndexRebuild: true,
};
const STATUS_TTL_MS = 30_000;

function endpoint(): string {
  return (process.env.GRAIN_ENGRAM_HTTP || 'http://127.0.0.1:7474').replace(/\/$/u, '');
}

function combinedSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal && typeof AbortSignal.any === 'function' ? AbortSignal.any([signal, timeout]) : timeout;
}

function clampConfidence(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0.5;
}

function contentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function scopeProject(scope?: MemoryScope): string | undefined {
  return scope?.repository || scope?.workspace;
}

function legacyRecord(raw: any, scope: MemoryScope = {}): MemoryRecordV1 {
  const now = new Date().toISOString();
  const content = String(raw?.content ?? raw?.body ?? '');
  const tags = Array.isArray(raw?.tags) ? raw.tags.map(String) : [];
  const projectTag = tags.find((tag: string) => tag.startsWith('project:'));
  return {
    schemaVersion: 1, id: String(raw?.id || randomUUID()), content, contentHash: contentHash(content),
    type: raw?.node_type === 'fact' || raw?.type === 'fact' ? 'fact' : 'repository_knowledge',
    status: 'promoted', scope: { ...scope, repository: scope.repository || projectTag?.slice(8) },
    provenance: { createdBy: 'import', ingestionMethod: 'legacy-engram' },
    confidence: clampConfidence(raw?.confidence ?? raw?.score), validation: [], sensitivity: 'internal', tags,
    createdAt: String(raw?.tx_time || raw?.created || now), updatedAt: String(raw?.tx_time || raw?.created || now),
    retrievalCount: 0,
  };
}

function normalizeMemoryRecord(raw: any): MemoryRecordV1 {
  if (!raw || typeof raw !== 'object') throw new EngramClientError('protocol_error', 'Engram returned an invalid memory record');
  const now = new Date().toISOString();
  const content = String(raw.content ?? raw.body ?? '');
  const provenance = raw.provenance || {};
  return {
    schemaVersion: Number(raw.schemaVersion ?? raw.schema_version ?? 1) as 1,
    id: String(raw.id || ''), content, contentHash: String(raw.contentHash ?? raw.content_hash ?? contentHash(content)),
    type: raw.type ?? raw.memory_type ?? 'fact', status: raw.status ?? raw.lifecycle_state ?? 'candidate',
    scope: raw.scope || raw.namespace || {},
    provenance: { sourceRunId: provenance.sourceRunId ?? provenance.source_run_id,
      sourceMessageIds: provenance.sourceMessageIds ?? provenance.source_message_ids,
      sourceUri: provenance.sourceUri ?? provenance.source_uri, sourceSpan: provenance.sourceSpan ?? provenance.source_span,
      createdBy: provenance.createdBy ?? provenance.created_by ?? 'engram', ingestionMethod: provenance.ingestionMethod ?? provenance.ingestion_method },
    confidence: clampConfidence(raw.confidence), validation: raw.validation || [], sensitivity: raw.sensitivity || 'internal',
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [], createdAt: String(raw.createdAt ?? raw.created_at ?? now),
    updatedAt: String(raw.updatedAt ?? raw.updated_at ?? now), expiresAt: raw.expiresAt ?? raw.expires_at,
    supersedes: raw.supersedes, lastUsedAt: raw.lastUsedAt ?? raw.last_used_at,
    retrievalCount: Number(raw.retrievalCount ?? raw.retrieval_count ?? 0), repositoryState: raw.repositoryState ?? raw.repository_state,
  };
}

function normalizeCapabilities(raw: any): EngramCapabilities {
  return {
    ...V1_DEFAULTS,
    serverVersion: typeof raw?.server_version === 'string' ? raw.server_version : raw?.serverVersion,
    memorySchemaVersions: Array.isArray(raw?.memory_schema_versions) ? raw.memory_schema_versions.map(Number)
      : Array.isArray(raw?.memorySchemaVersions) ? raw.memorySchemaVersions.map(Number) : [1],
    searchModes: Array.isArray(raw?.search_modes) ? raw.search_modes : Array.isArray(raw?.searchModes) ? raw.searchModes : V1_DEFAULTS.searchModes,
    supportsGovernance: raw?.supports_governance ?? raw?.supportsGovernance ?? true,
    supportsContextPacks: raw?.supports_context_packs ?? raw?.supportsContextPacks ?? true,
    supportsIdempotency: raw?.supports_idempotency ?? raw?.supportsIdempotency ?? true,
    supportsIndexStatus: raw?.supports_index_status ?? raw?.supportsIndexStatus ?? true,
    supportsExport: raw?.supports_export ?? raw?.supportsExport ?? true,
    supportsIndexRebuild: raw?.supports_index_rebuild ?? raw?.supportsIndexRebuild ?? true,
  };
}

export class EngramClient {
  private cachedStatus?: EngramStatus;
  constructor(readonly baseUrl = endpoint()) {}

  reset(): void { this.cachedStatus = undefined; }

  private async request(path: string, init: RequestInit = {}, timeoutMs = 5_000): Promise<any> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, { ...init, signal: combinedSignal(init.signal || undefined, timeoutMs) });
    } catch (error) {
      const aborted = init.signal?.aborted;
      throw new EngramClientError(aborted ? 'cancelled' : 'transport_unavailable', aborted ? 'Engram request cancelled' : 'Engram is unavailable', !aborted, undefined, error);
    }
    const requestId = response.headers.get('x-request-id') || undefined;
    let body: any;
    const text = await response.text();
    try { body = text ? JSON.parse(text) : undefined; } catch { body = text; }
    if (!response.ok) {
      const structured = body?.error;
      throw new EngramClientError(String(structured?.code || `http_${response.status}`),
        String(structured?.message || response.statusText || 'Engram request failed'),
        Boolean(structured?.retryable || response.status >= 500 || response.status === 429), requestId, structured?.details);
    }
    return body;
  }

  async status(force = false): Promise<EngramStatus> {
    if (!force && this.cachedStatus && Date.now() - Date.parse(this.cachedStatus.checkedAt) < STATUS_TTL_MS) return this.cachedStatus;
    const checkedAt = new Date().toISOString();
    try {
      await this.request('/health', {}, 2_000);
    } catch (error) {
      this.cachedStatus = { available: false, degraded: true, transport: 'unavailable', capabilities: LEGACY_CAPABILITIES,
        reason: error instanceof Error ? error.message : String(error), checkedAt };
      return this.cachedStatus;
    }
    try {
      const raw = await this.request('/capabilities', {}, 2_000);
      if (raw && !Array.isArray(raw) && (raw.api_version === 'v1' || raw.apiVersion === 'v1' || raw.memory_schema_versions || raw.memorySchemaVersions)) {
        this.cachedStatus = { available: true, degraded: false, transport: 'v1', capabilities: normalizeCapabilities(raw), checkedAt };
        return this.cachedStatus;
      }
    } catch { /* legacy server has no capability endpoint */ }
    this.cachedStatus = { available: true, degraded: true, transport: 'legacy-http', capabilities: LEGACY_CAPABILITIES,
      reason: 'Legacy Engram API: governance and typed scopes are unavailable', checkedAt };
    return this.cachedStatus;
  }

  async search(request: MemorySearchRequest): Promise<MemorySearchResult[]> {
    const status = await this.status();
    if (!status.available) throw new EngramClientError('unavailable', status.reason || 'Engram is unavailable', true);
    if (status.transport === 'v1') {
      const raw = await this.request('/v1/search', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: request.query, limit: request.limit ?? 10, scope: request.scope, types: request.types,
          statuses: request.statuses, modes: request.modes, token_budget: request.tokenBudget }), signal: request.signal }, 15_000);
      const results = Array.isArray(raw) ? raw : raw?.results || [];
      return results.map((item: any) => ({ memory: normalizeMemoryRecord(item.memory || item.record || item), score: Number(item.score || 0),
        mode: item.mode, explanation: item.explanation }));
    }
    const params = new URLSearchParams({ q: request.query, top_k: String(request.limit ?? 10) });
    const project = scopeProject(request.scope); if (project) params.set('project', project);
    const raw = await this.request(`/search?${params}`, { signal: request.signal }, 15_000);
    const results = Array.isArray(raw) ? raw : raw?.results || [];
    return results.map((item: any) => ({ memory: legacyRecord(item, request.scope), score: Number(item.score || 0), mode: 'legacy' }));
  }

  async create(record: Omit<MemoryRecordV1, 'id' | 'contentHash' | 'createdAt' | 'updatedAt' | 'retrievalCount'>,
    options: { idempotencyKey?: string; signal?: AbortSignal } = {}): Promise<MemoryRecordV1> {
    const status = await this.status();
    if (!status.available) throw new EngramClientError('unavailable', status.reason || 'Engram is unavailable', true);
    if (status.transport !== 'v1') throw new EngramClientError('legacy_write_unsupported',
      'Governed memory writes require Engram /v1; the legacy store remains readable', false);
    const raw = await this.request('/v1/memories', { method: 'POST', headers: { 'content-type': 'application/json',
      'idempotency-key': options.idempotencyKey || randomUUID() }, body: JSON.stringify(record), signal: options.signal });
    return normalizeMemoryRecord(raw?.memory || raw);
  }

  async get(id: string, signal?: AbortSignal): Promise<MemoryRecordV1> {
    const status = await this.status();
    if (status.transport !== 'v1') throw new EngramClientError('legacy_typed_read_unsupported', 'Typed reads require Engram /v1', false);
    const raw = await this.request(`/v1/memories/${encodeURIComponent(id)}`, { signal });
    return normalizeMemoryRecord(raw?.memory || raw);
  }

  async update(id: string, patch: MemoryUpdateV1, signal?: AbortSignal): Promise<MemoryRecordV1> {
    const status = await this.status();
    if (status.transport !== 'v1') throw new EngramClientError('legacy_update_unsupported', 'Governed memory updates require Engram /v1', false);
    const raw = await this.request(`/v1/memories/${encodeURIComponent(id)}`, { method: 'PATCH',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch), signal });
    return normalizeMemoryRecord(raw?.memory || raw);
  }

  async list(options: { limit?: number; scope?: MemoryScope; signal?: AbortSignal } = {}): Promise<MemoryRecordV1[]> {
    const status = await this.status();
    if (status.transport !== 'v1') throw new EngramClientError('legacy_typed_read_unsupported', 'Typed listing requires Engram /v1', false);
    const params = new URLSearchParams({ limit: String(options.limit ?? 20) });
    if (options.scope) params.set('scope', JSON.stringify(options.scope));
    const raw = await this.request(`/v1/memories?${params}`, { signal: options.signal });
    return (Array.isArray(raw) ? raw : raw?.memories || []).map(normalizeMemoryRecord);
  }

  async indexStatus(signal?: AbortSignal): Promise<Record<string, unknown>> {
    const status = await this.status();
    if (status.transport !== 'v1') throw new EngramClientError('legacy_index_status_unsupported', 'Detailed index status requires Engram /v1', false);
    return this.request('/v1/index/status', { signal });
  }

  async export(options: { scope?: MemoryScope; signal?: AbortSignal } = {}): Promise<MemoryExportV1> {
    const status = await this.status();
    if (status.transport !== 'v1') throw new EngramClientError('legacy_export_unsupported', 'Verified memory export requires Engram /v1', false);
    const params = new URLSearchParams();
    if (options.scope) params.set('scope', JSON.stringify(options.scope));
    const raw = await this.request(`/v1/export${params.size ? `?${params}` : ''}`, { signal: options.signal }, 30_000);
    return { schemaVersion: 1, exportedAt: String(raw?.exportedAt ?? raw?.exported_at ?? new Date().toISOString()),
      memories: (Array.isArray(raw) ? raw : raw?.memories || []).map(normalizeMemoryRecord), metadata: raw?.metadata };
  }

  async rebuildIndex(signal?: AbortSignal): Promise<Record<string, unknown>> {
    const status = await this.status();
    if (status.transport !== 'v1') throw new EngramClientError('legacy_rebuild_unsupported', 'Observable index rebuild requires Engram /v1', false);
    return this.request('/v1/index/rebuild', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal }, 30_000);
  }

  async forget(id: string, signal?: AbortSignal): Promise<void> {
    const status = await this.status();
    if (status.transport !== 'v1') throw new EngramClientError('legacy_delete_unsupported', 'Verified deletion requires Engram /v1', false);
    await this.request(`/v1/memories/${encodeURIComponent(id)}`, { method: 'DELETE', signal });
  }
}

let defaultClient = new EngramClient();
export function getEngramClient(): EngramClient { return defaultClient; }
export function resetEngramClient(): void { defaultClient = new EngramClient(); }
