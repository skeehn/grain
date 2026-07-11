import type { ToolResult } from '../providers/types.js';
import { WikiEngine } from '../wiki/index.js';

export const wikiSearchTool = {
  name: 'wiki_search', description: 'Search the repository wiki with provenance-aware lexical ranking.',
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
    const pages = new WikiEngine().search(input.query);
    return { content: pages.length ? pages.map(page => `${page.id}\t${page.title}\t${page.status}\t${page.path}`).join('\n') : 'No wiki results.' };
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
