import { describe, test, expect } from 'bun:test';
import { existsSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import {
  loadConfig,
  saveConfig,
  validateConfig,
  saveKeyToEnv,
  listEnvKeys,
  loadGrainEnv,
  getConfigDir,
} from '../src/config.js';
import { loadMcpConfig } from '../src/mcp/config.js';

// GRAIN_HOME is a temp dir (tests/setup.ts), so this exercises real file I/O safely.
const grainHome = process.env.GRAIN_HOME!;

describe('config', () => {
  test('GRAIN_HOME redirect is active (never touch real ~/.grain)', () => {
    expect(getConfigDir()).toBe(grainHome);
  });

  test('loadConfig returns defaults when no file exists', () => {
    rmSync(join(grainHome, 'config.json'), { force: true });
    const cfg = loadConfig();
    expect(cfg.provider).toBe('bedrock');
    expect(cfg.max_tokens).toBe(180000);
  });

  test('saveConfig merges partial config over defaults and persists', () => {
    saveConfig({ provider: 'anthropic' });
    const cfg = loadConfig();
    expect(cfg.provider).toBe('anthropic');
    expect(cfg.max_tokens).toBe(180000); // default retained
    const raw = JSON.parse(readFileSync(join(grainHome, 'config.json'), 'utf-8'));
    expect(raw.provider).toBe('anthropic');
    // restore
    saveConfig({ provider: 'bedrock' });
  });

  test('loadConfig survives corrupted JSON', () => {
    const p = join(grainHome, 'config.json');
    require('fs').writeFileSync(p, '{not json');
    const cfg = loadConfig();
    expect(cfg.provider).toBe('bedrock');
    rmSync(p, { force: true });
  });

  test('validateConfig rejects unknown provider', () => {
    const res = validateConfig({ provider: 'gpt5', model: null, engram_db: '', max_tokens: 1 } as any);
    expect(res.valid).toBe(false);
    expect(res.error).toContain('Unknown provider');
  });

  test('validateConfig requires ANTHROPIC_API_KEY for anthropic provider', () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const res = validateConfig({ provider: 'anthropic', model: null, engram_db: '', max_tokens: 1 } as any);
    expect(res.valid).toBe(false);
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const res2 = validateConfig({ provider: 'anthropic', model: null, engram_db: '', max_tokens: 1 } as any);
    expect(res2.valid).toBe(true);
    if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = saved;
  });

  test('loads versioned field-instrument TUI defaults and rejects invalid values', () => {
    rmSync(join(grainHome, 'config.json'), { force: true }); const cfg = loadConfig();
    expect(cfg.tui?.theme).toBe('field'); expect(cfg.tui?.alternateScreen).toBe(true);
    expect(validateConfig({ ...cfg, tui: { ...cfg.tui!, theme: 'purple' as any } }).valid).toBe(false);
  });

  test('MCP config rejects non-loopback plaintext HTTP', () => {
    require('node:fs').writeFileSync(join(grainHome, 'mcp.json'), JSON.stringify({ servers: { bad: { transport: 'http', url: 'http://example.com/mcp', trust: { enabled: true, allowTools: [] } } } }));
    expect(() => loadMcpConfig()).toThrow('HTTPS or loopback');
    rmSync(join(grainHome, 'mcp.json'), { force: true });
  });
});

describe('.env management', () => {
  test('saveKeyToEnv + listEnvKeys round-trip', () => {
    saveKeyToEnv('TEST_KEY_A', 'value-a');
    saveKeyToEnv('TEST_KEY_B', 'value-b');
    const keys = listEnvKeys();
    expect(keys.TEST_KEY_A).toBe('value-a');
    expect(keys.TEST_KEY_B).toBe('value-b');
  });

  test('saveKeyToEnv overwrites existing key without duplicating', () => {
    saveKeyToEnv('TEST_KEY_A', 'first');
    saveKeyToEnv('TEST_KEY_A', 'second');
    const envFile = readFileSync(join(grainHome, '.env'), 'utf-8');
    expect(envFile.match(/TEST_KEY_A=/g)!.length).toBe(1);
    expect(listEnvKeys().TEST_KEY_A).toBe('second');
  });

  test('loadGrainEnv sets process.env but never overwrites shell env', () => {
    saveKeyToEnv('TEST_FRESH_KEY', 'from-file');
    delete process.env.TEST_FRESH_KEY;
    process.env.TEST_EXISTING_KEY = 'from-shell';
    saveKeyToEnv('TEST_EXISTING_KEY', 'from-file');
    loadGrainEnv();
    expect(process.env.TEST_FRESH_KEY).toBe('from-file');
    expect(process.env.TEST_EXISTING_KEY).toBe('from-shell');
  });

  test('listEnvKeys strips quotes and skips comments', () => {
    const fs = require('fs');
    fs.writeFileSync(join(grainHome, '.env'), '# comment\nQUOTED="secret"\nSINGLE=\'val\'\n\n');
    const keys = listEnvKeys();
    expect(keys.QUOTED).toBe('secret');
    expect(keys.SINGLE).toBe('val');
    expect(Object.keys(keys)).not.toContain('# comment');
  });
});
