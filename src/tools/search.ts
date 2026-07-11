import type { ToolResult } from '../providers/types.js';
import { getWorkspaceFS } from '../workspace/index.js';

export const searchTool = { name: 'search', description: 'Search workspace text with deterministic paths, line numbers, limits, and evidence.', input_schema: {
  type: 'object', properties: { query: { type: 'string' }, path: { type: 'string' }, limit: { type: 'number' } }, required: ['query'],
} };
export async function executeSearch(input: { query: string; path?: string; limit?: number }): Promise<ToolResult> {
  try { const matches = getWorkspaceFS().search(input.query, input.path, input.limit); return { content: matches.map(match => `${match.path}:${match.line}:${match.text}`).join('\n') || 'No matches.' }; }
  catch (error: any) { return { content: `Search failed: ${error.message}`, is_error: true }; }
}
