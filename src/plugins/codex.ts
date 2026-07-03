/**
 * Codex Plugin
 * 
 * Integrates OpenAI's Codex CLI as an agent plugin.
 * Uses exec mode for one-shot tasks with proper JSONL parsing.
 */

import { spawn } from "child_process";
import type { AgentPlugin, AgentTask, AgentResult, AgentCapability } from "./types.ts";

interface CodexEvent {
  type: string;
  [key: string]: any;
}

interface CodexUsage {
  input_tokens: number;
  cached_input_tokens?: number;
  output_tokens: number;
  reasoning_output_tokens?: number;
}

export class CodexPlugin implements AgentPlugin {
  name = "codex";
  version = "1.x";
  capabilities: AgentCapability[] = [
    "feature-dev",
    "bug-fixing",
    "refactoring",
    "testing",
  ];
  
  supportsPrintMode = true;
  supportsInteractive = false;
  supportsPTY = true;

  private binaryPath: string;

  constructor(binaryPath = "codex") {
    this.binaryPath = binaryPath;
  }

  async isInstalled(): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn(this.binaryPath, ["--version"], {
        stdio: "ignore",
      });
      proc.on("close", (code: number | null) => resolve(code === 0));
      proc.on("error", () => resolve(false));
    });
  }

  async getVersion(): Promise<string> {
    return new Promise((resolve, reject) => {
      let output = "";
      const proc = spawn(this.binaryPath, ["--version"], {
        stdio: ["ignore", "pipe", "ignore"],
      });
      
      proc.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString();
      });
      
      proc.on("close", (code: number | null) => {
        if (code === 0) {
          resolve(output.trim());
        } else {
          reject(new Error(`Failed to get version: exit code ${code}`));
        }
      });
      
      proc.on("error", (err: Error) => reject(err));
    });
  }

  async execute(task: AgentTask): Promise<AgentResult> {
    if (task.mode !== "oneshot") {
      throw new Error("Only oneshot mode supported for Codex");
    }

    return this.executeExecMode(task);
  }

  private async executeExecMode(task: AgentTask): Promise<AgentResult> {
    const args = [
      "exec",
      "--json",  // Output JSONL events for structured parsing
      "--skip-git-repo-check",  // Allow running outside git repos
      task.prompt,
    ];

    const startTime = Date.now();

    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      
      const proc = spawn(this.binaryPath, args, {
        cwd: task.workdir,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: task.constraints?.timeoutSeconds
          ? task.constraints.timeoutSeconds * 1000
          : 180_000,
      });

      proc.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      proc.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      proc.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
        const durationMs = Date.now() - startTime;

        // Parse JSONL output
        const parsed = this.parseJSONL(stdout);

        // code === null + signal means the process was killed (e.g. timeout)
        const timedOut = code === null && signal !== null;

        resolve({
          success: code === 0,
          output: parsed.summary,
          costUSD: parsed.cost ?? undefined,
          durationMs,
          filesModified: parsed.filesModified,
          exitReason: code === 0 ? "completed" : timedOut ? "timeout" : "error",
          metadata: {
            exitCode: code,
            rawStderr: stderr.slice(0, 1000),
            inputTokens: parsed.usage?.input_tokens,
            outputTokens: parsed.usage?.output_tokens,
            cachedTokens: parsed.usage?.cached_input_tokens,
            threadId: parsed.threadId,
          },
        });
      });

      proc.on("error", (err: Error) => {
        const durationMs = Date.now() - startTime;
        resolve({
          success: false,
          output: `Failed to spawn codex: ${err.message}`,
          durationMs,
          exitReason: "error",
        });
      });
    });
  }

  /**
   * Parse JSONL output from codex --json
   * 
   * Event types:
   * - thread.started: {thread_id}
   * - turn.started: beginning of agent turn
   * - item.completed: {item: {type, text?}} - agent messages, file edits, commands
   * - turn.completed: {usage: {input_tokens, output_tokens, ...}}
   */
  private parseJSONL(jsonl: string): {
    summary: string;
    usage: CodexUsage | null;
    cost: number | null;
    filesModified: string[];
    threadId: string | null;
  } {
    const lines = jsonl.trim().split('\n').filter(l => l.trim());
    const events: CodexEvent[] = [];
    
    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        events.push(event);
      } catch (err) {
        // Skip malformed lines
      }
    }

    // Extract key information
    const threadStarted = events.find(e => e.type === 'thread.started');
    const turnCompleted = events.find(e => e.type === 'turn.completed');
    const itemsCompleted = events.filter(e => e.type === 'item.completed');

    // Build summary from agent messages
    const messages = itemsCompleted
      .filter(e => e.item?.type === 'agent_message')
      .map(e => e.item?.text)
      .filter(Boolean);

    // Extract file changes.
    // The codex CLI emits `file_change` items with a `changes: [{path}]` array;
    // older/legacy shape is `file_edit` items with a flat `path` field.
    const fileEdits = itemsCompleted.flatMap(e => {
      const item = e.item;
      if (!item) return [];
      if (item.type === 'file_edit') {
        return item.path ? [item.path] : [];
      }
      if (item.type === 'file_change') {
        return (item.changes ?? [])
          .map((c: any) => c?.path)
          .filter(Boolean);
      }
      return [];
    });

    // Extract usage
    const usage: CodexUsage | null = turnCompleted?.usage || null;

    // Calculate cost (approximate: $0.003 per 1K input tokens, $0.015 per 1K output)
    let cost: number | null = null;
    if (usage) {
      const inputCost = ((usage.input_tokens - (usage.cached_input_tokens || 0)) / 1000) * 0.003;
      const cachedCost = ((usage.cached_input_tokens || 0) / 1000) * 0.0003; // 10x cheaper
      const outputCost = (usage.output_tokens / 1000) * 0.015;
      cost = inputCost + cachedCost + outputCost;
    }

    // Build human-readable summary
    let summary = messages.join('\n\n');
    
    if (fileEdits.length > 0) {
      summary += `\n\n📝 Modified files:\n${fileEdits.map(f => `  - ${f}`).join('\n')}`;
    }
    
    if (usage) {
      const totalTokens = usage.input_tokens + usage.output_tokens;
      summary += `\n\n💰 Usage: ${totalTokens.toLocaleString()} tokens ($${cost?.toFixed(4) || '?'})`;
    }

    if (!summary) {
      summary = "Codex completed (no output captured)";
    }

    return {
      summary,
      usage,
      cost,
      filesModified: fileEdits,
      threadId: threadStarted?.thread_id || null,
    };
  }
}
