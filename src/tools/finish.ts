import { execSync, execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { resolve } from 'path';
import type { ToolResult } from '../providers/types.js';
import { executeEngram } from './engram.js';

export const finishTool = {
  name: 'finish',
  description: 'Signal that the current task is complete. Optionally provide learnings to store in engram. Pass commit=true to auto-commit all changes with a descriptive message.',
  input_schema: {
    type: 'object',
    properties: {
      result:    { type: 'string', description: 'Summary of what was accomplished' },
      learnings: { type: 'array', items: { type: 'string' }, description: 'Facts learned during this task to store in engram' },
      commit:    { type: 'boolean', description: 'Auto-commit all staged+unstaged changes via git (default: false)' },
      commit_msg:{ type: 'string', description: 'Custom commit message (default: "grain: <result>")' },
    },
    required: ['result'],
  },
};

export async function executeFinish(
  input: { result: string; learnings?: string[]; commit?: boolean; commit_msg?: string },
  cwd?: string,
): Promise<ToolResult> {
  const workdir = cwd || process.cwd();
  const notes: string[] = [];

  // Store learnings in engram
  if (input.learnings && input.learnings.length > 0) {
    for (const learning of input.learnings) {
      try {
        await executeEngram({ action: 'add', body: learning, tags: ['auto-learned'] });
      } catch {}
    }
  }

  // Auto-commit if requested and inside a git repo
  if (input.commit) {
    const gitDir = resolve(workdir, '.git');
    const isGitRepo = existsSync(gitDir) ||
      (() => { try { execSync('git rev-parse --git-dir', { cwd: workdir, stdio: 'pipe' }); return true; } catch { return false; } })();

    if (isGitRepo) {
      try {
        // Check if there's anything to commit
        const status = execSync('git status --porcelain', { cwd: workdir, encoding: 'utf-8' }).trim();
        if (status) {
          execSync('git add -A', { cwd: workdir, stdio: 'pipe' });
          const msg = input.commit_msg || `grain: ${input.result.slice(0, 72)}`;
          execFileSync('git', ['commit', '-m', msg], { cwd: workdir, stdio: 'pipe' });
          const hash = execSync('git rev-parse --short HEAD', { cwd: workdir, encoding: 'utf-8' }).trim();
          notes.push(`committed ${hash}`);
        } else {
          notes.push('nothing to commit');
        }
      } catch (err: any) {
        notes.push(`git commit failed: ${err.message?.split('\n')[0]}`);
      }
    } else {
      notes.push('not a git repo — skipping commit');
    }
  }

  const suffix = notes.length ? ` (${notes.join(', ')})` : '';
  return { content: `TASK_COMPLETE: ${input.result}${suffix}` };
}
