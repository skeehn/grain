import { listRuns, readRunEvents, RunEngine, RunJournal } from '../kernel/index.js';
import { detectTerminalCapabilities } from './capabilities.js';
import { DifferentialRenderer } from './differential.js';
import { layoutRun } from './layout.js';
import { projectRun } from './projector.js';
import { loadConfig, saveConfig } from '../config.js';
import { resolveTheme, type GrainThemeName } from './theme.js';

export interface TuiAppOptions { runId?: string; alternateScreen?: boolean; }

export async function runTui(options: TuiAppOptions = {}): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Full-screen TUI requires an interactive terminal; use --classic for line output');
  const runId = options.runId || listRuns().at(-1); if (!runId) throw new Error('No runs available. Start a task with grain --classic first.');
  let capabilities = detectTerminalCapabilities(); let renderer = new DifferentialRenderer(capabilities);
  let theme = resolveTheme(loadConfig().tui?.theme); let tick = 0;
  const alternate = options.alternateScreen !== false; let closed = false; let cancelArmed = false;
  const journal = RunJournal.open(runId); const engine = new RunEngine(journal);
  const render = () => {
    capabilities = detectTerminalCapabilities();
    const events = readRunEvents(runId); renderer.render(layoutRun(projectRun(events), capabilities, theme, tick++));
  };
  const cleanup = () => {
    if (closed) return; closed = true; clearInterval(timer); process.stdout.off('resize', resize);
    process.stdin.off('data', input); process.stdin.setRawMode(false); process.stdin.pause();
    process.stdout.write(`\x1b[0m\x1b[?25h${capabilities.mouse ? '\x1b[?1000l\x1b[?1006l' : ''}${alternate ? '\x1b[?1049l' : '\n'}`);
  };
  const resize = () => { capabilities = detectTerminalCapabilities(); renderer = new DifferentialRenderer(capabilities); process.stdout.write('\x1b[2J'); render(); };
  const input = (data: Buffer) => {
    const key = data.toString('utf8');
    try {
      if (key === 'q') { cleanup(); return; }
      if (key === 'p') { const state = engine.state(); engine.dispatch({ type: state.status === 'paused' ? 'resume' : 'pause' }); }
      if (key === 't') {
        const names: GrainThemeName[] = ['field', 'studio', 'arcade', 'system'];
        const nextTheme = resolveTheme(names[(names.indexOf(theme.name) + 1) % names.length]);
        const config = loadConfig(); saveConfig({ ...config, tui: { ...config.tui!, theme: nextTheme.name, schemaVersion: 2 } });
        theme = nextTheme;
      }
      if (key === '\u0003') {
        if (cancelArmed) engine.dispatch({ type: 'cancel', force: true });
        else { cancelArmed = true; engine.dispatch({ type: 'cancel' }); }
      }
    } catch { /* command validity is reflected by unchanged journal state */ }
    render();
  };
  if (alternate) process.stdout.write('\x1b[?1049h');
  process.stdout.write(`\x1b[2J\x1b[?25l${capabilities.mouse ? '\x1b[?1000h\x1b[?1006h' : ''}`);
  process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.on('data', input); process.stdout.on('resize', resize);
  const timer = setInterval(render, capabilities.reducedMotion ? 500 : 125); render();
  await new Promise<void>(resolve => { const done = setInterval(() => { if (closed) { clearInterval(done); resolve(); } }, 50); });
}
