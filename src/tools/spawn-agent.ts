/**
 * spawn_agent Tool
 * 
 * Allows grain to delegate tasks to external coding agents like
 * Claude Code, Codex, Aider, etc.
 */

import type { ExecutableTool, ToolResult } from "../providers/types.js";
import type { PluginRegistry } from "../plugins/registry.js";
import type { AgentTask } from "../plugins/types.js";
import { normalizeProvider } from "../config.js";

export function createSpawnAgentTool(registry: PluginRegistry): ExecutableTool {
  return {
    name: "spawn_agent",
    description: `Spawn a specialized coding agent to handle a subtask.

Available agents are auto-detected from installed binaries. Use this when:
- A task benefits from a different agent's specialty (e.g., Claude Code for reviews)
- Work can run in parallel with isolated state
- You want to delegate a self-contained subtask

The agent runs in one-shot mode and returns results when complete.

Example:
{
  "agent": "claude-code",
  "task": "Review auth.py for security issues",
  "workdir": "./src",
  "max_turns": 5
}`,
    
    input_schema: {
      type: "object",
      properties: {
        agent: {
          type: "string",
          description: "Which agent to spawn. Options: claude-code, codex, grok (grokbot), opencode, hermes, or 'auto' to route automatically",
        },
        task: {
          type: "string",
          description: "Natural language task description for the agent",
        },
        workdir: {
          type: "string",
          description: "Working directory (default: current directory)",
        },
        max_turns: {
          type: "number",
          description: "Maximum agent loop iterations",
        },
        max_budget_usd: {
          type: "number",
          description: "Maximum cost in USD",
        },
        allowed_tools: {
          type: "array",
          items: { type: "string" },
          description: "Tool whitelist (agent-specific syntax)",
        },
        timeout_seconds: {
          type: "number",
          description: "Timeout in seconds (default: 180)",
        },
      },
      required: ["agent", "task"],
    },

    async execute(input: any): Promise<ToolResult> {
      try {
        const task: AgentTask = {
          prompt: input.task,
          workdir: input.workdir || process.cwd(),
          mode: "oneshot",
          constraints: {
            maxTurns: input.max_turns,
            maxBudgetUSD: input.max_budget_usd,
            allowedTools: input.allowed_tools,
            timeoutSeconds: input.timeout_seconds || 180,
          },
        };

        let result: any;

        const agent = input.agent === 'auto' ? 'auto' : normalizeProvider(String(input.agent || ''));
        if (agent === "auto") {
          // Auto-route based on task content
          result = await registry.execute(task);
        } else {
          // Use specified agent
          const plugin = registry.getPlugin(agent);
          if (!plugin) {
            const available = (await registry.discoverInstalled()).map(p => p.name);
            return {
              content: `Agent "${agent}" not found.\n\nInstalled agents: ${available.join(", ") || "none"}`,
              is_error: true,
            };
          }

          if (!(await plugin.isInstalled())) {
          return {
            content: `Agent "${agent}" is registered but not installed on this system.`,
            is_error: true,
          };
          }

          result = await plugin.execute(task);
        }

        // Format result for grain's context
        const summary = [
          `Agent: ${result.agent || input.agent}`,
          result.routingReason ? `Routing: ${result.routingReason}` : null,
          `Status: ${result.success ? "✓ Success" : "✗ Failed"}`,
          result.exitReason ? `Exit: ${result.exitReason}` : null,
          result.costUSD ? `Cost: $${result.costUSD.toFixed(4)}` : null,
          result.durationMs ? `Duration: ${(result.durationMs / 1000).toFixed(1)}s` : null,
          result.filesModified?.length
            ? `Files modified: ${result.filesModified.length}`
            : null,
          "",
          "Output:",
          result.output,
        ]
          .filter(Boolean)
          .join("\n");

        return {
          content: summary,
          is_error: !result.success,
        };
      } catch (err: any) {
        return {
          content: `spawn_agent error: ${err.message}\n${err.stack || ""}`,
          is_error: true,
        };
      }
    },
  };
}
