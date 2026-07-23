/**
 * Claude Code Plugin
 * 
 * Integrates Anthropic's Claude Code CLI as an agent plugin.
 * Uses print mode (-p) for one-shot tasks with JSON output.
 */

import { spawn } from "child_process";
import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { AgentPlugin, AgentTask, AgentResult, AgentCapability } from "./types.ts";

export function normalizeClaudeResult(parsed: any): any {
  const result = Array.isArray(parsed) ? [...parsed].reverse().find((event: any) => event?.type === 'result') : parsed;
  if (!result || (result.type && result.type !== 'result')) throw new Error('Claude output has no terminal result event');
  return result;
}

export function isClaudeSuccess(result: any, exitReason: AgentResult['exitReason']): boolean {
  const semanticFailure = /credit balance is too low|authentication required|unauthorized|billing/i.test(String(result?.result || ''));
  return result?.subtype === 'success' && result?.is_error !== true && exitReason === 'completed' && !semanticFailure;
}

export class ClaudeCodePlugin implements AgentPlugin {
  name = "claude-code";
  version = "2.x";
  capabilities: AgentCapability[] = [
    "code-review",
    "feature-dev",
    "refactoring",
    "bug-fixing",
    "testing",
    "documentation",
    "debugging",
  ];
  
  supportsPrintMode = true;
  supportsInteractive = true;
  supportsPTY = true;

  private binaryPath: string;
  private defaultModel?: string;

  private subscriptionEnvironment(): NodeJS.ProcessEnv {
    const env = { ...process.env };
    // This adapter represents the installed Claude Code login. Direct API
    // credentials belong to Grain's Anthropic/Bedrock providers and must not
    // silently override a user's Claude subscription inside the child CLI.
    delete env.ANTHROPIC_API_KEY; delete env.ANTHROPIC_AUTH_TOKEN;
    return env;
  }

  constructor(binaryPath = "claude", defaultModel?: string) {
    this.binaryPath = binaryPath;
    this.defaultModel = defaultModel;
  }

  async isInstalled(): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn(this.binaryPath, ["--version"], {
        stdio: "ignore",
        env: this.subscriptionEnvironment(),
      });
      proc.on("close", (code) => resolve(code === 0));
      proc.on("error", () => resolve(false));
    });
  }

  async getVersion(): Promise<string> {
    return new Promise((resolve, reject) => {
      let output = "";
      const proc = spawn(this.binaryPath, ["--version"], {
        stdio: ["ignore", "pipe", "ignore"],
        env: this.subscriptionEnvironment(),
      });
      
      proc.stdout.on("data", (chunk) => {
        output += chunk.toString();
      });
      
      proc.on("close", (code) => {
        if (code === 0) {
          resolve(output.trim());
        } else {
          reject(new Error(`Failed to get version: exit code ${code}`));
        }
      });
      
      proc.on("error", reject);
    });
  }

  async execute(task: AgentTask): Promise<AgentResult> {
    if (task.mode === "oneshot") {
      return this.executePrintMode(task);
    } else {
      throw new Error("Interactive and background modes not yet implemented");
    }
  }

  private async executePrintMode(task: AgentTask): Promise<AgentResult> {
    const args = [
      "-p",  // Print mode
      task.prompt,
      "--output-format", "json",
      "--verbose",
    ];

    // Add constraints
    if (task.constraints?.maxTurns) {
      args.push("--max-turns", task.constraints.maxTurns.toString());
    }
    if (task.constraints?.maxBudgetUSD) {
      args.push("--max-budget-usd", task.constraints.maxBudgetUSD.toString());
    }
    if (task.constraints?.allowedTools) {
      args.push("--allowedTools", task.constraints.allowedTools.join(","));
    }
    
    // Add model preference
    if (task.model || this.defaultModel) {
      args.push("--model", task.model || this.defaultModel!);
    }
    if (task.sandbox === 'read-only') args.push('--permission-mode', 'plan');
    else args.push('--permission-mode', 'acceptEdits');

    // Resume existing session if provided
    if (task.sessionId) {
      args.push("--resume", task.sessionId);
    }

    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      
      const proc = spawn(this.binaryPath, args, {
        cwd: task.workdir,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: task.constraints?.timeoutSeconds
          ? task.constraints.timeoutSeconds * 1000
          : 180_000, // 3 min default
        signal: task.signal,
        env: this.subscriptionEnvironment(),
      });
      const heartbeat = task.onHeartbeat ? setInterval(task.onHeartbeat, 10_000) : undefined;

      proc.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });

      proc.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      proc.on("close", (code, signal) => {
        if (heartbeat) clearInterval(heartbeat);
        // code === null + signal means the process was killed (e.g. timeout)
        const timedOut = code === null && signal !== null;

        // Parse JSON output
        try {
          const parsed = JSON.parse(stdout);
          const result = normalizeClaudeResult(parsed);
          
          const exitReason = this.mapExitReason(result.terminal_reason, result.stop_reason);
          
          resolve({
            success: isClaudeSuccess(result, exitReason),
            output: result.result || "",
            sessionId: result.session_id,
            costUSD: result.total_cost_usd,
            durationMs: result.duration_ms,
            exitReason,
            filesModified: result.files_modified, // If Claude Code provides this
            metadata: {
              numTurns: result.num_turns,
              modelUsage: result.modelUsage,
              stopReason: result.stop_reason,
              terminalReason: result.terminal_reason,
            },
          });
        } catch (err) {
          // JSON parse failed — return raw output
          resolve({
            success: code === 0,
            output: stdout || stderr || `Exit code: ${code}`,
            exitReason: code === 0 ? "completed" : timedOut ? "timeout" : "error",
            metadata: {
              exitCode: code,
              signal,
              rawStderr: stderr,
            },
          });
        }
      });

      proc.on("error", (err) => {
        if (heartbeat) clearInterval(heartbeat);
        resolve({
          success: false,
          output: `Failed to spawn claude: ${err.message}`,
          exitReason: "error",
        });
      });
    });
  }

  private mapExitReason(
    terminalReason: string | undefined,
    stopReason: string | undefined
  ): AgentResult["exitReason"] {
    if (terminalReason === "completed") return "completed";
    if (terminalReason === "error_max_turns") return "max_turns";
    if (terminalReason === "error_budget") return "max_budget";
    if (stopReason === "max_tokens") return "timeout";
    if (stopReason === "end_turn") return "completed";
    return "error";
  }
}
