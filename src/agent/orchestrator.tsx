// Interactive invocations share one scrolling terminal; print mode runs once.
import { agentLoop } from './loop.js';
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
  alternateScreen?: boolean;
}

export async function orchestrate(opts: OrchestratorOpts): Promise<void> {
  if (opts.workspace !== false && process.stdin.isTTY) {
    // An explicit selection must not prompt for credentials belonging to the
    // saved provider. The selected backend will report its own access errors.
    if (!opts.provider && !opts.model) await ensureWorkspaceSetup({ prompt: renderer.userPrompt, info: renderer.info, open: openProviderPage });
    await runTui(opts);
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
