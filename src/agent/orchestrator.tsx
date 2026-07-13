// Hybrid orchestrator - use Ink if TTY available, else fallback to simple renderer
import { agentLoop } from './loop.js';
import { runWorkspace } from '../workspace/app.js';

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
  attachments?: string[];
  workspace?: boolean;
}

export async function orchestrate(opts: OrchestratorOpts): Promise<void> {
  if (opts.workspace !== false && process.stdin.isTTY) {
    await runWorkspace(opts);
    return;
  }
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
    attachments: opts.attachments,
  });
}
