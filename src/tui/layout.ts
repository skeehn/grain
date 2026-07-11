import { blankFrame, putText } from './frame.js';
import type { TerminalCapabilities, TuiFrame, TuiViewModel } from './types.js';

const PALETTE = { bg: '#161713', panel: '#1D1F1A', line: '#393A31', text: '#E7E0D2', muted: '#929084', gold: '#D6A85F', green: '#88A678', amber: '#E5B567', red: '#E06C75', blue: '#7FA7B8' };
const clip = (value: string, width: number) => value.length <= width ? value : `${value.slice(0, Math.max(0, width - 1))}…`;

export function layoutRun(view: TuiViewModel, capabilities: TerminalCapabilities): TuiFrame {
  const { columns: width, rows: height } = capabilities; const frame = blankFrame(width, height);
  frame.cells.forEach(cell => { cell.style.background = PALETTE.bg; cell.style.foreground = PALETTE.text; });
  const header = ` GRAIN  ${view.run.status.toUpperCase()}  ${view.run.provider}/${view.run.model}`;
  putText(frame, 0, 0, header.padEnd(width), { foreground: PALETTE.gold, background: PALETTE.panel, bold: true });
  putText(frame, 1, 1, clip(view.run.task, width - 2), { foreground: PALETTE.muted, background: PALETTE.bg });
  const footer = width < 80 ? ' Tab panels  : commands  q quit ' : ' Tab focus · Enter inspect · a approvals · d diff · t tests · g agents · c context · s steer · p pause · q quit ';
  putText(frame, height - 1, 0, footer.padEnd(width), { foreground: PALETTE.muted, background: PALETTE.panel });
  const bodyTop = 3; const bodyHeight = Math.max(1, height - bodyTop - 2);
  if (width < 80) {
    putText(frame, bodyTop - 1, 1, 'TIMELINE', { foreground: PALETTE.gold, bold: true });
    view.timeline.slice(-bodyHeight).forEach((item, index) => putText(frame, bodyTop + index, 1,
      clip(`${String(item.sequence).padStart(3)} ${item.label}${item.detail ? ` · ${item.detail}` : ''}`, width - 2),
      { foreground: item.kind.includes('error') ? PALETTE.red : item.kind.includes('completed') ? PALETTE.green : PALETTE.text }));
    return frame;
  }
  const leftWidth = width >= 120 ? Math.floor(width * .55) : Math.floor(width * .62); const divider = leftWidth;
  for (let row = 2; row < height - 1; row++) putText(frame, row, divider, '│', { foreground: PALETTE.line });
  putText(frame, 2, 1, 'TIMELINE', { foreground: PALETTE.gold, bold: true });
  view.timeline.slice(-bodyHeight).forEach((item, index) => putText(frame, bodyTop + index, 1,
    clip(`${String(item.sequence).padStart(3)} ${item.label}${item.detail ? ` · ${item.detail}` : ''}`, leftWidth - 2),
    { foreground: item.kind.includes('error') ? PALETTE.red : item.kind.includes('completed') ? PALETTE.green : PALETTE.text }));
  const right = divider + 2; const rightWidth = width - right - 1;
  putText(frame, 2, right, width >= 120 ? 'WORKSPACE / AGENTS' : 'DETAIL', { foreground: PALETTE.gold, bold: true });
  let row = 3;
  for (const item of view.workspace.slice(-5)) putText(frame, row++, right, clip(`${item.status === 'committed' ? '◆' : '◇'} ${item.path}`, rightWidth), { foreground: PALETTE.blue });
  if (view.workspace.length === 0) putText(frame, row++, right, '░ no workspace changes', { foreground: PALETTE.muted });
  row++;
  for (const agent of view.agents.slice(-5)) putText(frame, row++, right, clip(`${agent.state === 'succeeded' ? '◆' : '◇'} ${agent.role} ${agent.state}`, rightWidth), { foreground: agent.state === 'succeeded' ? PALETTE.green : PALETTE.amber });
  if (view.agents.length === 0) putText(frame, row++, right, '░ no child agents', { foreground: PALETTE.muted });
  row++;
  const budget = view.context.budgetTokens ? `${view.context.usedTokens}/${view.context.budgetTokens}` : 'not recorded';
  putText(frame, row++, right, clip(`CONTEXT ${budget} · ${view.context.sources} sources`, rightWidth), { foreground: PALETTE.muted });
  putText(frame, row, right, clip(`VERIFY ${view.diagnostics.passed} pass · ${view.diagnostics.failed} fail`, rightWidth), { foreground: view.diagnostics.failed ? PALETTE.red : PALETTE.green });
  return frame;
}
