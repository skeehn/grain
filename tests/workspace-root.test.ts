import { describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { openWorkspace, resolveWorkspace } from '../src/workspace/root.js';

describe('workspace resolution', () => {
  test('discovers a project upward and keeps unrelated directories in general chat', () => {
    const base = `${process.env.GRAIN_HOME}/workspace-root`;
    const repo = join(base, 'repo'); const nested = join(repo, 'src', 'deep'); const plain = join(base, 'plain');
    mkdirSync(nested, { recursive: true }); mkdirSync(plain, { recursive: true }); writeFileSync(join(repo, 'package.json'), '{}');
    expect(resolveWorkspace(nested)).toEqual({ root: repo, mode: 'project' });
    expect(resolveWorkspace(plain)).toEqual({ mode: 'general' });
  });

  test('does not treat $HOME as a project because of a loose pyproject.toml', () => {
    const home = join(`${process.env.GRAIN_HOME}`, 'fake-home');
    const notes = join(home, 'notes');
    mkdirSync(notes, { recursive: true });
    writeFileSync(join(home, 'pyproject.toml'), '[project]\nname = "lab"\n');
    writeFileSync(join(home, 'Makefile'), 'all:\n\ttrue\n');
    expect(resolveWorkspace(home, { home })).toEqual({ mode: 'general' });
    expect(resolveWorkspace(notes, { home })).toEqual({ mode: 'general' });
  });

  test('openWorkspace always has a cwd; projectRoot is optional', () => {
    const home = join(`${process.env.GRAIN_HOME}`, 'open-folder');
    mkdirSync(home, { recursive: true });
    expect(openWorkspace(home, { home: join(`${process.env.GRAIN_HOME}`, 'elsewhere') })).toEqual({ cwd: home });
  });

  test('home is a project only when it is a git repository', () => {
    const home = join(`${process.env.GRAIN_HOME}`, 'git-home');
    mkdirSync(join(home, '.git'), { recursive: true });
    mkdirSync(join(home, 'src'), { recursive: true });
    writeFileSync(join(home, 'pyproject.toml'), '[project]\nname = "dotfiles"\n');
    expect(resolveWorkspace(home, { home })).toEqual({ root: home, mode: 'project' });
    expect(resolveWorkspace(join(home, 'src'), { home })).toEqual({ root: home, mode: 'project' });
  });
});
