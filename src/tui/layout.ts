import { blankFrame, putText } from './frame.js';
import type { TerminalCapabilities, TuiFrame, TuiViewModel } from './types.js';
import { mascotColor, mascotFrame } from './mascot.js';
import { resolveTheme, type GrainTheme } from './theme.js';

const clip = (value: string, width: number) => value.length <= width ? value : `${value.slice(0, Math.max(0, width - 1))}…`;

export function layoutRun(view: TuiViewModel, capabilities: TerminalCapabilities, theme: GrainTheme = resolveTheme('field'), tick = 0): TuiFrame {
  const { columns: width, rows: height } = capabilities; const frame = blankFrame(width, height);
  frame.cells.forEach(cell => { cell.style.background = theme.canvas; cell.style.foreground = theme.text; });
  const rice = mascotFrame(view.run.status, tick, capabilities.reducedMotion);
  const header = ` GRAIN  ${rice}  ${view.run.status.toUpperCase()}  ${view.run.provider}/${view.run.model}`;
  putText(frame, 0, 0, header.padEnd(width), { foreground: theme.accent, background: theme.panel, bold: true });
  putText(frame, 0, 8, rice, { foreground: mascotColor(view.run.status, theme), background: theme.panel, bold: true });
  putText(frame, 1, 1, clip(view.run.task, width - 2), { foreground: theme.muted, background: theme.canvas });
  const footer = width < 80 ? ' t theme  p pause  q quit ' : ' t theme · p pause/resume · q quit · Ctrl-C cancel ';
  putText(frame, height - 1, 0, footer.padEnd(width), { foreground: theme.muted, background: theme.panel });
  const bodyTop = 3; const bodyHeight = Math.max(1, height - bodyTop - 2);
  if (width < 80) {
    putText(frame, bodyTop - 1, 1, 'TIMELINE', { foreground: theme.accent, bold: true });
    view.timeline.slice(-bodyHeight).forEach((item, index) => putText(frame, bodyTop + index, 1,
      clip(`${String(item.sequence).padStart(3)} ${item.label}${item.detail ? ` · ${item.detail}` : ''}`, width - 2),
      { foreground: item.kind.includes('error') ? theme.danger : item.kind.includes('completed') ? theme.success : theme.text }));
    return frame;
  }
  const leftWidth = width >= 120 ? Math.floor(width * .55) : Math.floor(width * .62); const divider = leftWidth;
  for (let row = 2; row < height - 1; row++) putText(frame, row, divider, '│', { foreground: theme.line });
  putText(frame, 2, 1, 'TIMELINE', { foreground: theme.accent, bold: true });
  view.timeline.slice(-bodyHeight).forEach((item, index) => putText(frame, bodyTop + index, 1,
    clip(`${String(item.sequence).padStart(3)} ${item.label}${item.detail ? ` · ${item.detail}` : ''}`, leftWidth - 2),
    { foreground: item.kind.includes('error') ? theme.danger : item.kind.includes('completed') ? theme.success : theme.text }));
  const right = divider + 2; const rightWidth = width - right - 1;
  putText(frame, 2, right, width >= 120 ? 'WORKSPACE / AGENTS' : 'DETAIL', { foreground: theme.accent, bold: true });
  let row = 3;
  for (const item of view.workspace.slice(-5)) putText(frame, row++, right, clip(`${item.status === 'committed' ? '◆' : '◇'} ${item.path}`, rightWidth), { foreground: theme.evidence });
  if (view.workspace.length === 0) putText(frame, row++, right, '░ no workspace changes', { foreground: theme.muted });
  row++;
  for (const agent of view.agents.slice(-5)) putText(frame, row++, right, clip(`${agent.state === 'succeeded' ? '◆' : '◇'} ${agent.role} ${agent.state}`, rightWidth), { foreground: agent.state === 'succeeded' ? theme.success : theme.warning });
  if (view.agents.length === 0) putText(frame, row++, right, '░ no child agents', { foreground: theme.muted });
  row++;
  const budget = view.context.budgetTokens ? `${view.context.usedTokens}/${view.context.budgetTokens}` : 'not recorded';
  putText(frame, row++, right, clip(`CONTEXT ${budget} · ${view.context.sources} sources`, rightWidth), { foreground: theme.muted });
  putText(frame, row, right, clip(`VERIFY ${view.diagnostics.passed} pass · ${view.diagnostics.failed} fail`, rightWidth), { foreground: view.diagnostics.failed ? theme.danger : theme.success });
  return frame;
}
