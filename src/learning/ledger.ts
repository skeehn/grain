import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import type { LearningEntry, LearningEvent, LearningEvidence, LearningKind } from './types.js';

export class LearningLedger {
  readonly path: string;
  constructor(path = join(process.env.GRAIN_HOME || join(homedir(), '.grain'), 'learning', 'ledger.jsonl')) {
    this.path = path;
  }

  private append(event: LearningEvent): void {
    mkdirSync(dirname(this.path), { recursive: true });
    appendFileSync(this.path, `${JSON.stringify(event)}\n`, { mode: 0o600 });
  }

  list(): LearningEntry[] {
    const entries = new Map<string, LearningEntry>();
    if (!existsSync(this.path)) return [];
    for (const line of readFileSync(this.path, 'utf8').split('\n').filter(Boolean)) {
      const event = JSON.parse(line) as LearningEvent;
      if (event.type === 'proposed') entries.set(event.entry.id, structuredClone(event.entry));
      else {
        const entry = entries.get(event.id);
        if (!entry) throw new Error(`Learning event references unknown entry ${event.id}`);
        entry.updatedAt = new Date().toISOString();
        if (event.type === 'validated') {
          if (event.evidence.runId === entry.sourceRunId) throw new Error('Independent validation must use a different run');
          if (!entry.evidence.some(item => item.runId === event.evidence.runId)) entry.evidence.push(event.evidence);
          entry.status = 'validated';
          entry.confidence = Math.min(1, entry.confidence + (event.evidence.outcome === 'passed' ? 0.25 : -0.25));
        } else entry.status = event.type;
      }
    }
    return [...entries.values()];
  }

  propose(kind: LearningKind, statement: string, sourceRunId: string, tags: string[] = []): LearningEntry {
    if (!statement.trim()) throw new Error('Learning statement cannot be empty');
    const duplicate = this.list().find(entry => entry.statement.trim().toLowerCase() === statement.trim().toLowerCase()
      && !['rejected', 'stale', 'superseded'].includes(entry.status));
    if (duplicate) return duplicate;
    const now = new Date().toISOString();
    const entry: LearningEntry = { id: randomUUID(), kind, statement: statement.trim(), status: 'candidate',
      confidence: 0.5, createdAt: now, updatedAt: now, sourceRunId, evidence: [], tags };
    this.append({ type: 'proposed', entry });
    return entry;
  }

  validate(id: string, evidence: LearningEvidence): LearningEntry {
    const entry = this.list().find(item => item.id === id);
    if (!entry) throw new Error(`Unknown learning ${id}`);
    if (evidence.outcome !== 'passed') throw new Error('Failed evidence cannot validate a learning');
    if (evidence.runId === entry.sourceRunId) throw new Error('Independent validation must use a different run');
    this.append({ type: 'validated', id, evidence });
    return this.list().find(item => item.id === id)!;
  }

  promote(id: string): LearningEntry {
    const entry = this.list().find(item => item.id === id);
    if (!entry) throw new Error(`Unknown learning ${id}`);
    const independentPasses = new Set(entry.evidence.filter(e => e.outcome === 'passed' && e.runId !== entry.sourceRunId).map(e => e.runId));
    if (entry.status !== 'validated' || independentPasses.size < 1) throw new Error('Learning requires independent successful validation');
    this.append({ type: 'promoted', id });
    return this.list().find(item => item.id === id)!;
  }

  autoPromoteValidated(): LearningEntry[] {
    return this.list().filter(entry => entry.status === 'validated').map(entry => this.promote(entry.id));
  }
}
