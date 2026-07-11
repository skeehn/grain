import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { FileSnapshot, ReconciliationReport, TransactionRequest, TransactionResult, WorkspaceTransaction } from './types.js';
import { LocalWorkspaceFS } from './filesystem.js';

const grainHome = () => process.env.GRAIN_HOME || join(homedir(), '.grain');

export class WorkspaceTransactionManager {
  constructor(private readonly fs: LocalWorkspaceFS) {}
  private path(id: string): string { return join(grainHome(), 'transactions', `${id}.json`); }
  private save(transaction: WorkspaceTransaction): void {
    const path = this.path(transaction.id); mkdirSync(dirname(path), { recursive: true });
    transaction.updatedAt = new Date().toISOString(); const temp = `${path}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify(transaction, null, 2)}\n`, { mode: 0o600 }); renameSync(temp, path);
  }
  load(id: string): WorkspaceTransaction {
    const path = this.path(id); if (!existsSync(path)) throw new Error(`Unknown workspace transaction ${id}`);
    return JSON.parse(readFileSync(path, 'utf8')) as WorkspaceTransaction;
  }
  begin(request: TransactionRequest): WorkspaceTransaction {
    if (!request.operations.length) throw new Error('Workspace transaction requires at least one operation');
    const affected = new Set<string>();
    for (const operation of request.operations) {
      if (operation.type === 'move') { affected.add(operation.from); affected.add(operation.to); }
      else affected.add(operation.path);
    }
    const snapshots = [...affected].map(path => this.fs.snapshot(path));
    for (const expected of request.expectedInputs || []) {
      const current = snapshots.find(item => item.path === expected.path) || this.fs.snapshot(expected.path);
      if (expected.must_exist && !current.existed) throw new Error(`Transaction precondition failed; missing ${expected.path}`);
      if (expected.content_hash && current.content_hash !== expected.content_hash) throw new Error(`Transaction precondition failed; changed ${expected.path}`);
    }
    const now = new Date().toISOString();
    const transaction: WorkspaceTransaction = { id: randomUUID(), invocationId: request.invocationId,
      expectedInputs: request.expectedInputs || [], affectedPaths: [...affected].sort(), snapshots,
      operations: request.operations, state: 'prepared', createdAt: now, updatedAt: now };
    this.save(transaction); return transaction;
  }
  approve(id: string): WorkspaceTransaction { const transaction = this.load(id); if (transaction.state !== 'prepared') throw new Error(`Cannot approve transaction in ${transaction.state}`); transaction.state = 'approved'; this.save(transaction); return transaction; }
  apply(id: string): TransactionResult {
    const transaction = this.load(id); if (transaction.state !== 'approved') throw new Error(`Cannot apply transaction in ${transaction.state}`);
    transaction.state = 'applying'; this.save(transaction); const changed: FileSnapshot[] = [];
    try {
      for (const operation of transaction.operations) {
        if (operation.type === 'write') changed.push(this.fs.writeAtomic(operation.path, operation.content,
          transaction.expectedInputs.find(item => item.path === operation.path)?.content_hash));
        else if (operation.type === 'remove') { this.fs.remove(operation.path); changed.push(this.fs.snapshot(operation.path)); }
        else if (operation.type === 'move') { this.fs.move(operation.from, operation.to); changed.push(this.fs.snapshot(operation.to)); }
        else { this.fs.mkdir(operation.path); changed.push(this.fs.snapshot(operation.path)); }
      }
      transaction.state = 'committed'; this.save(transaction); return { transaction, changed };
    } catch (error: any) {
      transaction.error = String(error?.message || error);
      try { this.restore(transaction); transaction.state = 'rolled_back'; }
      catch (rollback: any) { transaction.state = 'needs_reconciliation'; transaction.error += `; rollback failed: ${rollback?.message || rollback}`; }
      this.save(transaction); throw new Error(`Workspace transaction ${transaction.state}: ${transaction.error}`);
    }
  }
  rollback(id: string): TransactionResult { const transaction = this.load(id); if (transaction.state === 'committed') throw new Error('Committed transactions require an explicit compensating transaction'); this.restore(transaction); transaction.state = 'rolled_back'; this.save(transaction); return { transaction, changed: transaction.snapshots }; }
  private restore(transaction: WorkspaceTransaction): void {
    for (const snapshot of [...transaction.snapshots].reverse()) {
      const current = this.fs.snapshot(snapshot.path);
      if (!snapshot.existed) { if (current.existed) this.fs.remove(snapshot.path); continue; }
      if (!snapshot.content_hash) continue;
      this.fs.restoreSnapshot(snapshot, current.content_hash);
    }
  }
  reconcile(id: string): ReconciliationReport {
    const transaction = this.load(id);
    return { transaction, observations: transaction.affectedPaths.map(path => ({ path, current: this.fs.snapshot(path), expected: transaction.expectedInputs.find(item => item.path === path) })) };
  }
}
