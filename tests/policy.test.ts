import { describe, expect, test } from 'bun:test';
import { classifyTool, decidePolicy } from '../src/policy/index.js';

const base = { autoApprove: false, allowDestructive: false, benchmark: false, interactive: false };

describe('tool approval policy', () => {
  test('auto-approval never authorizes destructive commands', () => {
    expect(decidePolicy('bash', { command: 'rm -rf build' }, { ...base, autoApprove: true }).decision).toBe('deny');
  });
  test('explicit destructive flag authorizes classified destructive commands', () => {
    expect(decidePolicy('git', { action: 'rollback', ref: 'HEAD~1' }, { ...base, allowDestructive: true }).decision).toBe('allow');
  });
  test('fails closed on shell indirection and unknown compound commands', () => {
    expect(classifyTool('bash', { command: 'echo $(cat ~/.ssh/id_rsa)' })).toBe('destructive');
    expect(classifyTool('bash', { command: 'do-a-thing && another' })).toBe('destructive');
  });
  test('benchmark mode authorizes only workspace writes', () => {
    expect(decidePolicy('write', {}, { ...base, benchmark: true }).decision).toBe('allow');
    expect(decidePolicy('bash', { command: 'git push' }, { ...base, benchmark: true }).decision).toBe('deny');
  });
  test('ask_user is read-only and never requires approval or is denied', () => {
    // Asking the user a question has no side effects — approving it would be
    // absurd, and denying it in non-interactive mode breaks the clarify path.
    expect(classifyTool('ask_user', { question: 'which db?' })).toBe('read_only');
    expect(decidePolicy('ask_user', { question: 'which db?' }, { ...base, interactive: false }).decision).toBe('allow');
    expect(decidePolicy('ask_user', { question: 'which db?' }, { ...base, interactive: true }).decision).toBe('allow');
  });
});
