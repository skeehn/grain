import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { handleUpdate, installVerifiedBinary, parseUpdateArgs, verifyChecksum } from '../src/commands/update.js';

test('update options reject typos and conflicting sources', () => {
  expect(parseUpdateArgs(['--check']).check).toBe(true);
  expect(() => parseUpdateArgs(['--chec'])).toThrow('Invalid');
  expect(() => parseUpdateArgs(['--source'])).toThrow('Invalid');
  expect(() => parseUpdateArgs(['--release', '--source', '.'])).toThrow('Choose');
});

test('release bytes require an exact matching SHA256SUMS entry', () => {
  const bytes = Buffer.from('binary'); const hash = createHash('sha256').update(bytes).digest('hex');
  expect(() => verifyChecksum(bytes, `${hash}  grain-test\n`, 'grain-test')).not.toThrow();
  expect(() => verifyChecksum(Buffer.from('corrupted'), `${hash}  grain-test`, 'grain-test')).toThrow('Checksum');
  expect(() => verifyChecksum(bytes, `${hash}  grain-other`, 'grain-test')).toThrow('Checksum');
});

test('atomic install verifies executable, backs up, and leaves original intact on failure', () => {
  const dir = mkdtempSync(join(tmpdir(), 'grain-update-test-')); const dest = join(dir, 'grain');
  try {
    writeFileSync(dest, 'original');
    expect(() => installVerifiedBinary(Buffer.from('#!/bin/sh\necho wrong\n'), dest, '9.9.9')).toThrow('unexpected version');
    expect(readFileSync(dest, 'utf8')).toBe('original'); expect(readdirSync(dir)).toEqual(['grain']);
    const bytes = Buffer.from('#!/bin/sh\necho "grain v9.9.9"\n');
    const { backup } = installVerifiedBinary(bytes, dest, '9.9.9');
    expect(readFileSync(backup!, 'utf8')).toBe('original'); expect(readFileSync(dest)).toEqual(bytes);
    expect(readdirSync(dir).filter(file => file.startsWith('.grain-update-'))).toEqual([]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('release check is read-only; install verifies checksums before handing off', async () => {
  const bytes = Buffer.from('fixture'); const asset = `grain-${process.platform}-${process.arch}`;
  const manifest = `${createHash('sha256').update(bytes).digest('hex')}  ${asset}`;
  const urls: string[] = []; let installed = 0;
  const deps = { source: null, npm: false, log: () => {},
    fetch: (async (url: string) => { urls.push(url); return url.endsWith('/latest')
      ? Response.json({ tag_name: 'v9.9.9', assets: [{ name: asset, browser_download_url: 'https://github.com/binary' }, { name: 'SHA256SUMS', browser_download_url: 'https://github.com/SHA256SUMS' }] })
      : new Response(url.endsWith('SHA256SUMS') ? manifest : bytes); }) as typeof fetch,
    install: () => { installed++; return {}; },
  };
  await handleUpdate(['--check'], deps); expect(urls).toHaveLength(1); expect(installed).toBe(0);
  await handleUpdate(['--yes'], deps); expect(installed).toBe(1); expect(urls).toHaveLength(4);
  await expect(handleUpdate(['--yes'], { ...deps, fetch: (async () => new Response('offline', { status: 503 })) as typeof fetch })).rejects.toThrow('503');
  expect(installed).toBe(1);
});

test('npm updates cannot replace the package-manager entry point with a native binary', async () => {
  await expect(handleUpdate(['--yes'], { npm: true, log: () => {} })).rejects.toThrow('npm install -g');
});

test('source update check does not build; failed builds leave the installed binary intact', async () => {
  const source = mkdtempSync(join(tmpdir(), 'grain-source-update-')); const destination = join(source, 'installed-grain');
  try {
    for (const dir of ['src', 'scripts', 'dist']) mkdirSync(join(source, dir));
    writeFileSync(join(source, 'src/cli.ts'), 'fixture'); writeFileSync(join(source, 'scripts/build.ts'), 'fixture');
    writeFileSync(destination, 'old'); let builds = 0;
    const deps = { source, destination, npm: false, log: () => {}, build: () => { builds++; throw new Error('build failed'); } };
    await handleUpdate(['--check'], deps); expect(builds).toBe(0);
    await expect(handleUpdate([], deps)).rejects.toThrow('build failed'); expect(readFileSync(destination, 'utf8')).toBe('old');
    await handleUpdate([], { ...deps, build: () => { writeFileSync(join(source, 'dist/grain'), '#!/bin/sh\necho "grain v9.9.9"\n'); } });
    expect(readFileSync(destination, 'utf8')).toContain('grain v9.9.9');
    expect(readdirSync(source).some(file => file.startsWith('installed-grain.backup-'))).toBe(true);
  } finally { rmSync(source, { recursive: true, force: true }); }
});
