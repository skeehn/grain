import { describe, expect, test } from 'bun:test';
import { parseComposerInput } from '../src/workspace/app.js';
import { discoverProviders, providerReady, selectProvider } from '../src/workspace/setup.js';
import { workspaceKey } from '../src/session/store.js';

describe('unified workspace', () => {
  test('keeps natural-language text while collecting @file attachments', () => {
    expect(parseComposerInput('review @src/auth.ts and @notes.md')).toEqual({ argument: 'review and', attachments: ['src/auth.ts', 'notes.md'] });
  });

  test('parses discoverable slash controls separately from chat', () => {
    expect(parseComposerInput('/mode plan')).toEqual({ command: 'mode', argument: 'plan', attachments: [] });
    expect(parseComposerInput('/help')).toEqual({ command: 'help', argument: '', attachments: [] });
  });

  test('detects configured providers and keeps workspace resume project-scoped', () => {
    const providers = discoverProviders({ ANTHROPIC_API_KEY: 'key', AWS_REGION: 'us-east-1' }, false);
    expect(providers.find(provider => provider.id === 'anthropic')?.detected).toBe(true);
    expect(providers.find(provider => provider.id === 'bedrock')?.detected).toBe(true);
    expect(providerReady({ provider: 'anthropic' } as any, { ANTHROPIC_API_KEY: 'key' })).toBe(true);
    expect(workspaceKey('/tmp/project')).not.toBe(workspaceKey('/tmp/other-project'));
    expect(workspaceKey('/tmp/project/')).toBe(workspaceKey('/tmp/project'));
  });

  test('keeps attachment-only composer input visible to the workspace', () => {
    expect(parseComposerInput('@notes.md')).toEqual({ argument: '', attachments: ['notes.md'] });
  });

  test('accepts only explicit provider choices, while retaining the blank default', () => {
    const providers = discoverProviders({ ANTHROPIC_API_KEY: 'key' }, false);
    expect(selectProvider(providers, '')?.id).toBe('anthropic');
    expect(selectProvider(providers, 'anthropic')?.id).toBe('anthropic');
    expect(selectProvider(providers, '2')?.id).toBe('anthropic');
    expect(selectProvider(providers, '0')).toBeUndefined();
    expect(selectProvider(providers, 'unknown')).toBeUndefined();
  });
});
