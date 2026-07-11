import type { ToolResult } from '../providers/types.js';
import { getWorkspaceFS } from '../workspace/index.js';

export const inspectTool = { name: 'inspect', description: 'Inspect a file range, file metadata, or repository tree with hashes and evidence.', input_schema: {
  type: 'object', properties: { kind: { type: 'string', enum: ['file', 'stat', 'tree'] }, path: { type: 'string' }, offset: { type: 'number' }, limit: { type: 'number' }, depth: { type: 'number' } }, required: ['kind'],
} };

export async function executeInspect(input: { kind: 'file' | 'stat' | 'tree'; path?: string; offset?: number; limit?: number; depth?: number }): Promise<ToolResult> {
  try {
    const fs = getWorkspaceFS(); const path = input.path || '.';
    if (input.kind === 'stat') return { content: JSON.stringify(fs.stat(path), null, 2) };
    if (input.kind === 'tree') return { content: fs.list(path, input.depth ?? 4).slice(0, input.limit ?? 500).join('\n') };
    const result = fs.readRange(path, input.offset, input.limit); return { content: `${result.content}\n\n[${result.path}:${result.start_line}-${result.end_line} sha256:${result.hash}]` };
  } catch (error: any) { return { content: `Inspect failed: ${error.message}`, is_error: true }; }
}
