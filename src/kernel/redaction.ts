const SECRET_KEY = /(authorization|api[_-]?key|secret|token|password|cookie|credential)/i;
const SECRET_VALUE = /\b(sk-(?:or|ant|proj)?-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16})\b/g;

export function redactTrajectory(value: unknown, home = process.env.HOME || ''): unknown {
  if (Array.isArray(value)) return value.map(item => redactTrajectory(item, home));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key, SECRET_KEY.test(key) ? '[REDACTED]' : redactTrajectory(item, home),
    ]));
  }
  if (typeof value !== 'string') return value;
  let result = value.replace(SECRET_VALUE, '[REDACTED_SECRET]')
    .replace(/terminal-bench-canary[^\s"']*/gi, '[REDACTED_CANARY]');
  if (home) result = result.split(home).join('~');
  return result;
}
