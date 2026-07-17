import type { ExecutableTool, ToolResult } from '../providers/types.js';
import { codeSearch, codeDef, codeRefs, buildIndex } from './code-index.js';

export const codeSearchTool: ExecutableTool = {
  name: 'code_search',
  description: [
    'Find code by meaning or symbol across the whole repo — faster and more relevant than grep for "where is X handled".',
    "mode 'search' (default): ranked results for a natural query.",
    "mode 'def': definitions of an exact symbol name.",
    "mode 'refs': references to an exact symbol name.",
  ].join(' '),
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Natural-language query (search) or exact symbol name (def/refs)' },
      mode: { type: 'string', enum: ['search', 'def', 'refs'], description: "Default 'search'" },
      limit: { type: 'number', description: 'Max results (default 12)' },
    },
    required: ['query'],
  },
  async execute(input: { query: string; mode?: 'search' | 'def' | 'refs'; limit?: number }): Promise<ToolResult> {
    const query = String(input.query || '').trim();
    if (!query) return { content: 'code_search requires a query.', is_error: true };
    const limit = input.limit && input.limit > 0 ? input.limit : 12;

    if (input.mode === 'def') {
      const defs = codeDef(query);
      if (!defs.length) return { content: `No definition found for "${query}".` };
      return { content: defs.map(d => `${d.file}:${d.line}  ${d.kind} ${d.name}`).join('\n') };
    }
    if (input.mode === 'refs') {
      const refs = codeRefs(query, limit);
      if (!refs.length) return { content: `No references found for "${query}".` };
      return { content: refs.map(r => `${r.file}:${r.line}  ${r.text}`).join('\n') };
    }

    const hits = codeSearch(query, limit);
    if (!hits.length) return { content: `No code matched "${query}". Try grep for an exact string.` };
    return { content: hits.map(h => `${h.file}:${h.line}${h.kind ? ` (${h.kind})` : ''}  ${h.text}`).join('\n') };
  },
};

/** Force a full (re)index — exposed for tests and warmup. */
export function warmCodeIndex(): number { return buildIndex(); }
