// Hybrid orchestrator - use Ink if TTY available, else fallback to simple renderer
import { agentLoop } from './loop.js';

export interface OrchestratorOpts {
  prompt?: string;
  autoApprove?: boolean;
  concise?: boolean;
  model?: string;
  provider?: string;
  maxTurns?: number;
  reflect?: boolean;
  allowDestructive?: boolean;
  benchmark?: boolean;
}

export async function orchestrate(opts: OrchestratorOpts): Promise<void> {
  // For Phase 1, use the existing loop but enhance it
  // Ink TUI will come in Phase 1B after we verify basic functionality
  
  await agentLoop({
    prompt:      opts.prompt,
    resume:      false,
    model:       opts.model,
    provider:    opts.provider,
    oneShot:     !!opts.prompt,
    autoApprove: opts.autoApprove,
    concise:     opts.concise,
    maxTurns:    opts.maxTurns,
    reflect:     opts.reflect,
    allowDestructive: opts.allowDestructive,
    benchmark: opts.benchmark,
  });
}
