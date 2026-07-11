// Agent loop - fluid execution with streaming, error recovery, and quality control
import type { Message, ContentBlock } from '../providers/types.js';
import { getProvider } from '../providers/index.js';
import { TOOLS, setToolCwd, destroyShell, registerDynamicTool } from '../tools/index.js';
import { closeMcpClients, discoverMcpTools } from '../mcp/index.js';
import { classifyTaskComplexity, routeModel, explainRouting, resolveModelAlias, MODEL_CONFIGS } from '../router/index.js';
import { trackToolCall, getContextSummary } from './context-tracker.js';
import { getSystemPrompt } from '../system-prompt.js';
import { getModelCapabilities, packContext } from '../context/index.js';
import { LearningLedger } from '../learning/index.js';
import { loadConfig } from '../config.js';
import { createSession, addMessage, getMessages, getLastSession } from '../session/store.js';
import { needsCompaction, compact, engramRetrieve, engramStore } from './context.js';
import * as renderer from '../tui/renderer.js';
import { getSkillManager } from '../skills/manager.js';
import type { SkillMatch } from '../skills/types.js';
import { RunJournal } from '../kernel/index.js';
import { ToolGateway } from '../policy/index.js';

export interface AgentOpts {
  prompt?: string;
  resume?: boolean;
  model?: string;
  provider?: string;
  oneShot?: boolean;
  autoApprove?: boolean;
  concise?: boolean;
  maxTurns?: number;  // override default MAX_TURNS (useful for benchmarking)
  reflect?: boolean;  // post-task self-reflection: store learnings + print summary
  allowDestructive?: boolean;
  benchmark?: boolean;
}

const MAX_TURNS = 30; // Safety limit to prevent infinite loops

// Wrap a provider stream so a stall between events rejects instead of hanging
// forever. A plain flag checked inside `for await` never fires on a stalled
// stream because the loop is blocked on a pending next().
async function* withInactivityTimeout<T>(source: AsyncIterable<T>, ms: number): AsyncGenerator<T> {
  const it = source[Symbol.asyncIterator]();
  try {
    while (true) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`LLM stream timed out (${Math.round(ms / 1000)}s of inactivity). Model may be overloaded — try again.`)),
          ms,
        );
      });
      try {
        const res = await Promise.race([it.next(), timeout]);
        if (res.done) return;
        yield res.value;
      } finally {
        clearTimeout(timer);
      }
    }
  } finally {
    // Never await cleanup: async-generator return() queues behind a pending
    // next(), so on a stalled stream awaiting it would swallow the timeout
    // rejection and hang forever — the exact failure this wrapper prevents.
    try { Promise.resolve(it.return?.()).catch(() => { /* stream already dead */ }); }
    catch { /* stream already dead */ }
  }
}

// ── Reflection ────────────────────────────────────────────────────────────────
// Called after a successful finish. Makes one focused LLM call to surface
// 2-3 learnings from this run, stores them in engram, and prints them.

interface ReflectionContext {
  runId: string;
  task: string;
  outcome: string;
  toolsUsed: string[];
  filesChanged: string[];
  errors: string[];
}

async function runReflection(
  provider: ReturnType<typeof getProvider>,
  ctx: ReflectionContext,
): Promise<void> {
  const { runId, task, outcome, toolsUsed, filesChanged, errors } = ctx;

  const toolSummary  = toolsUsed.length  ? toolsUsed.join(' → ')  : 'none';
  const fileSummary  = filesChanged.length ? filesChanged.join(', ') : 'none';
  const errorSummary = errors.length      ? errors.join('; ')       : 'none';

  const reflectionPrompt = [
    'You just completed this task as an AI coding agent.',
    '',
    `Task: ${task.slice(0, 300)}`,
    `Outcome: ${outcome}`,
    `Tool sequence: ${toolSummary}`,
    `Files changed: ${fileSummary}`,
    `Errors encountered: ${errorSummary}`,
    '',
    'Produce EXACTLY 2-3 concise learnings from this run. Each learning must be:',
    '  - One sentence, ≤ 25 words',
    '  - Actionable ("Always X", "Prefer Y over Z", "When A, do B")',
    '  - About technique, approach, or pitfalls — NOT about the specific task content',
    '',
    'Respond with a JSON object (no markdown fences):',
    '{"learnings": ["...", "...", "..."]}',
  ].join('\n');

  const messages: Message[] = [
    { role: 'user', content: [{ type: 'text', text: reflectionPrompt }] },
  ];

  let raw = '';
  try {
    const spin = renderer.spinner('Reflecting...');
    let stopped = false;
    for await (const event of provider.stream(messages, 'You are a concise technical learning extractor.', [])) {
      if (event.type === 'text_delta') {
        if (!stopped) { spin.stop(); stopped = true; }
        raw += event.text;
      }
    }
    if (!stopped) spin.stop();
  } catch (e: any) {
    // Reflection is best-effort — never block the user
    renderer.dim(`  (reflection skipped: ${e?.message || e})`);
    return;
  }

  // Parse learnings
  let learnings: string[] = [];
  try {
    // Strip markdown fences if model ignores instructions
    const cleaned = raw.replace(/^```[a-z]*\n?/m, '').replace(/```$/m, '').trim();
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed.learnings)) {
      learnings = parsed.learnings.slice(0, 3).filter((l: unknown) => typeof l === 'string' && l.trim());
    }
  } catch {
    // Fallback: extract bullet-like lines if JSON parse fails
    learnings = raw
      .split('\n')
      .map(l => l.replace(/^[-•*\d.]\s*/, '').trim())
      .filter(l => l.length > 20 && l.length < 200)
      .slice(0, 3);
  }

  if (learnings.length === 0) return;

  // Reflections are hypotheses, not facts. Store them as candidates; promotion
  // requires passing evidence from a different run.
  const tags = ['reflection', 'grain-task'];
  if (filesChanged.some(f => f.endsWith('.rs')))               tags.push('rust');
  if (filesChanged.some(f => f.endsWith('.ts') || f.endsWith('.js'))) tags.push('typescript');
  if (filesChanged.some(f => f.endsWith('.go')))               tags.push('go');
  if (filesChanged.some(f => f.endsWith('.py')))               tags.push('python');

  const ledger = new LearningLedger();
  const candidates = learnings.map(learning => ledger.propose('procedure', learning, runId, tags));

  // Print Reflection section
  renderer.newLine();
  renderer.info('Learning candidates (awaiting independent validation):');
  for (const candidate of candidates) {
    renderer.dim(`  • ${candidate.statement} [${candidate.id.slice(0, 8)}]`);
  }
  renderer.newLine();
}

export async function agentLoop(opts: AgentOpts): Promise<void> {
  const config = loadConfig();
  const skillManager = getSkillManager();
  await skillManager.initialize();
  try { for (const remote of await discoverMcpTools()) registerDynamicTool(remote.tool, remote.execute); }
  catch (error: any) { renderer.warn(`MCP discovery failed: ${error.message}`); }

  // Model routing
  let providerName = opts.provider || config.provider;
  let modelName = opts.model || config.model || undefined;

  // Resolve alias (e.g. 'sonnet' → 'us.anthropic.claude-sonnet-4-6')
  if (modelName) {
    const aliasKey = resolveModelAlias(modelName);
    if (aliasKey && MODEL_CONFIGS[aliasKey]) {
      const mc = MODEL_CONFIGS[aliasKey];
      providerName = mc.provider;
      modelName = mc.model;
      renderer.info(`🧠 Forced model → ${mc.label}`);
    }
  }

  if (!opts.model && !opts.provider && !config.model && opts.prompt) {
    const complexity = classifyTaskComplexity(opts.prompt);
    const modelConfig = routeModel(complexity);
    providerName = modelConfig.provider;
    modelName = modelConfig.model;
    renderer.info(`🧠 ${explainRouting(complexity, modelConfig)}`);
  }

  const provider = getProvider(providerName, modelName);
  renderer.info(`Using ${provider.name} / ${provider.model}`);

  const journal = RunJournal.create({ task: opts.prompt || 'interactive session', cwd: process.cwd(),
    provider: provider.name, model: provider.model, policy_profile: opts.benchmark ? 'benchmark' : 'default' });
  journal.transition('running');
  const gateway = new ToolGateway({
    autoApprove: Boolean(opts.autoApprove), allowDestructive: Boolean(opts.allowDestructive),
    benchmark: Boolean(opts.benchmark), interactive: Boolean(process.stdin.isTTY), journal,
    approve: async (name, _input, policy) => {
      const answer = await renderer.userPrompt(`Approve ${policy.risk} tool "${name}"? [y/N] `);
      return answer?.trim().toLowerCase() === 'y' || answer?.trim().toLowerCase() === 'yes';
    },
  });

  // Session management
  let sessionId: string;
  let messages: Message[] = [];

  // Init persistent shell cwd to wherever grain was invoked
  setToolCwd(process.cwd());

  if (opts.resume) {
    const last = await getLastSession();
    if (last) {
      sessionId = last;
      messages = await getMessages(sessionId);
      renderer.info('Resumed session');
    } else {
      sessionId = await createSession();
    }
  } else {
    sessionId = await createSession();
  }

  // Get initial prompt
  if (opts.prompt) {
    messages.push({ role: 'user', content: [{ type: 'text', text: opts.prompt }] });
    await addMessage(sessionId, 'user', [{ type: 'text', text: opts.prompt }]);
  } else if (messages.length === 0) {
    // Non-TTY (subprocess): no prompt = nothing to do, exit cleanly
    if (!process.stdin.isTTY) return;
    const input = await renderer.userPrompt();
    if (input === null) return; // stdin EOF
    if (!input.trim()) {
      renderer.info('Type a command to get started, or Ctrl+C to exit.');
      return agentLoop(opts);
    }
    messages.push({ role: 'user', content: [{ type: 'text', text: input }] });
    addMessage(sessionId, 'user', [{ type: 'text', text: input }]);
  }

  // Main agent loop - fluid execution
  let turnCount = 0;
  const turnLimit = opts.maxTurns ?? MAX_TURNS;
  const sessionErrors: string[] = []; // collected for reflection
  const allToolsUsed: string[] = [];   // accumulated across all turns for reflection
  const allFilesChanged: string[] = []; // accumulated across all turns for reflection

  while (turnCount < turnLimit) {
    turnCount++;

    // Build system prompt with context + skills
    let system = getSystemPrompt(opts.concise, opts.prompt || '');

    const contextSummary = getContextSummary();
    if (contextSummary) {
      system += `\n\n## Session Context\n${contextSummary}`;
    }

    // Resolve the most recent user message text once — used by both MD and JSON skill matching
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user' && m.content.some(b => b.type === 'text'));
    const lastUserText = lastUserMsg
      ? lastUserMsg.content
          .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
          .map(b => b.text)
          .join(' ')
      : undefined;

    // ── Markdown skills: inject top-3 by relevance at turn 1 ─────────────────
    if (turnCount === 1) {
      const mdContext = await skillManager.getMarkdownContext(lastUserText);
      if (mdContext) {
        system += `\n\n${mdContext}`;
        const mdTotal = (await skillManager.listMarkdownSkills()).length;
        const mdShown = (mdContext.match(/^### /gm) ?? []).length;
        renderer.info(`💡 Skills: ${mdShown} of ${mdTotal} md loaded`);
      }
    }

    // ── JSON skills: keyword-matched at turn 1 ────────────────────────────────
    let matchedSkills: SkillMatch[] = [];

    if (lastUserText && turnCount === 1) {
      matchedSkills = await skillManager.matchSkills(lastUserText, 0.6);

      if (matchedSkills.length > 0) {
        system += `\n\n## Relevant Learned Patterns\n`;
        for (const match of matchedSkills.slice(0, 3)) {
          system += `### ${match.skill.name} (${(match.confidence * 100).toFixed(0)}% match)\n`;
          system += `${match.skill.description}\n\n`;
          system += `**Approach:**\n${match.skill.approach}\n\n`;
          if (match.skill.code && match.skill.code.length > 0) {
            system += `**Code patterns:**\n\`\`\`\n${match.skill.code.join('\n')}\n\`\`\`\n\n`;
          }
        }
      }

      // Engram context
      const engramContext = await engramRetrieve(lastUserText);
      if (engramContext.trim()) {
        system += `\n\nRelevant context from memory:\n${engramContext}`;
      }
    }

    // Context compaction
    if (needsCompaction(messages)) {
      messages = compact(messages);
      renderer.warn('Context compacted.');
    }

    // Stream LLM response
    const spin = renderer.spinner('Thinking...');
    const assistantBlocks: ContentBlock[] = [];
    let currentToolId = '';
    let currentToolInputJson = '';
    const toolInputJsonMap = new Map<string, string>();
    let hasToolUse = false;
    let textBuffer = '';
    let spinnerStopped = false;
    const malformedToolIds = new Set<string>();

    try {
      const STREAM_TIMEOUT = 90000; // 90s inactivity (large files take time)
      const capabilities = getModelCapabilities(provider.name, provider.model);
      const packed = packContext(capabilities, [
        { id: `system-${turnCount}`, kind: 'instruction', content: system, priority: 100, required: true,
          source: 'grain-system-prompt' },
        { id: `conversation-${turnCount}`, kind: 'conversation', content: JSON.stringify(messages), priority: 90,
          required: true, source: `session:${sessionId}` },
      ], TOOLS);
      journal.append('model_requested', { turn: turnCount, message_count: messages.length,
        context_manifest: packed.manifest, capabilities });

      for await (const event of withInactivityTimeout(provider.stream(messages, system, packed.tools), STREAM_TIMEOUT)) {
        if (event.type === 'text_delta') {
          if (!spinnerStopped) { spin.stop(); renderer.clearLine(); spinnerStopped = true; }
          textBuffer += event.text;
          renderer.stream(event.text);
        } else if (event.type === 'tool_use_start') {
          hasToolUse = true;
          currentToolId = event.id;
          currentToolInputJson = '';
          toolInputJsonMap.set(event.id, '');
          assistantBlocks.push({
            type: 'tool_use',
            id: event.id,
            name: event.name,
            input: {},
          });
          if (!spinnerStopped) { spin.stop(); renderer.clearLine(); spinnerStopped = true; }
          renderer.tool(event.name, { _streaming: true });
        } else if (event.type === 'tool_use_delta') {
          const toolId = event.id || currentToolId;
          currentToolInputJson = (toolInputJsonMap.get(toolId) || '') + event.input_json;
          toolInputJsonMap.set(toolId, currentToolInputJson);
        } else if (event.type === 'tool_use_end') {
          const toolId = event.id || currentToolId;
          const jsonStr = toolInputJsonMap.get(toolId) || currentToolInputJson;
          if (jsonStr) {
            try {
              const parsed = JSON.parse(jsonStr);
              const block = assistantBlocks.find(b => b.type === 'tool_use' && b.id === toolId) as any;
              if (block) {
                block.input = parsed;
                // Overwrite the "⚡ write..." line with full details now that we have input
                const summary = block.name === 'write' && parsed.path
                  ? `${parsed.path} (${parsed.content ? Buffer.byteLength(parsed.content, 'utf8') : 0} bytes)`
                  : block.name === 'bash' ? (parsed.command?.slice(0, 80) || '')
                  : block.name === 'read' ? (parsed.path || '')
                  : block.name === 'patch' ? (parsed.path || '')
                  : '';
                if (summary) {
                  renderer.dim(`  → ${summary}`);
                }
              }
            } catch (err) {
              renderer.warn(`Failed to parse tool input: ${err}`);
              malformedToolIds.add(toolId);
            }
          }
        } else if (event.type === 'error') {
          throw new Error(event.error);
        } else if (event.type === 'usage') {
          journal.append('usage_recorded', { turn: turnCount, ...event });
        }
      }

      if (!spinnerStopped) spin.stop();
      journal.append('model_completed', { turn: turnCount, has_tool_use: hasToolUse, text_bytes: Buffer.byteLength(textBuffer) });
      if (textBuffer) {
        assistantBlocks.unshift({ type: 'text', text: textBuffer });
      }
      renderer.newLine();

      // If no tool calls, this is a final text response
      if (!hasToolUse) {
        // Never push an empty assistant message — it poisons the history
        // (providers reject messages with empty content on the next call).
        if (assistantBlocks.length > 0) {
          messages.push({ role: 'assistant', content: assistantBlocks });
          addMessage(sessionId, 'assistant', assistantBlocks);
        } else {
          renderer.warn('Provider returned an empty response.');
        }

        if (opts.oneShot) { journal.transition('succeeded'); closeMcpClients(); return; }

        // Interactive: wait for next input
        // If stdin is not a TTY (e.g. subprocess/CI), treat as one-shot and exit
        if (!process.stdin.isTTY) return;

        renderer.newLine();
        let nextInput = await renderer.userPrompt();
        while (nextInput !== null && !nextInput.trim()) nextInput = await renderer.userPrompt();
        if (nextInput === null) return; // stdin EOF
        messages.push({ role: 'user', content: [{ type: 'text', text: nextInput }] });
        addMessage(sessionId, 'user', [{ type: 'text', text: nextInput }]);
        turnCount = 0; // Reset turn counter for new user request
        continue;
      }

      // Execute tools
      const toolResults: ContentBlock[] = [];
      let finishCalled = false;

      for (const block of assistantBlocks) {
        if (block.type !== 'tool_use') continue;

        // Never act on a tool whose input JSON failed to parse — its input is
        // a placeholder {}. This must precede the finish branch: a malformed
        // finish would otherwise silently end the task.
        if (malformedToolIds.has(block.id)) {
          renderer.warn(`Skipping ${block.name}: malformed tool input`);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: 'Tool input was malformed JSON and could not be parsed. Re-issue the tool call.',
            is_error: true,
          });
          continue;
        }

        if (block.name === 'finish') {
          const evidence = Array.isArray(block.input?.evidence)
            ? block.input.evidence.filter((item: unknown) => typeof item === 'string' && item.trim()) : [];
          if (evidence.length === 0) {
            renderer.warn('Finish rejected: verification evidence is required');
            toolResults.push({ type: 'tool_result', tool_use_id: block.id,
              content: 'finish requires at least one concrete verification artifact or command result', is_error: true });
            continue;
          }
          const msg = block.input?.result || block.input?.message || 'Task complete.';
          renderer.success(`✓ ${msg}`);
          finishCalled = true;

          // Record skill success for all matched skills (up to 3)
          if (matchedSkills.length > 0) {
            const toolTrace = assistantBlocks
              .filter(b => b.type === 'tool_use')
              .map((b: any) => b.name)
              .join(' → ');
            await Promise.all(
              matchedSkills.map(m =>
                skillManager.recordExecution(m.skill.id, true, {
                  problem: opts.prompt || 'task',
                  execution: toolTrace,
                  outcome: msg,
                }),
              ),
            );
          }

          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: msg,
            is_error: false,
          });
          break;
        }

        // Execute the tool
        const result = await gateway.execute(block.name, block.input, block.id);
        trackToolCall(block.name, block.input, result);
        // Accumulate for reflection
        allToolsUsed.push(block.name);
        if (block.name === 'write' || block.name === 'patch' || block.name === 'multi_edit') {
          const p = (block.input as any)?.path as string | undefined;
          if (p) allFilesChanged.push(p);
        }

        const resultContent = typeof result.content === 'string'
          ? result.content
          : JSON.stringify(result.content);

        // Show result (truncated for display)
        const displayContent = resultContent.length > 500
          ? resultContent.slice(0, 500) + `\n... (${resultContent.length} chars total)`
          : resultContent;
        renderer.result(displayContent, result.is_error);

        if (result.is_error) {
          sessionErrors.push(resultContent.slice(0, 120));
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: resultContent,
          is_error: result.is_error,
        });
      }

      // Every tool_use block must have a matching tool_result in history —
      // an unanswered block (e.g. tools after an early `finish`) makes the
      // next API call (or a --resume) fail with a 400.
      const answeredIds = new Set(
        toolResults.filter(r => r.type === 'tool_result').map(r => (r as any).tool_use_id),
      );
      for (const block of assistantBlocks) {
        if (block.type === 'tool_use' && !answeredIds.has(block.id)) {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: 'Skipped — task already finished.',
            is_error: false,
          });
        }
      }

      // Push messages
      messages.push({ role: 'assistant', content: assistantBlocks });
      addMessage(sessionId, 'assistant', assistantBlocks);

      if (toolResults.length > 0) {
        messages.push({ role: 'user', content: toolResults });
        addMessage(sessionId, 'user', toolResults);
      }

      // Implicit finish: pure-text response with no tool calls = task done
      if (!finishCalled && toolResults.length === 0) {
        // Treat a bare text response as an implicit finish so --reflect fires
        // and loops don't spin on pure-text completions
        finishCalled = true;
      }

      // If finish was called, handle exit or next input
      if (finishCalled) {
        journal.transition('verifying');
        destroyShell(); // clean up persistent bash session

        // ── Reflection step ───────────────────────────────────────────────────
        if (opts.reflect) {
          const finishBlock = assistantBlocks.find((b: any) => b.type === 'tool_use' && b.name === 'finish') as any;
          await runReflection(provider, {
            runId: journal.metadata.run_id,
            task:         opts.prompt || 'interactive task',
            outcome:      finishBlock?.input?.result || finishBlock?.input?.message || 'Task complete.',
            toolsUsed:    [...new Set(allToolsUsed)],
            filesChanged: [...new Set(allFilesChanged)],
            errors:       [...new Set(sessionErrors)],
          });
        }
        // ─────────────────────────────────────────────────────────────────────

        if (opts.oneShot) { journal.transition('succeeded'); return; }
        journal.transition('running');

        // Non-TTY (subprocess/CI): treat as one-shot
        if (!process.stdin.isTTY) return;

        renderer.newLine();
        let nextInput = await renderer.userPrompt();
        while (nextInput !== null && !nextInput.trim()) nextInput = await renderer.userPrompt();
        if (nextInput === null) return; // stdin EOF
        messages = []; // Fresh context for new task
        messages.push({ role: 'user', content: [{ type: 'text', text: nextInput }] });
        addMessage(sessionId, 'user', [{ type: 'text', text: nextInput }]);
        turnCount = 0;
        continue;
      }

      // Otherwise, loop back to LLM with tool results (fluid execution)
      // The LLM will decide: more tools? done? ask user?

    } catch (err: any) {
      if (!spinnerStopped) spin.stop();
      if (!opts.oneShot) renderer.error(err.message);
      await engramStore(`Error: ${err.message}`, ['error']);
      journal.append(/parse|protocol|malformed/i.test(err.message) ? 'protocol_error' : 'provider_error', { error: err.message, turn: turnCount });
      journal.transition('failed', { error: err.message });
      destroyShell();

      if (opts.oneShot) {
        // Don't crash — log what happened and exit immediately
        const isQuota = /429|quota|rate.?limit|throttl/i.test(err.message);
        const isAuthz = /403|AccessDenied|not available|forbidden/i.test(err.message);
        if (isQuota) {
          renderer.warn('Rate limit hit. Partial work saved to session. Run again to continue.');
        } else if (isAuthz) {
          renderer.warn(`Provider error: ${err.message}`);
        } else {
          renderer.warn(`Task stopped due to error: ${err.message}`);
        }
        throw err;
      }

      renderer.newLine();
      if (!process.stdin.isTTY) break; // non-TTY: don't wait for retry
      const retry = await renderer.userPrompt('Try again? ');
      if (retry === null || !retry.trim() || retry.toLowerCase() === 'n') break;
      turnCount = 0;
    }
  }

  if (turnCount >= turnLimit) {
    renderer.warn(`Reached ${turnLimit} turn limit. Use a more specific prompt or break into smaller tasks.`);
    journal.transition('failed', { error: 'turn_limit', turn_limit: turnLimit });
  }

  renderer.info('Goodbye!');
}
