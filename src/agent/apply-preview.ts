import { getWorkspaceFS } from '../workspace/index.js';
import { diffFile } from '../workspace/diff.js';
import { applySearchReplace } from '../tools/patch.js';

export const WRITE_EDIT_TOOLS = new Set(['write', 'patch', 'multi_edit']);

export interface ApplyPreview {
  path: string;
  unified: string;
  added: number;
  removed: number;
  created: boolean;
  error?: string;
}

function isMissingPath(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const rec = error as { code?: unknown; message?: unknown };
  if (rec.code === 'ENOENT') return true;
  return typeof rec.message === 'string' && rec.message.startsWith('Path not found:');
}

function readExisting(path: string): { content: string; existed: boolean; error?: string } {
  try {
    return { content: getWorkspaceFS().readRange(path, 1, Number.MAX_SAFE_INTEGER).content, existed: true };
  } catch (error: unknown) {
    if (isMissingPath(error)) return { content: '', existed: false };
    const message = error instanceof Error ? error.message : String(error);
    return { content: '', existed: false, error: message };
  }
}

function previewContent(path: string, next: string): ApplyPreview {
  const { content, existed, error } = readExisting(path);
  if (error) return { path, unified: '', added: 0, removed: 0, created: false, error };
  const diff = diffFile(path, content, next);
  return {
    path,
    created: !existed,
    added: diff.added,
    removed: diff.removed,
    unified: diff.unified,
  };
}

export function previewToolEdit(name: string, input: any): ApplyPreview[] {
  if (!input || typeof input !== 'object') return [];
  if (name === 'write' && typeof input.path === 'string' && typeof input.content === 'string') {
    return [previewContent(input.path, input.content)];
  }
  if (name === 'patch' && typeof input.path === 'string') {
    const { content, existed, error } = readExisting(input.path);
    if (error) return [{ path: input.path, unified: '', added: 0, removed: 0, created: false, error }];
    if (!existed) return [{ path: input.path, unified: '', added: 0, removed: 0, created: false, error: `file not found: ${input.path}` }];
    const result = applySearchReplace(content, String(input.old_string ?? ''), String(input.new_string ?? ''));
    if (!result.ok) return [{ path: input.path, unified: '', added: 0, removed: 0, created: false, error: result.error }];
    return [previewContent(input.path, result.next)];
  }
  if (name === 'multi_edit' && Array.isArray(input.edits)) {
    const previews: ApplyPreview[] = [];
    for (const edit of input.edits) {
      if (!edit || typeof edit.path !== 'string' || typeof edit.new_content !== 'string') continue;
      const { existed, error } = readExisting(edit.path);
      if (error) {
        previews.push({ path: edit.path, unified: '', added: 0, removed: 0, created: false, error });
        continue;
      }
      if (!existed && !edit.create_if_missing) {
        previews.push({ path: edit.path, unified: '', added: 0, removed: 0, created: false, error: `file not found: ${edit.path}` });
        continue;
      }
      previews.push(previewContent(edit.path, edit.new_content));
    }
    return previews;
  }
  return [];
}

export function formatApplyPreview(previews: ApplyPreview[], limit = 160): string {
  if (!previews.length) return '';
  const blocks: string[] = [];
  let used = 0;
  for (const preview of previews) {
    if (preview.error) {
      blocks.push(`APPLY  ${preview.path}  error: ${preview.error}`);
      continue;
    }
    const action = preview.created ? 'create' : 'edit';
    const head = `APPLY  ${preview.path}  ${action}  +${preview.added} -${preview.removed}`;
    const body = preview.unified.trimEnd();
    const chunk = `${head}\n${body}`;
    const lines = chunk.split('\n');
    if (used + lines.length > limit) {
      blocks.push(`${head}\n(truncated)`);
      break;
    }
    blocks.push(chunk);
    used += lines.length;
  }
  return blocks.join('\n\n');
}
