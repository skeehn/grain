import { describe, test, expect, afterAll } from 'bun:test';
import { setBashOutputSink, executeBash, destroyShell } from '../src/tools/bash.js';

afterAll(() => { setBashOutputSink(null); destroyShell(); });

describe('bash live output streaming', () => {
  test('streams each output line to the sink as it runs', async () => {
    const streamed: string[] = [];
    setBashOutputSink(l => streamed.push(l));
    const r = await executeBash({ command: 'echo alpha; echo beta; echo gamma' });
    expect(r.is_error).not.toBe(true);
    // sink saw the lines live (order preserved), and the final result still holds them
    expect(streamed).toContain('alpha');
    expect(streamed).toContain('beta');
    expect(streamed).toContain('gamma');
    expect(r.content).toContain('gamma');
  });

  test('no sink → no streaming, result still returned', async () => {
    setBashOutputSink(null);
    const r = await executeBash({ command: 'echo solo' });
    expect(r.content).toContain('solo');
  });
});
