import { test, expect } from 'bun:test';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { loadMcpConfig } from '../src/mcp/config.ts';

// Helper to create and clean a temp dir
function withTempDir(name: string, fn: (dir: string) => void) {
  const tmp = join(process.cwd(), name);
  try {
    rmSync(tmp, { recursive: true, force: true });
    mkdirSync(tmp, { recursive: true });
    fn(tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

test('returns empty servers object when no mcp.json exists', () => {
  const old = process.env.GRAIN_HOME;
  withTempDir('tmp-mcp-empty', (dir) => {
    process.env.GRAIN_HOME = dir;
    const cfg = loadMcpConfig();
    expect(cfg).toBeTruthy();
    expect(cfg.servers).toEqual({});
  });
  process.env.GRAIN_HOME = old;
});

test('fills missing trust and default allowTools to []', () => {
  const old = process.env.GRAIN_HOME;
  withTempDir('tmp-mcp-trust', (dir) => {
    const data = { servers: { test: { url: 'https://localhost:12345' } } };
    writeFileSync(join(dir, 'mcp.json'), JSON.stringify(data, null, 2));
    process.env.GRAIN_HOME = dir;
    const cfg = loadMcpConfig();
    expect(cfg.servers).toHaveProperty('test');
    const server: any = cfg.servers.test;
    expect(server.trust).toBeTruthy();
    expect(Array.isArray(server.trust.allowTools)).toBe(true);
  });
  process.env.GRAIN_HOME = old;
});

test('throws a readable error on invalid http url', () => {
  const old = process.env.GRAIN_HOME;
  withTempDir('tmp-mcp-badurl', (dir) => {
    const data = { servers: { bad: { url: 'not-a-valid-url' } } };
    writeFileSync(join(dir, 'mcp.json'), JSON.stringify(data, null, 2));
    process.env.GRAIN_HOME = dir;
    let caught = false;
    try {
      loadMcpConfig();
    } catch (e) {
      caught = true;
      expect(String(e).toLowerCase()).toContain('invalid url');
    }
    if (!caught) throw new Error('Expected loadMcpConfig to throw for invalid URL');
  });
  process.env.GRAIN_HOME = old;
});
