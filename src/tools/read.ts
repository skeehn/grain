import type { ToolResult } from '../providers/types.js';
import { getWorkspaceFS } from '../workspace/index.js';

export const readTool = {
  name: 'read',
  description: 'Read a file with line numbers. Returns content in "LINE_NUM|CONTENT" format.',
  input_schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the file to read' },
      offset: { type: 'number', description: 'Line number to start from (1-indexed, default: 1)' },
      limit: { type: 'number', description: 'Maximum lines to read (default: 500)' },
    },
    required: ['path'],
  },
};

export async function executeRead(input: { path: string; offset?: number; limit?: number }): Promise<ToolResult> {
  const offset = Math.max(1, input.offset || 1);
  const limit = input.limit || 500;

  try {
    const read = getWorkspaceFS().readRange(input.path, offset, limit);
    const result = read.content.split('\n').map((line, index) => `${read.start_line + index}|${line}`).join('\n')
      + (read.end_line < read.total_lines ? `\n... (${read.total_lines - read.end_line} more lines)` : '')
      + `\n[sha256:${read.hash}]`;
    return { content: result };
  } catch (err: any) {
    return { content: `Error reading file: ${err.message}`, is_error: true };
  }
}
