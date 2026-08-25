import type { Tool } from '../providers/types.js';
import type { ModelCapabilities } from './types.js';

const DEFAULT_CONTEXT = 128_000;

/** Select tools at the trust boundary before provider-specific packing. */
export function selectToolsForRun(
  tools: Tool[],
  options: { generalChat?: boolean; benchmarkBridge?: boolean } = {},
): Tool[] {
  if (options.benchmarkBridge) return tools.filter(tool => tool.name === 'bash' || tool.name === 'finish');
  if (options.generalChat) return tools.filter(tool => ['engram', 'ask_user', 'finish'].includes(tool.name));
  return tools;
}

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
      preferredToolNames: ['read', 'grep', 'workspace_scan', 'repo_map', 'patch', 'write', 'bash', 'run_tests', 'plan', 'work_recall', 'finish'],
    };
  }
  if (provider === 'openrouter' || provider === 'xai') {
    // Match the big-context coding models so compaction uses their real window
    // instead of the 128K default (wasting >80% of a 1M window otherwise).
    const contextWindow =
      normalized.includes('qwen3-coder') || normalized.includes('nemotron-3') ? 1_048_576 :
      normalized.includes('laguna') || normalized.includes('qwen3-next') ? 262_144 :
      DEFAULT_CONTEXT;
    return { ...base, contextWindow: provider === 'xai' && normalized.includes('grok') ? 256_000 : contextWindow,
      supportsParallelTools: true, supportsImages: provider === 'xai' && !normalized.includes('code-fast'),
      supportsReasoning: provider === 'xai' || normalized.includes('nemotron'), supportsStructuredOutput: true };
  }
  if (provider === 'anthropic' || provider === 'bedrock') {
    return { ...base, contextWindow: 200_000, supportsParallelTools: true,
      supportsImages: true, supportsReasoning: true, supportsPromptCaching: true };
  }
  // CLI-agent providers run their own tool loop and manage their own context;
  // Grain only sends the turn, so report the child agent's real window instead
  // of the 128K default that made the context gauge read as nearly full.
  if (provider === 'claude-code') {
    return { ...base, contextWindow: 200_000, maxOutputTokens: 64_000, supportsTools: false,
      supportsImages: true, supportsReasoning: true, supportsPromptCaching: true };
  }
  if (provider === 'codex') {
    return { ...base, contextWindow: 272_000, maxOutputTokens: 100_000, supportsTools: false, supportsReasoning: true };
  }
  if (provider === 'opencode') {
    return { ...base, contextWindow: 200_000, maxOutputTokens: 32_000, supportsTools: false };
  }
  if (provider === 'grok') {
    return { ...base, contextWindow: 256_000, maxOutputTokens: 64_000, supportsTools: false,
      supportsImages: true, supportsReasoning: true };
  }
  if (provider === 'ollama' || provider === 'vllm') {
    return { ...base, contextWindow: 32_768, maxOutputTokens: 4_096,
      preferredToolNames: ['read', 'grep', 'patch', 'write', 'bash', 'run_tests', 'finish'] };
  }
  return base;
}
