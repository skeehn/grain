import type { ToolResult } from '../providers/types.js';
import { getWorkspaceFS } from '../workspace/index.js';

export const grepTool = {
  name: 'grep',
  description: 'Search file contents using ripgrep. Returns matches with file:line:content format.',
  input_schema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Regex pattern to search for' },
      path: { type: 'string', description: 'Directory or file to search in (default: current directory)' },
      file_glob: { type: 'string', description: 'Filter files by glob pattern (e.g., "*.ts")' },
    },
    required: ['pattern'],
  },
};

export async function executeGrep(input: { pattern: string; path?: string; file_glob?: string }): Promise<ToolResult> {
  try {
    let matches = getWorkspaceFS().search(input.pattern, input.path || '.', 500);
    if (input.file_glob) {
      const suffix = input.file_glob.replace(/^\*/, '');
      matches = matches.filter(match => match.path.endsWith(suffix));
    }
    return { content: matches.length ? matches.map(match => `${match.path}:${match.line}:${match.text}`).join('\n') : 'No matches found.' };
  } catch (error: any) {
    return { content: `Search failed: ${error.message}`, is_error: true };
  }
}
