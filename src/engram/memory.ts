import { createHash } from 'crypto';
import { getEngramClient } from './client.js';
import type { MemoryRecordV1, MemoryScope, MemorySearchRequest, MemorySearchResult, MemoryType } from './types.js';

const SECRET_PATTERN = /(?:api[_-]?key|token|password|secret)\s*[:=]\s*[^\s,;]+/iu;
const INSTRUCTION_PATTERN = /(?:ignore|override|disregard).{0,48}(?:previous|system|developer).{0,48}instructions?/iu;

export interface MemoryProposal {
  content: string;
  type: MemoryType;
  scope: MemoryScope;
  sourceRunId?: string;
  sourceMessageIds?: string[];
  tags?: string[];
  confidence?: number;
}

export function assessMemoryProposal(proposal: MemoryProposal): { allowed: boolean; reasons: string[]; sensitivity: MemoryRecordV1['sensitivity'] } {
  const reasons: string[] = [];
  if (!proposal.content.trim()) reasons.push('empty_content');
  if (SECRET_PATTERN.test(proposal.content)) reasons.push('possible_secret');
  if (INSTRUCTION_PATTERN.test(proposal.content)) reasons.push('prompt_injection_language');
  if (!proposal.scope.repository && !proposal.scope.workspace && !proposal.scope.session && !proposal.scope.user && !proposal.scope.global) reasons.push('missing_scope');
  return { allowed: reasons.length === 0, reasons, sensitivity: reasons.includes('possible_secret') ? 'secret' : 'internal' };
}

export function memoryEligibleForRecall(memory: MemoryRecordV1, requestedScope?: MemoryScope): { eligible: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (memory.status !== 'promoted') reasons.push('not_promoted');
  if (memory.sensitivity === 'secret') reasons.push('secret');
  if (memory.expiresAt && Date.parse(memory.expiresAt) <= Date.now()) reasons.push('expired');
  if (INSTRUCTION_PATTERN.test(memory.content)) reasons.push('prompt_injection_language');
  if (memory.scope.global && !requestedScope?.global) reasons.push('global_recall_not_enabled');
  if (requestedScope) for (const key of ['user', 'workspace', 'repository', 'branch', 'session'] as const) {
    const expected = requestedScope[key];
    if (expected && memory.scope[key] !== expected) reasons.push(`scope_mismatch:${key}`);
  }
  return { eligible: reasons.length === 0, reasons };
}

export class MemoryService {
  async search(request: MemorySearchRequest): Promise<MemorySearchResult[]> {
    const results = await getEngramClient().search({ ...request, statuses: ['promoted'] });
    return results.filter(result => memoryEligibleForRecall(result.memory, request.scope).eligible);
  }

  async propose(proposal: MemoryProposal): Promise<MemoryRecordV1> {
    const assessment = assessMemoryProposal(proposal);
    if (!assessment.allowed) throw new Error(`Memory proposal rejected: ${assessment.reasons.join(', ')}`);
    return getEngramClient().create({
      schemaVersion: 1, content: proposal.content.trim(), type: proposal.type, status: 'candidate', scope: proposal.scope,
      provenance: { sourceRunId: proposal.sourceRunId, sourceMessageIds: proposal.sourceMessageIds, createdBy: 'grain', ingestionMethod: 'automatic-candidate' },
      confidence: Math.max(0, Math.min(1, proposal.confidence ?? 0.5)), validation: [], sensitivity: assessment.sensitivity,
      tags: proposal.tags || [],
    }, { idempotencyKey: createHash('sha256').update(`${proposal.sourceRunId || 'manual'}\0${proposal.content.trim()}`).digest('hex') });
  }
}
