import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';
import { getEngramClient } from '../engram/index.js';
import type { MemoryStatus, MemoryType } from '../engram/index.js';
import { LearningLedger } from './ledger.js';
import type { LearningEntry, LearningKind } from './types.js';

export interface LearningMigrationReport {
  schemaVersion: 1;
  startedAt: string;
  finishedAt: string;
  scope: string;
  imported: string[];
  skipped: string[];
  errors: Array<{ id: string; error: string }>;
}

function migrationPath(): string {
  return join(process.env.GRAIN_HOME || join(homedir(), '.grain'), 'learning', 'engram-v1-migration.json');
}

function durableWrite(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`; const fd = openSync(tmp, 'w', 0o600);
  try { writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`); fsyncSync(fd); }
  finally { closeSync(fd); }
  renameSync(tmp, path);
}

function memoryType(kind: LearningKind): MemoryType {
  if (kind === 'procedure') return 'procedure';
  if (kind === 'preference') return 'preference';
  if (kind === 'failure_pattern') return 'error';
  return 'fact';
}

function memoryStatus(entry: LearningEntry): MemoryStatus {
  // Engram v1 has no intermediate evaluation state; keep it untrusted until
  // Grain has collected the second independent validation.
  return entry.status === 'evaluated' ? 'candidate' : entry.status;
}

export async function migrateLearningLedgerToEngram(scope: string, ledger = new LearningLedger()): Promise<LearningMigrationReport> {
  if (!scope.trim()) throw new Error('A repository/workspace scope is required for learning migration');
  const status = await getEngramClient().status(true);
  if (status.transport !== 'v1') throw new Error('Learning migration requires an Engram /v1 daemon');
  const path = migrationPath();
  let completed = new Set<string>();
  if (existsSync(path)) try {
    const previous = JSON.parse(readFileSync(path, 'utf8')) as LearningMigrationReport;
    if (previous.scope === scope) completed = new Set([...previous.imported, ...previous.skipped]);
  } catch { /* restart from source; idempotency prevents duplicate writes */ }
  const startedAt = new Date().toISOString();
  const report: LearningMigrationReport = { schemaVersion: 1, startedAt, finishedAt: startedAt, scope,
    imported: [...completed], skipped: [], errors: [] };
  for (const entry of ledger.list()) {
    if (completed.has(entry.id)) continue;
    if (entry.status === 'rejected' || entry.status === 'stale' || entry.status === 'superseded') {
      report.skipped.push(entry.id); continue;
    }
    try {
      await getEngramClient().create({ schemaVersion: 1, content: entry.statement, type: memoryType(entry.kind),
        status: memoryStatus(entry), scope: { repository: scope },
        provenance: { sourceRunId: entry.sourceRunId, createdBy: 'import', ingestionMethod: 'grain-learning-ledger-v1' },
        confidence: entry.confidence, validation: entry.evidence.map(evidence => ({ ...evidence, timestamp: entry.updatedAt })),
        sensitivity: 'internal', tags: [...entry.tags, `learning-id:${entry.id}`], expiresAt: entry.expiresAt,
        supersedes: entry.supersedes }, { idempotencyKey: `grain-learning:${entry.id}` });
      report.imported.push(entry.id);
    } catch (error) { report.errors.push({ id: entry.id, error: error instanceof Error ? error.message : String(error) }); }
    report.finishedAt = new Date().toISOString(); durableWrite(path, report);
  }
  report.finishedAt = new Date().toISOString(); durableWrite(path, report);
  return report;
}
