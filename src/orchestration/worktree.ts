import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';
import { createHash } from 'crypto';

export interface WorktreeTransaction {
  graphId: string;
  taskId: string;
  repositoryRoot: string;
  worktreePath: string;
  branch: string;
  baseCommit: string;
  patchPath: string;
  state: 'prepared' | 'captured' | 'verified' | 'merged' | 'needs_reconciliation';
  patchHash?: string;
  error?: string;
}

function safeId(value: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error('Worktree IDs may contain only letters, numbers, underscore, and hyphen');
  return value;
}

function git(root: string, args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function transactionRoot(): string { return join(process.env.GRAIN_HOME || join(homedir(), '.grain'), 'worktrees'); }

export class WorktreeManager {
  save(transaction: WorktreeTransaction): string {
    const path = join(transactionRoot(), transaction.graphId, `${transaction.taskId}.json`);
    mkdirSync(resolve(path, '..'), { recursive: true }); writeFileSync(path, `${JSON.stringify(transaction, null, 2)}\n`, { mode: 0o600 }); return path;
  }
  load(graphId: string, taskId: string): WorktreeTransaction {
    return JSON.parse(readFileSync(join(transactionRoot(), safeId(graphId), `${safeId(taskId)}.json`), 'utf8')) as WorktreeTransaction;
  }
  prepare(repositoryRoot: string, graphId: string, taskId: string): WorktreeTransaction {
    const root = realpathSync(resolve(repositoryRoot)); const graph = safeId(graphId); const task = safeId(taskId);
    const actualRoot = git(root, ['rev-parse', '--show-toplevel']);
    if (realpathSync(resolve(actualRoot)) !== root) throw new Error(`Repository root must be the Git top level: ${actualRoot}`);
    const baseCommit = git(root, ['rev-parse', 'HEAD']);
    const worktreePath = join(transactionRoot(), graph, task); const branch = `grain/${graph}/${task}`;
    if (existsSync(worktreePath)) throw new Error(`Worktree path already exists: ${worktreePath}`);
    mkdirSync(resolve(worktreePath, '..'), { recursive: true });
    git(root, ['worktree', 'add', '-b', branch, worktreePath, baseCommit]);
    const transaction: WorktreeTransaction = { graphId: graph, taskId: task, repositoryRoot: root, worktreePath, branch, baseCommit,
      patchPath: join(transactionRoot(), graph, `${task}.patch`), state: 'prepared' };
    this.save(transaction); return transaction;
  }

  capture(transaction: WorktreeTransaction): WorktreeTransaction {
    const untracked = git(transaction.worktreePath, ['ls-files', '--others', '--exclude-standard']).split('\n').filter(Boolean);
    if (untracked.length) execFileSync('git', ['add', '--intent-to-add', '--', ...untracked],
      { cwd: transaction.worktreePath, stdio: ['ignore', 'pipe', 'pipe'] });
    const patch = execFileSync('git', ['diff', '--binary', '--no-ext-diff', transaction.baseCommit],
      { cwd: transaction.worktreePath, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (!patch.trim()) throw new Error('Worktree produced no patch');
    mkdirSync(resolve(transaction.patchPath, '..'), { recursive: true });
    writeFileSync(transaction.patchPath, patch, { mode: 0o600 });
    transaction.patchHash = createHash('sha256').update(patch).digest('hex'); transaction.state = 'captured'; this.save(transaction); return transaction;
  }

  verify(transaction: WorktreeTransaction, command: string, args: string[] = []): WorktreeTransaction {
    if (transaction.state !== 'captured') throw new Error('Capture the patch before verification');
    execFileSync(command, args, { cwd: transaction.worktreePath, stdio: 'pipe' }); transaction.state = 'verified'; this.save(transaction); return transaction;
  }

  merge(transaction: WorktreeTransaction): WorktreeTransaction {
    if (transaction.state !== 'verified') throw new Error('Only verified worktree patches may merge');
    const patch = readFileSync(transaction.patchPath);
    const current = createHash('sha256').update(patch).digest('hex');
    if (current !== transaction.patchHash) throw new Error('Captured patch hash changed after verification');
    try {
      execFileSync('git', ['apply', '--check', '--binary', transaction.patchPath], { cwd: transaction.repositoryRoot, stdio: 'pipe' });
      execFileSync('git', ['apply', '--binary', transaction.patchPath], { cwd: transaction.repositoryRoot, stdio: 'pipe' });
      transaction.state = 'merged';
    } catch (error: any) {
      transaction.state = 'needs_reconciliation'; transaction.error = String(error?.stderr || error?.message || error);
    }
    this.save(transaction); return transaction;
  }
}
