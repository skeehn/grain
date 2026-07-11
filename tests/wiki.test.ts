import { beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { LocalWorkspaceFS } from '../src/workspace/index.js';
import { WikiEngine, renderWikiHtml } from '../src/wiki/index.js';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'grain-wiki-'));
  writeFileSync(join(root, 'app.ts'), 'export const answer = 42;\n');
});

describe('repository wiki', () => {
  test('builds a provenance-bearing page and verifies it', () => {
    const wiki = new WikiEngine(new LocalWorkspaceFS(root));
    const page = wiki.build();
    expect(page.sources[0].path).toBe('app.ts');
    expect(wiki.verify().valid).toBe(true);
    expect(wiki.search('repository')[0].id).toBe('repository-index');
  });

  test('preserves human text outside generated markers', () => {
    const wiki = new WikiEngine(new LocalWorkspaceFS(root));
    const page = wiki.build();
    const path = join(root, page.path);
    writeFileSync(path, readFileSync(path, 'utf8').replace('This page is maintained by Grain.', 'Human decision.'));
    wiki.build();
    expect(readFileSync(path, 'utf8')).toContain('Human decision.');
  });

  test('reports stale source hashes', () => {
    const wiki = new WikiEngine(new LocalWorkspaceFS(root));
    wiki.build();
    writeFileSync(join(root, 'app.ts'), 'export const answer = 43;\n');
    expect(wiki.verify().valid).toBe(false);
  });

  test('renders a read-only localhost view with a restrictive CSP', () => {
    const wiki = new WikiEngine(new LocalWorkspaceFS(root));
    wiki.build();
    const rendered = renderWikiHtml(wiki, '/');
    expect(rendered.html).toContain('Grain Wiki');
    expect(rendered.csp).toContain("default-src 'none'");
  });
});
