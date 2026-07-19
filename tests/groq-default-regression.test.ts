import { describe, expect, test } from 'bun:test';
import { GROQ_DEFAULT_MODEL, GroqProvider } from '../src/providers/groq.js';

describe('Groq default-model regression', () => {
  test('uses the live tool-capable model verified by the Grain harness', () => {
    expect(GROQ_DEFAULT_MODEL).toBe('openai/gpt-oss-120b');
    expect(new GroqProvider().model).toBe('openai/gpt-oss-120b');
  });
});
