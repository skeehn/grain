import type { ToolResult } from '../providers/types.js';
import { getWorkspaceFS } from '../workspace/index.js';

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

export async function executePatch(input: { path: string; old_string: string; new_string: string; expected_hash?: string }): Promise<ToolResult> {
  try {
    const workspace = getWorkspaceFS();
    const read = workspace.readRange(input.path, 1, Number.MAX_SAFE_INTEGER);
    const filePath = workspace.resolve(input.path, true);
    let content = read.content;

    // Strategy 1: Exact match
    if (content.includes(input.old_string)) {
      const count = content.split(input.old_string).length - 1;
      if (count > 1) {
        return { content: `Found ${count} occurrences of old_string. Must be unique. Add more context.`, is_error: true };
      }
      content = content.replace(input.old_string, () => input.new_string);
      workspace.writeAtomic(input.path, content, input.expected_hash || read.hash);
      return { content: `Patched ${filePath}\n- ${input.old_string.split('\n').slice(0, 3).join('\n- ')}\n+ ${input.new_string.split('\n').slice(0, 3).join('\n+ ')}` };
    }

    // Strategy 2: Trimmed match
    const trimmedOld = input.old_string.trim();
    if (content.includes(trimmedOld)) {
      const count = content.split(trimmedOld).length - 1;
      if (count > 1) {
        return { content: `Found ${count} trimmed occurrences. Add more context.`, is_error: true };
      }
      content = content.replace(trimmedOld, () => input.new_string);
      workspace.writeAtomic(input.path, content, input.expected_hash || read.hash);
      return { content: `Patched ${filePath} (trimmed match)` };
    }

    // Strategy 3: Normalized whitespace match
    const normalizedOld = normalizeWhitespace(input.old_string);
    const lines = content.split('\n');
    let matchStart = -1;
    let matchEnd = -1;

    // Only windows near the old_string's own line count can match — an
    // unbounded scan is O(n^3) and hangs on large files.
    const oldLineCount = input.old_string.split('\n').length;
    const maxWindow = oldLineCount * 2 + 5;

    for (let i = 0; i < lines.length; i++) {
      for (let j = i + 1; j <= Math.min(i + maxWindow, lines.length); j++) {
        const chunk = lines.slice(i, j).join('\n');
        if (normalizeWhitespace(chunk) === normalizedOld) {
          matchStart = i;
          matchEnd = j;
          break;
        }
      }
      if (matchStart >= 0) break;
    }

    if (matchStart >= 0) {
      lines.splice(matchStart, matchEnd - matchStart, ...input.new_string.split('\n'));
      workspace.writeAtomic(input.path, lines.join('\n'), input.expected_hash || read.hash);
      return { content: `Patched ${filePath} (fuzzy whitespace match at lines ${matchStart + 1}-${matchEnd})` };
    }

    return { content: `Could not find old_string in ${filePath}. Verify the content matches exactly.`, is_error: true };
  } catch (err: any) {
    return { content: `Error patching file: ${err.message}`, is_error: true };
  }
}
