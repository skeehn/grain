// Session status tracked for the Pi-style status line: cumulative tokens,
// the last request's input size (for the context gauge), and the active model.
export interface SessionStats {
  upTokens: number;      // cumulative input/prompt tokens sent
  downTokens: number;    // cumulative output/completion tokens received
  lastInputTokens: number; // last request's input size — drives the context gauge
  contextWindow: number; // active model's usable window
  provider: string;
  model: string;
  costUsd: number;       // cumulative, when the provider reports it
}

export function newSessionStats(): SessionStats {
  return { upTokens: 0, downTokens: 0, lastInputTokens: 0, contextWindow: 0, provider: '', model: '', costUsd: 0 };
}

// Process-wide session stats: the agent loop updates it; the workspace prompt
// reads it to draw the status line. One session per process, so a singleton is fine.
let current = newSessionStats();
export function getSessionStats(): SessionStats { return current; }
export function resetSessionStats(): SessionStats { current = newSessionStats(); return current; }

/** Fold a provider usage event into the running totals. */
export function recordUsage(
  stats: SessionStats,
  usage: { input_tokens?: number; output_tokens?: number; cost_usd?: number },
): void {
  const inTok = usage.input_tokens ?? 0;
  const outTok = usage.output_tokens ?? 0;
  stats.upTokens += inTok;
  stats.downTokens += outTok;
  if (inTok > 0) stats.lastInputTokens = inTok;
  if (usage.cost_usd) stats.costUsd += usage.cost_usd;
}

/** Human token count: 942 → "942", 12_400 → "12.4k", 1_240_000 → "1.24M". */
export function fmtTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

/** Context gauge: "37.7%/262k" from last input vs window (empty if unknown). */
export function fmtContext(stats: SessionStats): string {
  if (!stats.contextWindow) return '';
  const pct = Math.min(100, (stats.lastInputTokens / stats.contextWindow) * 100);
  return `${pct.toFixed(1)}%/${fmtTokens(stats.contextWindow)}`;
}

/**
 * The Pi-style status line, e.g.:
 *   ↑340k ↓78k · 37.7%/262k · execute · openrouter poolside/laguna-m.1:free
 * Returns the plain string; the renderer applies color.
 */
export function statusLineText(stats: SessionStats, mode?: string, effort?: string): string {
  const parts = [`↑${fmtTokens(stats.upTokens)} ↓${fmtTokens(stats.downTokens)}`];
  const ctx = fmtContext(stats);
  if (ctx) parts.push(ctx);
  if (mode) parts.push(mode);
  const model = stats.model ? `${stats.provider} ${stats.model}` : '';
  if (model) parts.push(model);
  if (effort) parts.push(effort);
  return parts.join(' · ');
}
