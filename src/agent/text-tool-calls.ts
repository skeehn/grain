/** Recover tool calls that models dump as XML/text instead of native function calling. */

export interface ParsedTextToolCall {
  name: string;
  input: Record<string, unknown>;
}

function parseParameters(inner: string): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  const parameter = /<parameter\s+name="([^"]+)"\s*>([\s\S]*?)<\/parameter>/giu;
  let match: RegExpExecArray | null;
  while ((match = parameter.exec(inner))) {
    const value = match[2].trim();
    try { input[match[1]] = JSON.parse(value); }
    catch { input[match[1]] = value; }
  }
  if (Object.keys(input).length) return input;
  const trimmed = inner.trim();
  if (!trimmed) return {};
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch { /* not JSON */ }
  return {};
}

function allowed(name: string, names: Set<string>): boolean {
  return names.has(name);
}

/**
 * Pull `<invoke>`, `<tool_call>`, and similar dumps out of assistant prose so
 * Grain can actually run them. Unknown names are left in the text.
 */
export function extractTextToolCalls(text: string, allowedNames: Set<string>): { text: string; calls: ParsedTextToolCall[] } {
  const calls: ParsedTextToolCall[] = [];
  let remaining = text;

  const invoke = /<invoke\s+name="([^"]+)"\s*(?:\/>|>([\s\S]*?)<\/invoke>)/giu;
  remaining = remaining.replace(invoke, (raw, name: string, inner = '') => {
    if (!allowed(name, allowedNames)) return raw;
    calls.push({ name, input: parseParameters(inner) });
    return '';
  });

  const toolCall = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/giu;
  remaining = remaining.replace(toolCall, (raw, inner: string) => {
    try {
      const parsed = JSON.parse(inner);
      const name = String(parsed.name || parsed.tool || '');
      if (!allowed(name, allowedNames)) return raw;
      const args = parsed.arguments ?? parsed.input ?? parsed.parameters ?? {};
      calls.push({ name, input: args && typeof args === 'object' ? args : {} });
      return '';
    } catch { return raw; }
  });

  const fn = /<function(?:_call)?\s*=?\s*"?([A-Za-z0-9_]+)"?\s*>([\s\S]*?)<\/function(?:_call)?>/giu;
  remaining = remaining.replace(fn, (raw, name: string, inner = '') => {
    if (!allowed(name, allowedNames)) return raw;
    calls.push({ name, input: parseParameters(inner) });
    return '';
  });

  return { text: remaining.replace(/\n{3,}/gu, '\n\n').trim(), calls };
}
