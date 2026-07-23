import { describe, expect, test } from 'bun:test';
import { classifyTuiTaskError } from '../src/tui/app.js';

describe('TUI cancellation regression', () => {
  test('intentional SIGINT is shown as cancellation rather than failure', () => {
    expect(classifyTuiTaskError('SIGINT')).toEqual({ status: 'cancelled', label: 'warn', message: 'Cancelled.' });
    expect(classifyTuiTaskError('provider unavailable').status).toBe('failed');
  });
});
