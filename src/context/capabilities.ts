import type { ModelCapabilities } from './types.js';

const DEFAULT_CONTEXT = 128_000;

export function getModelCapabilities(provider: string, model: string): ModelCapabilities {
  const normalized = model.toLowerCase();
  const base: ModelCapabilities = {
    provider, model, contextWindow: DEFAULT_CONTEXT, maxOutputTokens: 16_384,
    supportsTools: true, supportsParallelTools: false, supportsImages: false,
    supportsReasoning: false, supportsStructuredOutput: false, supportsPromptCaching: false,
  };

  if (provider === 'groq') {
    return { ...base, contextWindow: 131_072, maxOutputTokens: 1_024,
      supportsReasoning: normalized.includes('qwen') || normalized.includes('gpt-oss'),
      supportsStructuredOutput: true,
      preferredToolNames: ['read', 'grep', 'workspace_scan', 'repo_map', 'patch', 'write', 'bash', 'run_tests', 'plan', 'finish'],
    };
  }
  if (provider === 'openrouter') {
    // Match the big-context coding models so compaction uses their real window
    // instead of the 128K default (wasting >80% of a 1M window otherwise).
    const contextWindow =
      normalized.includes('qwen3-coder') || normalized.includes('nemotron-3') ? 1_048_576 :
      normalized.includes('laguna') || normalized.includes('qwen3-next') ? 262_144 :
      DEFAULT_CONTEXT;
    return { ...base, contextWindow,
      supportsParallelTools: true, supportsReasoning: normalized.includes('nemotron'), supportsStructuredOutput: true };
  }
  if (provider === 'anthropic' || provider === 'bedrock') {
    return { ...base, contextWindow: 200_000, supportsParallelTools: true,
      supportsImages: true, supportsReasoning: true, supportsPromptCaching: true };
  }
  if (provider === 'ollama' || provider === 'vllm') {
    return { ...base, contextWindow: 32_768, maxOutputTokens: 4_096,
      preferredToolNames: ['read', 'grep', 'patch', 'write', 'bash', 'run_tests', 'finish'] };
  }
  return base;
}
