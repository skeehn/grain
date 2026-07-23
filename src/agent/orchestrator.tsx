// Hybrid orchestrator - use Ink if TTY available, else fallback to simple renderer
import { agentLoop } from './loop.js';
import { runWorkspace } from '../workspace/app.js';
import { runTui } from '../tui/app.js';
import * as renderer from '../tui/renderer.js';
import { ensureWorkspaceSetup, openProviderPage } from '../workspace/setup.js';

export interface OrchestratorOpts {
  prompt?: string;
  autoApprove?: boolean;
  concise?: boolean;
  model?: string;
  provider?: string;
  maxTurns?: number;
  reflect?: boolean;
  resume?: boolean;
  allowDestructive?: boolean;
  benchmark?: boolean;
  attachments?: string[];
  workspace?: boolean;
  classic?: boolean;
}

export async function orchestrate(opts: OrchestratorOpts): Promise<void> {
  if (opts.workspace !== false && process.stdin.isTTY) {
    if (opts.classic) await runWorkspace(opts);
    else {
      await ensureWorkspaceSetup({ prompt: renderer.userPrompt, info: renderer.info, open: openProviderPage });
      await runTui(opts);
    }
    return;
  }
  await agentLoop({
    prompt:      opts.prompt,
    resume:      opts.resume ?? false,
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
