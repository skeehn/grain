import { blankFrame, putText } from './frame.js';
import type { TerminalCapabilities, TuiFrame, TuiViewModel } from './types.js';
import { mascotColor, mascotFrame } from './mascot.js';
import { grainLogoColor, grainLogoFrame, grainLogoSprite } from './logo.js';
import { resolveTheme, type GrainTheme } from './theme.js';

const clip = (value: string, width: number) => value.length <= width ? value : `${value.slice(0, Math.max(0, width - 1))}…`;

export function layoutRun(view: TuiViewModel, capabilities: TerminalCapabilities, theme: GrainTheme = resolveTheme('field'), tick = 0): TuiFrame {
  const { columns: width, rows: height } = capabilities;
  const frame = blankFrame(width, height, { background: theme.canvas, foreground: theme.text });
  const logoColor = { foreground: grainLogoColor(view.run.status, theme), background: theme.panel, bold: true };
  if (view.run.status === 'created' && view.timeline.length <= 1) return welcomeFrame(frame, view, theme, tick, capabilities.reducedMotion);
  const rice = mascotFrame(view.run.status, tick, capabilities.reducedMotion);
  const logo = grainLogoFrame(view.run.status, tick, capabilities.reducedMotion);
  const header = ` GRAIN ${logo}  ${view.run.status.toUpperCase()}  ${view.run.provider}/${view.run.model}`;
  putText(frame, 0, 0, header.padEnd(width), { foreground: theme.text, background: theme.panel, bold: true });
  putText(frame, 1, 1, clip(view.run.task, width - 2), { foreground: theme.muted, background: theme.canvas });
  putText(frame, 1, Math.max(1, width - 20), `${rice}  ${view.run.elapsedMs > 0 ? `${Math.round(view.run.elapsedMs / 1000)}s` : 'ready'}`, logoColor, 19);
  const railLevel = view.run.status === 'succeeded' ? 8 : view.run.status === 'failed' ? 2 : 5 + (tick % 4);
  putText(frame, 2, 1, ditherRail(Math.max(8, width - 2), tick, railLevel), { foreground: theme.evidence, background: theme.canvas });
  const bodyTop = 4; const footerRows = view.question ? 10 : 3; const bodyHeight = Math.max(1, height - bodyTop - footerRows);
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
  if (view.question) renderQuestion(frame, view.question, theme, height - 10);
  const footer = width < 80 ? ' t theme · p pause · q quit ' : ' t theme · p pause/resume · q quit · Ctrl-C cancel ';
  putText(frame, height - 2, 0, footer.padEnd(width), { foreground: theme.muted, background: theme.panel });
  putText(frame, height - 1, 0, ' › ', { foreground: theme.accent, background: theme.panel, bold: true });
  putText(frame, height - 1, 3, view.question ? 'choose a response above' : 'type a task in the workspace · /help for commands', { foreground: theme.muted, background: theme.panel });
  return frame;
}

function ditherRail(width: number, tick: number, level: number): string {
  const pattern = ['░', '▒', '▓', '█'];
  return Array.from({ length: width }, (_, index) => pattern[(index + tick) % 4] === '█' && index % 8 > level ? '░' : pattern[(index + tick) % 4]).join('');
}

function welcomeFrame(frame: TuiFrame, view: TuiViewModel, theme: GrainTheme, tick: number, reducedMotion: boolean): TuiFrame {
  const width = frame.width; const height = frame.height; const panelWidth = Math.min(72, Math.max(36, width - 6)); const left = Math.floor((width - panelWidth) / 2); const top = Math.max(3, Math.floor((height - 14) / 2));
  const border = '─'.repeat(panelWidth - 2);
  putText(frame, top, left, `╭${border}╮`, { foreground: theme.line, background: theme.panel });
  putText(frame, top + 1, left, `│${' '.repeat(panelWidth - 2)}│`, { foreground: theme.line, background: theme.panel });
  grainLogoSprite(view.run.status, tick, reducedMotion).forEach((line, index) => putText(frame, top + 2 + index, left + 4, line, { foreground: grainLogoColor(view.run.status, theme), background: theme.panel, bold: true }));
  putText(frame, top + 2, left + 16, 'GRAIN', { foreground: theme.text, background: theme.panel, bold: true });
  putText(frame, top + 3, left + 16, 'software factory / terminal-first', { foreground: theme.evidence, background: theme.panel });
  putText(frame, top + 5, left + 16, clip(`${view.run.provider}/${view.run.model}`, panelWidth - 19), { foreground: theme.muted, background: theme.panel });
  putText(frame, top + 8, left + 4, 'A small grain of context. A whole software factory.', { foreground: theme.accent, background: theme.panel, bold: true }, panelWidth - 8);
  putText(frame, top + 10, left + 4, 'Open a run to watch the agent read, act, ask, and verify.', { foreground: theme.muted, background: theme.panel }, panelWidth - 8);
  putText(frame, top + 12, left, `╰${border}╯`, { foreground: theme.line, background: theme.panel });
  putText(frame, height - 2, 0, ' t theme · q quit '.padEnd(width), { foreground: theme.muted, background: theme.panel });
  putText(frame, height - 1, 0, ' › ', { foreground: theme.accent, background: theme.panel, bold: true });
  putText(frame, height - 1, 3, 'start with grain "your task"', { foreground: theme.muted, background: theme.panel });
  return frame;
}

function renderQuestion(frame: TuiFrame, question: NonNullable<TuiViewModel['question']>, theme: GrainTheme, top: number): void {
  const width = frame.width; const title = ` DECISION  ${question.question}`;
  putText(frame, top, 0, '─'.repeat(width), { foreground: theme.warning, background: theme.panel });
  putText(frame, top + 1, 1, clip(title, width - 2), { foreground: theme.warning, background: theme.panel, bold: true });
  if (question.choices.length) {
    question.choices.slice(0, 6).forEach((choice, index) => putText(frame, top + 2 + index, 2, `${index + 1}. ${choice}`, { foreground: theme.text, background: theme.canvas }));
  } else putText(frame, top + 2, 2, 'Press Enter to continue or type a response.', { foreground: theme.muted, background: theme.canvas });
}
