// `grain note`, `grain worklog`, `grain recall` — the durable work record from
// the command line. The TUI drives the same functions so both surfaces agree.
import { WorkLog, type WorkEntry } from '../docs/worklog.js';
import { indexWorkEntry, recall, engramReachable } from '../docs/index-bridge.js';
import { resolveWorkspace } from '../workspace/root.js';

function requireRoot(): string {
  const workspace = resolveWorkspace(process.cwd());
  if (!workspace.root) throw new Error('Open a project directory first — the work record lives in the repository.');
  return workspace.root;
}

export function formatEntry(entry: WorkEntry, options: { verbose?: boolean } = {}): string {
  const when = entry.timestamp.replace('T', ' ').slice(0, 16);
  const badge = entry.kind === 'note' ? 'note' : entry.outcome || 'task';
  const head = `${when}  ${badge.padEnd(9)} ${entry.title}`;
  if (!options.verbose) return head;
  const detail = [
    entry.files.length ? `    files: ${entry.files.join(', ')}` : '',
    entry.verification ? `    verified: ${entry.verification}` : '',
    entry.summary ? entry.summary.split('\n').map(line => `    ${line}`).join('\n') : '',
  ].filter(Boolean).join('\n');
  return detail ? `${head}\n${detail}` : head;
}

export async function addNote(text: string, tags: string[] = []): Promise<string> {
  const root = requireRoot();
  const { entry, path } = new WorkLog(root).note(text, tags);
  const indexed = await indexWorkEntry(entry, root);
  return `Noted in ${path}${indexed.ok ? ' · indexed for recall' : ' · engram offline, saved to file only'}`;
}

export function listWork(limit = 20, verbose = false): string {
  const entries = new WorkLog(requireRoot()).entries(limit);
  if (!entries.length) return 'No work recorded yet. Finish a task, or capture one with: grain note "…"';
  return entries.map(entry => formatEntry(entry, { verbose })).join(verbose ? '\n\n' : '\n');
}

/**
 * Search the work record.
 *
 * Prefers engram (meaning-based, and spans every repository); falls back to the
 * repository's own files so recall still works with the memory server down.
 */
export async function recallWork(query: string, options: { allRepos?: boolean; limit?: number } = {}): Promise<string> {
  const root = requireRoot();
  if (await engramReachable()) {
    const hits = await recall(query, {
      root: options.allRepos ? undefined : root,
      limit: options.limit ?? 15,
      kinds: ['worklog', 'note'],
    });
    if (hits.length) {
      return hits.map(hit => {
        const where = hit.root && hit.root !== root ? `  [${hit.root.split('/').pop()}]` : '';
        const first = hit.body.split('\n').find(Boolean) || hit.body;
        return `${hit.score.toFixed(2)}${where}  ${first.slice(0, 100)}`;
      }).join('\n');
    }
  }
  const local = new WorkLog(root).search(query, options.limit ?? 15);
  return local.length ? local.map(entry => formatEntry(entry)).join('\n') : `No work matching "${query}".`;
}

export async function handleWorkCommand(command: 'note' | 'worklog' | 'recall', args: string[] = []): Promise<void> {
  if (command === 'note') {
    const text = args.join(' ').trim();
    if (!text) throw new Error('Usage: grain note "what you want to remember"');
    console.log(await addNote(text));
    return;
  }
  if (command === 'worklog') {
    const verbose = args.includes('--verbose') || args.includes('-v');
    const limitArg = args.find(arg => /^\d+$/u.test(arg));
    console.log(listWork(limitArg ? Number(limitArg) : 20, verbose));
    return;
  }
  const allRepos = args.includes('--all');
  const query = args.filter(arg => arg !== '--all').join(' ').trim();
  if (!query) throw new Error('Usage: grain recall "what you are looking for" [--all]');
  console.log(await recallWork(query, { allRepos }));
}
