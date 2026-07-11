// Multi-file edit tool - atomic changes across multiple files
import type { ToolResult } from '../providers/types.js';
import { getWorkspaceFS } from '../workspace/index.js';
import { WorkspaceTransactionManager } from '../workspace/index.js';
import { randomUUID } from 'node:crypto';

export const multiEditTool = {
  name: 'multi_edit',
  description: 'Apply atomic changes across multiple files. All changes succeed or all fail (rollback on error). Shows unified diff preview.',
  input_schema: {
    type: 'object',
    properties: {
      edits: {
        type: 'array',
        description: 'Array of file edits to apply',
        items: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path' },
            old_content: { type: 'string', description: 'Content to replace (optional for new files)' },
            new_content: { type: 'string', description: 'New content' },
            create_if_missing: { type: 'boolean', description: 'Create file if it doesn\'t exist', default: false },
          },
          required: ['path', 'new_content'],
        },
      },
      preview: { type: 'boolean', description: 'Preview changes without applying', default: false },
    },
    required: ['edits'],
  },
};

interface Edit {
  path: string;
  old_content?: string;
  new_content: string;
  create_if_missing?: boolean;
}

interface Backup {
  path: string;
  content: string;
  existed: boolean;
}

function generateDiff(path: string, oldContent: string, newContent: string): string {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  
  let diff = `\n--- ${path}\n+++ ${path}\n`;
  
  // Simple line-by-line diff
  const maxLen = Math.max(oldLines.length, newLines.length);
  let contextLines = 0;
  
  for (let i = 0; i < maxLen; i++) {
    const oldLine = oldLines[i];
    const newLine = newLines[i];
    
    if (oldLine !== newLine) {
      if (contextLines > 0) {
        diff += `@@ -${i - contextLines + 1},${contextLines} +${i - contextLines + 1},${contextLines} @@\n`;
        contextLines = 0;
      }
      
      if (oldLine !== undefined) {
        diff += `-${oldLine}\n`;
      }
      if (newLine !== undefined) {
        diff += `+${newLine}\n`;
      }
    } else if (contextLines < 3) {
      contextLines++;
      if (oldLine !== undefined) {
        diff += ` ${oldLine}\n`;
      }
    }
  }
  
  return diff;
}

export async function executeMultiEdit(input: { edits: Edit[]; preview?: boolean }): Promise<ToolResult> {
  const edits = input.edits;
  const preview = input.preview || false;
  
  if (!edits || edits.length === 0) {
    return { content: 'No edits provided', is_error: true };
  }
  
  // Validate all edits first
  const workspace = getWorkspaceFS();
  const backups: Backup[] = [];
  const diffs: string[] = [];
  
  for (const edit of edits) {
    const filePath = workspace.resolve(edit.path);
    
    try {
      let oldContent = '';
      let existed = true;
      
      try {
        oldContent = workspace.readRange(edit.path, 1, Number.MAX_SAFE_INTEGER).content;
      } catch (err) {
        existed = false;
        if (!edit.create_if_missing) {
          return {
            content: `File not found and create_if_missing=false: ${edit.path}`,
            is_error: true,
          };
        }
      }
      
      // If old_content specified, validate it matches
      if (edit.old_content !== undefined && existed) {
        if (oldContent.trim() !== edit.old_content.trim()) {
          return {
            content: `File content mismatch for ${edit.path} - file may have been modified`,
            is_error: true,
          };
        }
      }
      
      backups.push({ path: filePath, content: oldContent, existed });
      
      // Generate diff
      const diff = generateDiff(edit.path, oldContent, edit.new_content);
      diffs.push(diff);
    } catch (err: any) {
      return {
        content: `Validation failed for ${edit.path}: ${err.message}`,
        is_error: true,
      };
    }
  }
  
  // Preview mode - show diffs and return
  if (preview) {
    let output = `📋 Multi-file edit preview (${edits.length} files):\n`;
    output += diffs.join('\n');
    output += `\n\nTo apply, call multi_edit again with preview=false`;
    return { content: output };
  }
  
  try {
    const manager = new WorkspaceTransactionManager(workspace);
    const transaction = manager.begin({ invocationId: randomUUID(),
      expectedInputs: backups.filter(backup => backup.existed).map(backup => ({ path: edits[backups.indexOf(backup)].path, content_hash: workspace.stat(edits[backups.indexOf(backup)].path).content_hash })),
      operations: edits.map(edit => ({ type: 'write' as const, path: edit.path, content: edit.new_content })) });
    manager.approve(transaction.id); manager.apply(transaction.id);
    
    let output = `✓ Applied changes to ${edits.length} file${edits.length > 1 ? 's' : ''}:\n`;
    for (const edit of edits) {
      const existed = backups.find(b => b.path === workspace.resolve(edit.path))?.existed;
      const action = existed ? 'Modified' : 'Created';
      output += `  ${action}: ${edit.path}\n`;
    }
    
    return { content: `${output}transaction:${transaction.id}` };
  } catch (err: any) {
    return {
      content: `Multi-edit failed, rolled back: ${err.message}`,
      is_error: true,
    };
  }
}
