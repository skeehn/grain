# grain Plugin System

grain is a multi-agent orchestrator that can discover, route to, and coordinate with external coding agents.

## Local Model Hosting with vLLM

grain supports local model hosting via vLLM for fully private, self-hosted AI coding.

### Setup

1. **Install vLLM:**
   ```bash
   pip install vllm
   ```

2. **Start vLLM server:**
   ```bash
   # Basic
   vllm serve meta-llama/Llama-3-70B-Instruct --port 8000
   
   # With GPU optimization
   vllm serve meta-llama/Llama-3-70B-Instruct \
     --port 8000 \
     --tensor-parallel-size 2 \
     --gpu-memory-utilization 0.9
   
   # With quantization
   vllm serve TheBloke/Llama-3-70B-Instruct-AWQ \
     --port 8000 \
     --quantization awq
   ```

3. **Configure grain:**
   ```json
   {
     "provider": "vllm",
     "model": "meta-llama/Llama-3-70B-Instruct",
     "vllm": {
       "endpoint": "http://localhost:8000",
       "apiKey": "optional-if-server-requires-it"
     }
   }
   ```

4. **Run grain:**
   ```bash
   grain "Refactor auth.py to use async/await"
   ```

### Recommended Models

| Model | Size | Use Case | Hardware |
|-------|------|----------|----------|
| Llama-3-70B-Instruct | 70B | Full-featured coding | 2x A100 40GB |
| Llama-3-8B-Instruct | 8B | Fast iteration, simple tasks | 1x RTX 3090 |
| DeepSeek-Coder-33B | 33B | Code-specific tasks | 1x A100 40GB |
| CodeLlama-34B | 34B | Legacy codebases | 1x A100 40GB |

### Benefits

✅ **100% Private** — No data leaves your machine  
✅ **Zero API costs** — Run unlimited tasks  
✅ **Custom models** — Fine-tune for your codebase  
✅ **High throughput** — vLLM's PagedAttention is fast  

### Remote vLLM

You can also point grain at a remote vLLM server:

```json
{
  "provider": "vllm",
  "model": "meta-llama/Llama-3-70B-Instruct",
  "vllm": {
    "endpoint": "https://your-vllm-server.example.com",
    "apiKey": "your-api-key"
  }
}
```

This is useful for:
- Centralized inference for a team
- GPU servers in data center while using grain on laptop
- Cloud-hosted vLLM (Runpod, Lambda Labs, etc.)

---

---

## Multi-Agent Plugins

grain's plugin system allows it to orchestrate external coding agents like **Claude Code**, **Codex**, **Aider**, and others. This makes grain a universal orchestrator that can route tasks to the best-suited agent.

### Available Plugins

**Built-in:**
- `claude-code` — Uses `claude-code -p` in print mode for code review and refactoring
- `codex` — Uses `codex exec` for feature development and rapid prototyping

**Coming Soon:**
- `aider` — Multi-file edits with awareness
- `grain-native` — Fall back to grain's own tools

---

## Model Context Protocol (MCP)

grain has native MCP support for connecting to external tools and services.

### Computer Use (Desktop Automation)

Connect grain to a Computer Use MCP server for GUI automation:

**1. Configure MCP server in ~/.grain/mcp.json:**

```json
{
  "servers": {
    "computer-use": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "computer-use-mcp@1.8.0"],
      "trust": {
        "enabled": true,
        "allowTools": ["computer"]
      }
    }
  }
}
```

**2. Use naturally:**

```bash
# Take screenshots
grain "Take a screenshot of my desktop and describe what's on it"

# Control applications
grain "Open Safari and navigate to github.com/skeehn/grain"

# Automate workflows
grain "Find the Submit button on this form and click it"

# Test UI
grain "Verify the login button appears after entering credentials"
```

**Available Tool:**
- `mcp__computer-use__computer` — Take screenshots and perform explicitly requested mouse/keyboard actions.

MCP tools are disabled unless both `trust.enabled` is true and the remote tool name appears in `trust.allowTools`.

### Other MCP Servers

grain works with any MCP-compatible server. Popular options:

**Filesystem:**
```json
{
  "servers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/allowed/dir"],
      "trust": {
        "enabled": true,
        "allowTools": ["read_file", "read_text_file", "list_directory", "search_files"]
      }
    }
  }
}
```

**Git:**
```json
{
  "servers": {
    "git": {
      "command": "uvx",
      "args": ["mcp-server-git", "--repository", "/path/to/repository"],
      "trust": {
        "enabled": true,
        "allowTools": ["git_status", "git_diff_unstaged", "git_diff_staged", "git_log"]
      }
    }
  }
}
```

**GitHub:**
```json
{
  "servers": {
    "github": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "-e", "GITHUB_PERSONAL_ACCESS_TOKEN", "ghcr.io/github/github-mcp-server"],
      "trust": {
        "enabled": true,
        "allowTools": ["get_file_contents", "search_code", "list_commits"],
        "inheritEnv": ["PATH", "HOME", "GITHUB_PERSONAL_ACCESS_TOKEN"]
      }
    }
  }
}
```

**Custom MCP servers** — Build your own following the [MCP specification](https://modelcontextprotocol.io).

---

The plugin system consists of:

1. **AgentPlugin Interface** — defines how grain communicates with external agents
2. **PluginRegistry** — discovers installed agents and routes tasks
3. **spawn_agent Tool** — LLM-accessible tool for delegating subtasks
4. **Config System** — user preferences and routing rules

## Quick Start

### For Users

Check which agents are installed:
```bash
grain agents status  # Coming soon
```

Configure your preferences in `~/.grain/config.json`:
```json
{
  "plugins": {
    "plugins": {
      "claude-code": {
        "enabled": true,
        "defaultModel": "sonnet",
        "maxBudgetPerTask": 5.0,
        "preferredFor": ["code-review", "refactoring"]
      },
      "codex": {
        "enabled": true,
        "maxBudgetPerTask": 3.0,
        "preferredFor": ["feature-dev", "bug-fixing"]
      }
    },
    "routing": {
      "prefer": "claude-code",
      "fallback": ["codex", "grain-native"],
      "routeByCapability": true
    }
  }
}
```

Use in natural language:
```bash
grain --yes "Use Claude Code to review the auth module for security issues"
# grain automatically routes to claude-code plugin

grain --yes "spawn codex to quickly fix the bug in server.py"
# grain delegates to codex plugin
```

### For Plugin Developers

Create a new plugin in `src/plugins/your-agent.ts`:

```typescript
import { spawn } from "child_process";
import type { AgentPlugin, AgentTask, AgentResult, AgentCapability } from "./types.js";

export class YourAgentPlugin implements AgentPlugin {
  name = "your-agent";
  version = "1.0.0";
  capabilities: AgentCapability[] = [
    "feature-dev",
    "bug-fixing",
  ];
  
  supportsPrintMode = true;
  supportsInteractive = false;
  supportsPTY = false;

  async isInstalled(): Promise<boolean> {
    // Check if binary exists
    return new Promise((resolve) => {
      const proc = spawn("your-agent", ["--version"], {
        stdio: "ignore",
        shell: true,
      });
      proc.on("close", (code: number) => resolve(code === 0));
      proc.on("error", () => resolve(false));
    });
  }

  async getVersion(): Promise<string> {
    // Return agent version
    return "1.0.0";
  }

  async execute(task: AgentTask): Promise<AgentResult> {
    // Execute the task with your agent
    const startTime = Date.now();
    
    return new Promise((resolve) => {
      let stdout = "";
      const proc = spawn("your-agent", ["run", task.prompt], {
        cwd: task.workdir,
        stdio: ["ignore", "pipe", "pipe"],
      });

      proc.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      proc.on("close", (code: number) => {
        resolve({
          success: code === 0,
          output: stdout,
          durationMs: Date.now() - startTime,
          exitReason: code === 0 ? "completed" : "error",
        });
      });
    });
  }
}
```

Register it in `src/plugins/index.ts`:
```typescript
export * from "./your-agent.js";
```

Then wire it up in the registry initialization.

## AgentPlugin Interface

### Required Properties

```typescript
interface AgentPlugin {
  name: string;                    // Unique identifier
  version: string;                 // Plugin version
  capabilities: AgentCapability[]; // What the agent is good at
  
  supportsPrintMode: boolean;      // One-shot non-interactive mode
  supportsInteractive: boolean;    // Multi-turn conversation mode
  supportsPTY: boolean;            // Requires pseudo-terminal
}
```

### Capabilities

```typescript
type AgentCapability =
  | "code-review"
  | "feature-dev"
  | "refactoring"
  | "bug-fixing"
  | "testing"
  | "documentation"
  | "debugging"
  | "optimization";
```

grain uses capabilities for smart routing. When a task mentions "review", it routes to agents with `"code-review"` capability.

### Required Methods

#### isInstalled()

Check if the agent binary is available on the system.

```typescript
async isInstalled(): Promise<boolean>
```

Return `true` if the agent can be executed, `false` otherwise. This is called during agent discovery.

#### getVersion()

Get the installed version of the agent.

```typescript
async getVersion(): Promise<string>
```

Return the version string (e.g., "2.1.0"). Used for debugging and health checks.

#### execute(task)

Execute a task with the agent.

```typescript
async execute(task: AgentTask): Promise<AgentResult>
```

**AgentTask:**
```typescript
interface AgentTask {
  prompt: string;                  // Natural language task description
  workdir: string;                 // Working directory
  context?: string[];              // Additional files/context
  mode: "oneshot" | "interactive" | "background";
  
  constraints?: {
    maxTurns?: number;             // Limit agent loop iterations
    maxBudgetUSD?: number;         // Cost cap
    allowedTools?: string[];       // Tool whitelist
    timeoutSeconds?: number;       // Execution timeout
  };
  
  sessionId?: string;              // Resume existing session
}
```

**AgentResult:**
```typescript
interface AgentResult {
  success: boolean;                // Task succeeded?
  output: string;                  // Summary or full output
  filesModified?: string[];        // Files changed by agent
  sessionId?: string;              // For resumption
  costUSD?: number;                // Cost incurred
  durationMs?: number;             // Time taken
  exitReason?: "completed" | "error" | "timeout" | "max_turns" | "max_budget";
  metadata?: Record<string, any>; // Agent-specific data
}
```

## Routing

grain routes tasks to agents based on:

1. **Custom Rules** — regex patterns in config
2. **Preferred Agent** — default choice from config
3. **Capability Matching** — inferred from task keywords
4. **Fallback Chain** — ordered list of alternatives

### Routing Example

Task: "Review the auth module for security issues"

1. Check custom rules → no match
2. Capability matching → detects "review" → filters to agents with `"code-review"`
3. Prefer `claude-code` from config → has `"code-review"` → **route to Claude Code**

Task: "Quick feature: add a logout button"

1. Check custom rules → no match
2. Capability matching → detects "feature" → filters to agents with `"feature-dev"`
3. Prefer `claude-code` → has `"feature-dev"`, but `codex` is `preferredFor: ["feature-dev"]` → **route to Codex** (wins via preferred capability)

### Custom Routing Rules

In `~/.grain/config.json`:

```json
{
  "plugins": {
    "routing": {
      "rules": [
        {
          "pattern": "review|audit|security",
          "agent": "claude-code",
          "priority": 10
        },
        {
          "pattern": "quick|fast|hotfix",
          "agent": "codex",
          "priority": 5
        }
      ]
    }
  }
}
```

Rules are checked in priority order (highest first). First match wins.

## spawn_agent Tool

The `spawn_agent` tool is exposed to grain's LLM, allowing it to delegate subtasks dynamically.

### Usage from LLM

```json
{
  "name": "spawn_agent",
  "input": {
    "agent": "claude-code",
    "task": "Review auth.py for security vulnerabilities",
    "workdir": "./src",
    "max_turns": 5,
    "max_budget_usd": 2.0,
    "allowed_tools": ["Read", "Bash"]
  }
}
```

### Auto-Routing

Set `"agent": "auto"` to let grain pick the best agent:

```json
{
  "name": "spawn_agent",
  "input": {
    "agent": "auto",
    "task": "Fix the bug in server.py"
  }
}
```

grain analyzes the task and routes it using the capability system.

## Built-in Plugins

### Claude Code Plugin

**Agent:** `claude-code`  
**Binary:** `claude` (from `@anthropic-ai/claude-code`)  
**Modes:** Print (one-shot with JSON output)  
**Capabilities:** code-review, feature-dev, refactoring, bug-fixing, testing, documentation, debugging

**Features:**
- JSON output parsing for structured results
- Cost tracking via `total_cost_usd`
- Session resumption via `--resume`
- Tool whitelisting via `--allowedTools`

**Example output:**
```json
{
  "success": true,
  "output": "Reviewed auth.py. Found 3 security issues:\n...",
  "sessionId": "75e2167f-...",
  "costUSD": 0.0787,
  "durationMs": 10276,
  "exitReason": "completed",
  "metadata": {
    "numTurns": 3,
    "modelUsage": { "claude-sonnet-4-6": { "costUSD": 0.078 } }
  }
}
```

### Codex Plugin

**Agent:** `codex`  
**Binary:** `codex` (from OpenAI)  
**Modes:** Exec (one-shot with `--full-auto`)  
**Capabilities:** feature-dev, bug-fixing, refactoring, testing

**Features:**
- Sandboxed execution with auto-approval of file changes
- Fast iteration for feature work
- No explicit cost tracking (OpenAI billing)

### Adding Aider, OpenCode, etc.

Follow the same pattern:

1. Create `src/plugins/aider.ts`
2. Implement the `AgentPlugin` interface
3. Export from `src/plugins/index.ts`
4. Register in the PluginRegistry initialization

## Configuration

Full config schema for `~/.grain/config.json`:

```json
{
  "provider": "bedrock",
  "model": null,
  "engram_db": "~/.engram/knowledge",
  "max_tokens": 180000,
  
  "plugins": {
    "plugins": {
      "claude-code": {
        "enabled": true,
        "binaryPath": "/usr/local/bin/claude",
        "defaultModel": "sonnet",
        "maxBudgetPerTask": 5.0,
        "preferredFor": ["code-review", "refactoring"]
      },
      "codex": {
        "enabled": true,
        "binaryPath": "/usr/local/bin/codex",
        "maxBudgetPerTask": 3.0,
        "preferredFor": ["feature-dev", "bug-fixing"]
      },
      "aider": {
        "enabled": false
      }
    },
    "routing": {
      "prefer": "claude-code",
      "fallback": ["codex", "grain-native"],
      "routeByCapability": true,
      "rules": [
        {
          "pattern": "review|audit",
          "agent": "claude-code",
          "priority": 10
        }
      ]
    }
  }
}
```

### Per-Plugin Options

- `enabled` — toggle plugin on/off
- `binaryPath` — override default binary location
- `defaultModel` — model preference for the agent (agent-specific)
- `maxBudgetPerTask` — cost cap per spawn
- `preferredFor` — boost routing score for these capabilities

## Pair Programming Mode

Coming soon: `--pair-with <agent>` CLI flag.

```bash
# grain plans, Claude Code implements
grain --pair-with claude-code "Build a REST API for user auth"

# grain orchestrates, Codex executes
grain --pair-with codex "Fix all linting errors"

# Auto-select best agent per subtask
grain --pair-with auto "Refactor the database layer and add tests"
```

In pair mode, grain:
1. Analyzes the task and creates a plan
2. Delegates implementation steps to the paired agent
3. Reviews results and decides next steps
4. Iterates until task complete

## Team Mode

Coming soon: Multi-agent workflows.

### Team Configuration

`~/.grain/teams.json`:
```json
{
  "teams": {
    "fullstack": {
      "agents": {
        "backend": {
          "agent": "codex",
          "focus": "Python, FastAPI, PostgreSQL"
        },
        "frontend": {
          "agent": "claude-code",
          "focus": "React, TypeScript, Tailwind"
        },
        "reviewer": {
          "agent": "claude-code",
          "model": "opus",
          "focus": "Security, performance"
        }
      },
      "workflow": {
        "feature": ["backend", "frontend", "reviewer"],
        "bugfix": ["backend", "reviewer"]
      }
    }
  }
}
```

### Usage

```bash
grain team fullstack "Add OAuth login"
# → backend agent builds API
# → frontend agent builds UI
# → reviewer agent audits both
```

## Best Practices

### Plugin Development

1. **Fail Fast** — Return `isInstalled() = false` immediately if binary missing
2. **Parse JSON** — Prefer structured output over raw text
3. **Cost Tracking** — Extract cost data when the agent provides it
4. **Timeout** — Respect `task.constraints.timeoutSeconds` to prevent hangs
5. **Error Messages** — Return actionable errors in `AgentResult.output`

### Configuration

1. **Start Conservative** — Enable only agents you've tested
2. **Set Budget Caps** — Use `maxBudgetPerTask` to prevent runaway costs
3. **Tune Routing** — Add custom rules for your most common patterns
4. **Monitor Performance** — Check which agents succeed for which tasks

### LLM Usage

grain's LLM can call `spawn_agent` directly. It will:
- Automatically route with `agent: "auto"`
- Respect your config preferences
- Choose based on task keywords and capabilities

You don't need to teach grain about agents — it discovers and routes automatically.

## Troubleshooting

### Agent Not Found

```
Agent "codex" not found.
Installed agents: claude-code
```

**Fix:** Install the agent or set `enabled: false` in config.

### Agent Installed But Not Detected

```
Agent "codex" is registered but not installed on this system.
```

**Fix:** Check that the binary is in your PATH. Try `which codex`. Set `binaryPath` in config if needed.

### Routing to Wrong Agent

**Fix:** Add a custom routing rule with higher priority, or adjust `preferredFor` capabilities.

### High Costs

**Fix:** Set `maxBudgetPerTask` lower, or switch `prefer` to a cheaper agent like `codex` for routine tasks.

## Roadmap

- [ ] Interactive mode support for ClaudeCodePlugin (tmux orchestration)
- [ ] Aider plugin
- [ ] OpenCode plugin
- [ ] `grain agents status` CLI command
- [ ] `--pair-with` mode
- [ ] Team mode with `~/.grain/teams.json`
- [ ] Plugin health monitoring and recommendations
- [ ] Auto-learning: track which agents perform best for which tasks
- [ ] Background mode for long-running agent tasks
- [ ] Agent marketplace / discovery CLI

## Contributing

To add a new plugin:

1. Fork grain
2. Create `src/plugins/your-agent.ts` implementing `AgentPlugin`
3. Export from `src/plugins/index.ts`
4. Add default config to `src/config.ts`
5. Test: `bun run build && cp dist/cli.js ~/bin/grain`
6. Submit PR with tests and docs

## Examples

See the [examples](./examples/) directory for:
- Plugin development templates
- Routing config examples
- Team workflow configs
- Integration tests

## License

MIT

---

**Questions?** Open an issue on GitHub or join the discussion at https://grain.ai/community
