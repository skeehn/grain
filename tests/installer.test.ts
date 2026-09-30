import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

test('shell installer stages verified binaries and preserves existing installs on corrupt/partial downloads', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'grain-installer-test-'));
  const bin = join(dir, 'bin'); const install = join(dir, 'install'); const fixtures = join(dir, 'fixtures');
  for (const path of [bin, install, fixtures]) mkdirSync(path);
  const bytes = '#!/bin/sh\necho "grain v9.9.9"\n'; const asset = `grain-${process.platform}-${process.arch}`;
  writeFileSync(join(fixtures, asset), bytes);
  writeFileSync(join(fixtures, 'SHA256SUMS'), `${createHash('sha256').update(bytes).digest('hex')}  ${asset}\n`);
  writeFileSync(join(bin, 'curl'), `#!/bin/sh
dest=""
url=""
while [ "$#" -gt 0 ]; do
  case "$1" in -o) shift; dest="$1" ;; https://*) url="$1" ;; esac
  shift
done
case "$url" in */latest) echo '{"tag_name":"v9.9.9"}'; exit 0 ;; esac
asset="\${url##*/}"
case "$asset" in engram-*) exit 22 ;; esac
if [ "$INSTALL_TEST_MODE" = partial ] && [ "$asset" != SHA256SUMS ]; then echo partial > "$dest"; exit 22; fi
if [ "$INSTALL_TEST_MODE" = corrupt ] && [ "$asset" != SHA256SUMS ]; then echo corrupt > "$dest"; exit 0; fi
cp "$INSTALL_TEST_FIXTURES/$asset" "$dest"
`, { mode: 0o755 });
  const invoke = async (mode: string) => {
    const child = Bun.spawn(['sh', join(import.meta.dir, '../install.sh')], { cwd: dir,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GRAIN_INSTALL_DIR: install, INSTALL_TEST_MODE: mode, INSTALL_TEST_FIXTURES: fixtures }, stdout: 'pipe', stderr: 'pipe' });
    const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]); return { code, text: out + err };
  };
  try {
    writeFileSync(join(install, 'grain'), 'old grain'); writeFileSync(join(install, 'engram'), 'old engram');
    const success = await invoke('valid'); expect(success.code, success.text).toBe(0);
    expect(readFileSync(join(install, 'grain'), 'utf8')).toBe(bytes);
    expect(readFileSync(join(install, 'engram'), 'utf8')).toBe('old engram');
    const backup = readdirSync(install).find(name => name.startsWith('grain.backup-'))!;
    expect(readFileSync(join(install, backup), 'utf8')).toBe('old grain');
    for (const mode of ['partial', 'corrupt']) { expect((await invoke(mode)).code).toBe(1); expect(readFileSync(join(install, 'grain'), 'utf8')).toBe(bytes); }
    expect(readdirSync(install).some(name => name.startsWith('.grain-install-'))).toBe(false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
