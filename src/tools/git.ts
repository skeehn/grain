import { execSync, execFileSync } from 'child_process';
import type { ToolResult } from '../providers/types.js';

export const gitTool = {
  name: 'git',
  description: 'Git operations: check status, create commits, rollback changes. Use this for version control operations.',
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['status', 'commit', 'rollback'],
        description: 'Git action to perform: status (show changes), commit (create checkpoint), rollback (revert to ref)',
      },
      message: {
        type: 'string',
        description: 'Commit message (required for commit action)',
      },
      ref: {
        type: 'string',
        description: 'Git ref to rollback to (commit hash, branch, or HEAD~N). Required for rollback action.',
      },
    },
    required: ['action'],
  },
};

export async function executeGit(input: { action: string; message?: string; ref?: string }): Promise<ToolResult> {
  try {
    const { action, message, ref } = input;

    if (action === 'status') {
      // Show git status
      const status = execSync('git status --short', { encoding: 'utf-8', maxBuffer: 1024 * 1024 });
      const branch = execSync('git branch --show-current', { encoding: 'utf-8' }).trim();
      const lastCommit = execSync('git log -1 --oneline', { encoding: 'utf-8' }).trim();
      
      return {
        content: `📊 Git Status:\n\n${branch}\n\n${status || '✓ Working tree clean - no changes'}\n\nLast commit: ${lastCommit}`,
      };
    }

    if (action === 'commit') {
      if (!message) {
        return {
          content: 'Error: message is required for commit action',
          is_error: true,
        };
      }

      // Stage all changes and commit
      execSync('git add -A', { stdio: 'pipe' });
      const commitOutput = execFileSync('git', ['commit', '-m', message], {
        encoding: 'utf-8',
        stdio: 'pipe',
      });

      return {
        content: `✓ Committed changes:\n\n${commitOutput}`,
      };
    }

    if (action === 'rollback') {
      if (!ref) {
        return {
          content: 'Error: ref is required for rollback action (e.g., "HEAD~1", commit hash, or branch name)',
          is_error: true,
        };
      }

      // Hard reset to ref
      const resetOutput = execFileSync('git', ['reset', '--hard', ref], {
        encoding: 'utf-8',
        stdio: 'pipe',
      });

      return {
        content: `✓ Rolled back to ${ref}:\n\n${resetOutput}`,
      };
    }

    return {
      content: `Error: Unknown git action: ${action}. Valid actions: status, commit, rollback`,
      is_error: true,
    };
  } catch (err: any) {
    if (err.message?.includes('not a git repository')) {
      return {
        content: 'Not a git repository. Initialize with `git init` first.',
        is_error: true,
      };
    }
    return {
      content: `Git operation failed: ${err.message}`,
      is_error: true,
    };
  }
}
