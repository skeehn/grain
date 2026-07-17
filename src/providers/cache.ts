// Prompt-caching helpers shared by the Anthropic and Bedrock providers.
// Render order is tools → system → messages, and any byte change invalidates
// everything after a cache_control breakpoint. We place three (the max is 4):
// the stable tool schemas (always hits after turn 1), the system prompt (hits
// when unchanged), and the last prior turn (caches the growing history prefix).
export const EPHEMERAL = { type: 'ephemeral' as const };

/** Mark the last tool so the (stable) tool schemas cache across turns. */
export function applyToolCache(tools: any[]): void {
  if (tools.length) tools[tools.length - 1].cache_control = EPHEMERAL;
}

/** Wrap the system prompt in a cached text block (or undefined if empty). */
export function cachedSystem(system: string) {
  return system ? [{ type: 'text' as const, text: system, cache_control: EPHEMERAL }] : undefined;
}

/** Mark the last content block of the last message to cache the history prefix. */
export function applyHistoryCache(messages: Array<{ content: any[] }>): void {
  const last = messages[messages.length - 1];
  if (last && last.content.length) last.content[last.content.length - 1].cache_control = EPHEMERAL;
}

/** Count cache_control breakpoints across a built request (must stay ≤ 4). */
export function countBreakpoints(system: any[] | undefined, tools: any[], messages: Array<{ content: any[] }>): number {
  let n = 0;
  for (const s of system ?? []) if (s?.cache_control) n++;
  for (const t of tools) if (t?.cache_control) n++;
  for (const m of messages) for (const b of m.content) if (b?.cache_control) n++;
  return n;
}
