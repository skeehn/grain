export type LearningKind = 'fact' | 'decision' | 'procedure' | 'failure_pattern' | 'preference' | 'model_capability';
export type LearningStatus = 'candidate' | 'evaluated' | 'validated' | 'promoted' | 'rejected' | 'stale' | 'superseded';

export interface LearningEvidence {
  runId: string;
  verifier: string;
  outcome: 'passed' | 'failed';
  commit?: string;
  detail?: string;
  benchmarkIsolated?: boolean;
}

export interface LearningEntry {
  id: string;
  kind: LearningKind;
  statement: string;
  status: LearningStatus;
  confidence: number;
  createdAt: string;
  updatedAt: string;
  sourceRunId: string;
  evidence: LearningEvidence[];
  tags: string[];
  expiresAt?: string;
  supersedes?: string;
  requiresUserReview?: boolean;
}

export type LearningEvent =
  | { type: 'proposed'; entry: LearningEntry }
  | { type: 'validated'; id: string; evidence: LearningEvidence }
  | { type: 'promoted'; id: string }
  | { type: 'rejected' | 'stale'; id: string; reason: string };
