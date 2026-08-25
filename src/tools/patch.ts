import type { ToolResult } from '../providers/types.js';
import { getWorkspaceFS } from '../workspace/index.js';
import { WorkspaceTransactionManager } from '../workspace/index.js';
import { unifiedDiff } from '../workspace/diff.js';
import { randomUUID } from 'node:crypto';

export const patchTool = {
  name: 'patch',
  description: 'Find and replace text in a file. Uses fuzzy matching (exact first, then trimmed, then normalized whitespace).',
  input_schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the file to patch' },
      old_string: { type: 'string', description: 'Text to find (must be unique in file)' },
      new_string: { type: 'string', description: 'Replacement text' },
      expected_hash: { type: 'string', description: 'Optional sha256 from read; patch fails if the file changed' },
    },
    required: ['path', 'old_string', 'new_string'],
  },
};

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

export function applySearchReplace(
  content: string,
  oldString: string,
  newString: string,
): { ok: true; next: string; how: 'exact' | 'trimmed' | 'fuzzy' } | { ok: false; error: string } {
  if (content.includes(oldString)) {
    const count = content.split(oldString).length - 1;
    if (count > 1) return { ok: false, error: `Found ${count} occurrences of old_string. Must be unique. Add more context.` };
    return { ok: true, next: content.replace(oldString, () => newString), how: 'exact' };
  }
  const trimmedOld = oldString.trim();
  if (trimmedOld && content.includes(trimmedOld)) {
    const count = content.split(trimmedOld).length - 1;
    if (count > 1) return { ok: false, error: `Found ${count} trimmed occurrences. Add more context.` };
    return { ok: true, next: content.replace(trimmedOld, () => newString), how: 'trimmed' };
  }
  const normalizedOld = normalizeWhitespace(oldString);
  const lines = content.split('\n');
  let matchStart = -1;
  let matchEnd = -1;
  let matches = 0;
  const oldLineCount = oldString.split('\n').length;
  const maxWindow = oldLineCount * 2 + 5;
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j <= Math.min(i + maxWindow, lines.length); j++) {
      const chunk = lines.slice(i, j).join('\n');
      if (normalizeWhitespace(chunk) === normalizedOld) {
        matches++;
        if (matchStart < 0) { matchStart = i; matchEnd = j; }
        break;
      }
    }
    if (matches > 1) break;
  }
  if (matches > 1) return { ok: false, error: `Found ${matches} normalized-whitespace occurrences. Add more context.` };
  if (matchStart >= 0) {
    lines.splice(matchStart, matchEnd - matchStart, ...newString.split('\n'));
    return { ok: true, next: lines.join('\n'), how: 'fuzzy' };
  }
  return { ok: false, error: 'Could not find old_string. Verify the content matches exactly.' };
}

export async function executePatch(input: { path: string; old_string: string; new_string: string; expected_hash?: string }): Promise<ToolResult> {
  try {
    const workspace = getWorkspaceFS();
    const read = workspace.readRange(input.path, 1, Number.MAX_SAFE_INTEGER);
    const filePath = workspace.resolve(input.path, true);
    const applied = applySearchReplace(read.content, input.old_string, input.new_string);
    if (!applied.ok) return { content: applied.error, is_error: true };
    const manager = new WorkspaceTransactionManager(workspace);
    const transaction = manager.begin({ invocationId: randomUUID(),
      expectedInputs: [{ path: input.path, content_hash: input.expected_hash || read.hash }],
      operations: [{ type: 'write', path: input.path, content: applied.next }] });
    manager.approve(transaction.id); manager.apply(transaction.id);
    const diff = unifiedDiff(input.path, read.content, applied.next).trimEnd();
    return { content: `Patched ${filePath} (${applied.how})\n${diff}\ntransaction:${transaction.id}` };
  } catch (err: any) {
    return { content: `Error patching file: ${err.message}`, is_error: true };
  }
}
