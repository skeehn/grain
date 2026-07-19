import { describe, expect, test } from 'bun:test';
import { resolveTuiConnection, transcriptOutputView } from '../src/tui/app.js';
import { loadConfig } from '../src/config.js';

describe('full-screen TUI command regressions', () => {
  test('command output returns to chat so it is immediately visible', () => {
    expect(transcriptOutputView()).toBe('chat');
  });

  test('header and settings reflect CLI provider/model overrides', () => {
    const connection = resolveTuiConnection({ provider: 'groq', model: 'openai/gpt-oss-120b' }, loadConfig());
    expect(connection).toEqual({ provider: 'groq', model: 'openai/gpt-oss-120b' });
  });
});
