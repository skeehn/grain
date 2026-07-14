import type { ToolResult } from '../providers/types.js';
import { WikiEngine, semanticSearch } from '../wiki/index.js';

export const wikiSearchTool = {
  name: 'wiki_search', description: 'Search the repository wiki. Fuses provenance-aware lexical ranking with engram semantic (meaning-based) recall when the memory server is running.',
  input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
};
export const wikiGetTool = {
  name: 'wiki_get', description: 'Get a repository wiki page by stable id.',
  input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
};
export const wikiProposeTool = {
  name: 'wiki_propose_update', description: 'Write a reviewable wiki update proposal without overwriting human-authored page content.',
  input_schema: { type: 'object', properties: { id: { type: 'string' }, content: { type: 'string' } }, required: ['id', 'content'] },
};

export async function executeWikiSearch(input: { query: string }): Promise<ToolResult> {
  try {
    const engine = new WikiEngine();
    const lexical = engine.search(input.query);
    const order: string[] = [];
    const seen = new Map<string, { title: string; status: string; path: string; how: string }>();
    for (const page of lexical) {
      if (!seen.has(page.id)) order.push(page.id);
      seen.set(page.id, { title: page.title, status: page.status, path: page.path, how: 'lexical' });
    }
    // Best-effort semantic recall via engram; never fails the lexical result.
    try {
      const hits = await semanticSearch(input.query, engine.projectKey());
      for (const hit of hits) {
        const existing = seen.get(hit.pageId);
        if (existing) { existing.how = 'lexical+semantic'; continue; }
        const page = engine.get(hit.pageId);
        if (!page) continue;
        order.push(hit.pageId);
        seen.set(hit.pageId, { title: page.title, status: page.status, path: page.path, how: 'semantic' });
      }
    } catch { /* engram down — lexical results stand */ }

    if (order.length === 0) return { content: 'No wiki results.' };
    const lines = order.map(id => {
      const p = seen.get(id)!;
      return `${id}\t${p.title}\t${p.status}\t${p.path}\t(${p.how})`;
    });
    return { content: lines.join('\n') };
  } catch (error: any) { return { content: `Wiki search failed: ${error.message}`, is_error: true }; }
}
export async function executeWikiGet(input: { id: string }): Promise<ToolResult> {
  try {
    const page = new WikiEngine().get(input.id);
    return page ? { content: `${page.body}\n\nSources:\n${page.sources.map(source => `${source.path}:${source.start_line}-${source.end_line} sha256:${source.hash}`).join('\n')}` }
      : { content: `Wiki page not found: ${input.id}`, is_error: true };
  } catch (error: any) { return { content: `Wiki read failed: ${error.message}`, is_error: true }; }
}
export async function executeWikiPropose(input: { id: string; content: string }): Promise<ToolResult> {
  try { return { content: `Created wiki proposal: ${new WikiEngine().propose(input.id, input.content)}` }; }
  catch (error: any) { return { content: `Wiki proposal failed: ${error.message}`, is_error: true }; }
}
