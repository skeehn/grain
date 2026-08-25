/** Unified diffs for apply-preview. No extra deps; LCS is fine for ordinary source files. */

export interface DiffStats { added: number; removed: number }
export interface FileDiff extends DiffStats { unified: string }

type Edit = { kind: 'eq' | 'del' | 'ins'; line: string }

const MAX_DIFF_CELLS = 2_000_000;

function linesOf(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function diffEdits(a: string[], b: string[]): Edit[] {
  const n = a.length;
  const m = b.length;
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = 1; i <= n; i++) {
    const ai = a[i - 1];
    const row = dp[i];
    const prev = dp[i - 1];
    for (let j = 1; j <= m; j++) {
      row[j] = ai === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], row[j - 1]);
    }
  }
  const edits: Edit[] = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) { edits.push({ kind: 'eq', line: a[i - 1] }); i--; j--; }
    else if (dp[i - 1][j] >= dp[i][j - 1]) { edits.push({ kind: 'del', line: a[i - 1] }); i--; }
    else { edits.push({ kind: 'ins', line: b[j - 1] }); j--; }
  }
  while (i > 0) { edits.push({ kind: 'del', line: a[i - 1] }); i--; }
  while (j > 0) { edits.push({ kind: 'ins', line: b[j - 1] }); j--; }
  edits.reverse();
  return edits;
}

function countsOf(edits: Edit[]): DiffStats {
  let added = 0;
  let removed = 0;
  for (const edit of edits) {
    if (edit.kind === 'ins') added++;
    else if (edit.kind === 'del') removed++;
  }
  return { added, removed };
}

function formatUnified(path: string, edits: Edit[], context: number, maxHunkLines: number): string {
  const header = `--- ${path}\n+++ ${path}`;
  let oldLine = 1;
  let newLine = 1;
  const tagged = edits.map(edit => {
    const rec = { ...edit, oldStart: oldLine, newStart: newLine };
    if (edit.kind !== 'ins') oldLine++;
    if (edit.kind !== 'del') newLine++;
    return rec;
  });
  const changeAt = tagged.map((edit, index) => edit.kind === 'eq' ? -1 : index).filter(index => index >= 0);
  if (!changeAt.length) return `${header}\n`;
  const ranges: Array<{ start: number; end: number }> = [];
  for (const index of changeAt) {
    const start = Math.max(0, index - context);
    const end = Math.min(tagged.length, index + 1 + context);
    const last = ranges[ranges.length - 1];
    if (last && start <= last.end) last.end = Math.max(last.end, end);
    else ranges.push({ start, end });
  }
  const out = [header];
  let emitted = 0;
  for (const range of ranges) {
    const slice = tagged.slice(range.start, range.end);
    const oldStart = slice.find(edit => edit.kind !== 'ins')?.oldStart ?? slice[0].oldStart;
    const newStart = slice.find(edit => edit.kind !== 'del')?.newStart ?? slice[0].newStart;
    let oldCount = 0;
    let newCount = 0;
    const body: string[] = [];
    for (const edit of slice) {
      if (edit.kind === 'eq') { body.push(` ${edit.line}`); oldCount++; newCount++; }
      else if (edit.kind === 'del') { body.push(`-${edit.line}`); oldCount++; }
      else { body.push(`+${edit.line}`); newCount++; }
    }
    out.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`, ...body);
    emitted += body.length;
    if (emitted >= maxHunkLines) {
      out.push(`(truncated after ${maxHunkLines} changed lines)`);
      break;
    }
  }
  return `${out.join('\n')}\n`;
}

export function diffFile(path: string, before: string, after: string, context = 3, maxHunkLines = 240): FileDiff {
  const header = `--- ${path}\n+++ ${path}`;
  if (before === after) return { added: 0, removed: 0, unified: `${header}\n` };
  const a = linesOf(before);
  const b = linesOf(after);
  if (a.length * b.length > MAX_DIFF_CELLS) {
    return { added: b.length, removed: a.length, unified: `${header}\n@@ rewrite @@\n-${a.length} lines\n+${b.length} lines\n` };
  }
  const edits = diffEdits(a, b);
  return { ...countsOf(edits), unified: formatUnified(path, edits, context, maxHunkLines) };
}

export function diffStats(before: string, after: string): DiffStats {
  const { added, removed } = diffFile('', before, after);
  return { added, removed };
}

export function unifiedDiff(path: string, before: string, after: string, context = 3, maxHunkLines = 240): string {
  return diffFile(path, before, after, context, maxHunkLines).unified;
}
