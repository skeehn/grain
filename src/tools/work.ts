// Tools that let the agent read and extend the durable work record.
//
// Without these the memory is write-only from the agent's perspective: Grain
// records what happened, but the model can never ask "have I dealt with this
// before?" — which is the whole point of keeping the record.
import type { ToolResult } from '../providers/types.js';
import { WorkLog } from '../docs/worklog.js';
import { indexWorkEntry, recall, engramReachable } from '../docs/index-bridge.js';
import { resolveWorkspace } from '../workspace/root.js';

function root(): string {
  const workspace = resolveWorkspace(process.cwd());
  if (!workspace.root) throw new Error('No project is open; the work record lives in a repository.');
  return workspace.root;
}

export const workRecallTool = {
  name: 'work_recall',
  description: 'Search the durable work record — past tasks, their outcomes, the files they touched, and hand-written notes. '
    + 'Use before starting work that may have been done before, or when the user refers to earlier work. '
    + 'Set all_repos to search every repository, not just this one.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'What to look for' },
      all_repos: { type: 'boolean', description: 'Search across every repository (default false)' },
    },
    required: ['query'],
  },
};

export const workNoteTool = {
  name: 'work_note',
  description: 'Record a durable note in the repository work record. Use for decisions, constraints, gotchas, and context '
    + 'worth keeping beyond this session. Notes are written to docs/grain/notes/ and indexed for later recall.',
  input_schema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'The note. Be specific and self-contained.' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags' },
    },
    required: ['text'],
  },
};

export async function executeWorkRecall(input: { query: string; all_repos?: boolean }): Promise<ToolResult> {
  try {
    const workspaceRoot = root();
    if (await engramReachable()) {
      const hits = await recall(input.query, {
        root: input.all_repos ? undefined : workspaceRoot, limit: 12, kinds: ['worklog', 'note'],
      });
      if (hits.length) {
        return { content: hits.map(hit => {
          const where = hit.root && hit.root !== workspaceRoot ? ` [${hit.root}]` : '';
          return `- ${hit.body.split('\n').filter(Boolean).slice(0, 3).join(' · ').slice(0, 300)}${where}`;
        }).join('\n') };
      }
    }
    const local = new WorkLog(workspaceRoot).search(input.query, 12);
    return { content: local.length
      ? local.map(entry => `- ${entry.timestamp.slice(0, 16)} ${entry.title}${entry.files.length ? ` (${entry.files.join(', ')})` : ''}`).join('\n')
      : `No prior work matching "${input.query}".` };
  } catch (error: any) { return { content: `work_recall failed: ${error.message}`, is_error: true }; }
}

export async function executeWorkNote(input: { text: string; tags?: string[] }): Promise<ToolResult> {
  try {
    if (!input.text?.trim()) return { content: 'work_note requires text.', is_error: true };
    const workspaceRoot = root();
    const { entry, path } = new WorkLog(workspaceRoot).note(input.text, input.tags || []);
    const indexed = await indexWorkEntry(entry, workspaceRoot);
    return { content: `Noted in ${path}${indexed.ok ? ' and indexed for recall.' : ' (engram offline; saved to file).'}` };
  } catch (error: any) { return { content: `work_note failed: ${error.message}`, is_error: true }; }
}
