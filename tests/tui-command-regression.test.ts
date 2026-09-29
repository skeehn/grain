import { describe, expect, test } from 'bun:test';
import { resolveTuiConnection, transcriptOutputView } from '../src/tui/app.js';
import { loadConfig } from '../src/config.js';

describe('terminal command regressions', () => {
  test('qualified selectors and provider-only overrides never inherit another provider model', () => {
    const config = { ...loadConfig(), provider: 'anthropic', model: 'claude-old' };
    expect(resolveTuiConnection({ model: 'codex:gpt-example' }, config)).toEqual({ provider: 'codex', model: 'gpt-example' });
    expect(resolveTuiConnection({ provider: 'codex' }, config)).toEqual({ provider: 'codex', model: 'auto' });
  });
  test('command output returns to chat so it is immediately visible', () => {
    expect(transcriptOutputView()).toBe('chat');
  });

  test('header and settings reflect CLI provider/model overrides', () => {
    const connection = resolveTuiConnection({ provider: 'groq', model: 'openai/gpt-oss-120b' }, loadConfig());
    expect(connection).toEqual({ provider: 'groq', model: 'openai/gpt-oss-120b' });
  });
});
