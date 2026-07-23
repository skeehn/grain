import { describe, expect, test } from 'bun:test';
import { MODEL_CONFIGS, resolveModelForProvider, resolveModelAlias } from '../src/router/index.js';
import { CLI_AGENT_PROVIDERS, VALID_PROVIDERS, validateConfig } from '../src/config.js';
import { providerReady, discoverProviders, selectProvider } from '../src/workspace/setup.js';

const config = (over: Record<string, unknown> = {}) => ({
  schemaVersion: 3 as const, provider: 'claude-code', model: null, engram_db: '~/.engram/knowledge',
  max_tokens: 180_000, ...over,
} as any);

describe('model selection does not override the user', () => {
  test('an alias never rewrites an explicitly chosen provider', () => {
    // `--provider claude-code --model opus` used to resolve to Bedrock, which
    // fails outright for anyone without AWS credentials.
    expect(resolveModelForProvider('claude-code', 'opus')).toEqual({ provider: 'claude-code', model: 'opus' });
    expect(resolveModelForProvider('codex', 'sonnet')).toEqual({ provider: 'codex', model: 'sonnet' });
    expect(resolveModelForProvider('openrouter', 'best')).toEqual({ provider: 'openrouter', model: 'best' });
  });

  test('an alias still resolves fully when no provider was chosen', () => {
    const resolved = resolveModelForProvider(undefined, 'opus');
    expect(resolved.provider).toBe(MODEL_CONFIGS.opus.provider);
    expect(resolved.model).toBe(MODEL_CONFIGS.opus.model);
    expect(resolveModelAlias('opus')).toBe('opus');
  });

  test('an unknown model is passed through untouched', () => {
    expect(resolveModelForProvider('ollama', 'qwen2.5-coder:7b')).toEqual({ provider: 'ollama', model: 'qwen2.5-coder:7b' });
  });
});

describe('subscription providers are first-class', () => {
  test('every CLI-agent provider is a selectable provider', () => {
    for (const provider of CLI_AGENT_PROVIDERS) expect(VALID_PROVIDERS).toContain(provider);
  });

  test('a subscription provider validates without any Grain-managed API key', () => {
    // Requiring a key here locked subscription users out of their own agent.
    for (const provider of CLI_AGENT_PROVIDERS) {
      expect(validateConfig(config({ provider })).valid).toBe(true);
    }
  });

  test('an API provider still reports its missing key', () => {
    const previous = process.env.XAI_API_KEY;
    delete process.env.XAI_API_KEY;
    try {
      const result = validateConfig(config({ provider: 'xai' }));
      expect(result.valid).toBe(false);
      expect(result.error).toContain('XAI_API_KEY');
    } finally { if (previous !== undefined) process.env.XAI_API_KEY = previous; }
  });

  test('setup treats a signed-in CLI as ready and offers it as the default', () => {
    expect(providerReady(config({ provider: 'claude-code' }), {})).toBe(true);
    const providers = discoverProviders({}, false, ['claude-code']);
    expect(providers.some(provider => provider.id === 'claude-code' && provider.detected)).toBe(true);
    expect(selectProvider(providers, '')?.id).toBe('claude-code');
  });

  test('setup still lists API providers by their original numbers', () => {
    const providers = discoverProviders({ ANTHROPIC_API_KEY: 'key' }, false, ['claude-code']);
    expect(selectProvider(providers, '2')?.id).toBe('anthropic');
    expect(selectProvider(providers, 'claude-code')?.id).toBe('claude-code');
  });
});
