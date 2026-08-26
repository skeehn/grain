import type { Cell, CellStyle, TuiFrame } from './types.js';

const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : undefined;
const graphemes = (value: string): string[] => segmenter ? [...segmenter.segment(value)].map(item => item.segment) : [...value];

export function graphemeWidth(value: string): number {
  if (!value || /^\p{Mark}+$/u.test(value)) return 0;
  return /[\u1100-\u115f\u2329\u232a\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/u.test(value) ? 2 : 1;
}

export function blankFrame(width: number, height: number, style: CellStyle = {}): TuiFrame {
  const cell = (): Cell => ({ grapheme: ' ', width: 1, style: { ...style } });
  return { width, height, cells: Array.from({ length: width * height }, cell) };
}

export function putText(frame: TuiFrame, row: number, column: number, text: string, style: CellStyle = {}, maxWidth = frame.width - column): number {
  if (row < 0 || row >= frame.height || column >= frame.width || maxWidth <= 0) return column;
  let cursor = Math.max(0, column);
  const boundary = Math.min(frame.width, column + maxWidth);
  for (const grapheme of graphemes(text)) {
    const width = graphemeWidth(grapheme);
    if (width === 0) {
      if (cursor > 0) frame.cells[row * frame.width + cursor - 1].grapheme += grapheme;
      continue;
    }
    if (cursor + width > boundary) break;
    frame.cells[row * frame.width + cursor] = { grapheme, width, style: { ...style } };
    if (width === 2 && cursor + 1 < frame.width) frame.cells[row * frame.width + cursor + 1] = { grapheme: '', width: 0, style: { ...style } };
    cursor += width;
  }
  return cursor;
}

export function textFrame(lines: string[], width: number, height: number): TuiFrame {
  const frame = blankFrame(width, height);
  lines.slice(0, height).forEach((line, row) => putText(frame, row, 0, line));
  return frame;
}
