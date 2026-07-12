# grain

Self-improving AI coding agent with persistent memory.

```sh
curl -fsSL https://raw.githubusercontent.com/skeehn/grain/main/install.sh | sh
```

---

## What it is

grain is a **multi-agent AI coding orchestrator** — it reads your codebase, writes code, runs commands, and coordinates with other AI agents to get work done.

**Key features:**
- 🤖 **Multi-agent orchestration** — Delegate to Claude Code, Codex, Aider, or custom agents
- 🏠 **Local model hosting** — Run 100% private with vLLM (Llama 3, DeepSeek Coder, etc.)
- 🧠 **Persistent memory** — Uses [engram](https://github.com/skeehn/engram) knowledge graph across sessions
- 🎯 **Smart routing** — Auto-routes tasks to the cheapest capable model
- 🔌 **MCP support** — Connect to any Model Context Protocol server (Computer Use, GitHub, etc.)
- 📦 **Zero config** — Works out of the box with AWS Bedrock, Anthropic, OpenRouter, or Ollama
- 🌾 **Purpose-built terminal UI** — Ordered Bayer-dither activity, compact tool cards, no-color and reduced-motion support
- 🧪 **One-command quality gate** — Tests, typecheck, and production build via `bun run check`
- 🧾 **Replayable runs** — Hash-chained event journals record model, policy, tool, usage, and terminal outcomes
- 🗂️ **Confined filesystem** — Symlink-safe workspace roots, optimistic hashes, atomic writes, and content-addressed snapshots
- 📚 **Repository wiki** — Versioned Markdown, source provenance, stale-reference checks, search, and a loopback-only web view

It's your personal software factory that runs locally on your machine.

---

## Install

**One-liner (recommended):**
```sh
curl -fsSL https://raw.githubusercontent.com/skeehn/grain/main/install.sh | sh
```

Installs `grain` and `engram` to `~/bin/`. Requires Node.js >= 18.

**Then set up your provider:**
```sh
grain init
```

---

## Quick start

```sh
# Explain a codebase
grain "explain the architecture of this project"

# Write code, fully automated
grain --yes "add input validation to src/api/users.ts"

# Debug something
grain "why is the auth middleware returning 401 on valid tokens"

# Build something new
grain "build a dark-themed landing page for this project"

# Run Poolside Laguna XS 2.1 through OpenRouter
grain --provider openrouter --model pool "fix and test this project"

# Inspect the exact model context budget from a completed run
grain runs context <run-id>

# Create durable multi-agent task graphs
grain agents pair "implement and verify authentication"
grain agents research "compare migration strategies"

# Inspect the latest replayable run in the differential full-screen TUI
grain tui

# Open the local visual workbench for the latest run
grain lab

# Change the persistent workshop theme
grain "/theme arcade"

# Inspect a specific run without replacing the current terminal buffer
grain --no-alt-screen tui --run <run-id>

# Inspect verified learning candidates and evidence
grain learning list
```

---

## Commands

```
grain [task]                  run a task interactively
grain "do something"          one-shot inline task
grain --yes "task"            fully automated, no prompts

grain init                    interactive setup wizard
grain status                  check provider, engram, config
grain update                  update to latest version
grain runs list              list event-sourced runs
grain runs inspect <id>      validate and replay a run
grain runs export <id> <file> export a redacted trajectory
grain wiki build             build repository wiki provenance
grain wiki search <query>    search wiki pages
grain wiki verify            check source hashes and line ranges
grain wiki serve [port]      serve the read-only local wiki

grain config                  show current config
grain config set provider <name>
grain config set model <id>
grain config set key <KEY_NAME> <value>    saves to ~/.grain/.env
grain config set engram_db <path>
grain config reset

grain --help                  full help
grain --version               show version
```

---

## Providers

| Provider    | Setup | Cost |
|-------------|-------|------|
| `bedrock`   | `aws configure` or set `AWS_REGION` + `AWS_ACCESS_KEY_ID` | ~$0.003/task |
| `anthropic` | `grain config set key ANTHROPIC_API_KEY sk-ant-...` | ~$0.003/task |
| `openrouter`| `grain config set key OPENROUTER_API_KEY ...` | Varies |
| `groq`      | `grain config set key GROQ_API_KEY ...`       | `qwen/qwen3-32b` |
| `ollama`    | Install [Ollama](https://ollama.ai), no key needed | Free (local) |
| `vllm`      | See **Local Models** below | Free (local) |

API keys are saved to `~/.grain/.env` — never to your shell profile. grain loads them automatically on startup.

`--model pool` is a convenience alias for OpenRouter's `poolside/laguna-xs-2.1` coding model.

### Local Models with vLLM

Run grain with **zero API costs** and **100% privacy**:

1. **Install vLLM:**
   ```sh
   pip install vllm
   ```

2. **Start a model server:**
   ```sh
   vllm serve meta-llama/Llama-3-70B-Instruct --port 8000
   ```

3. **Configure grain:**
   ```sh
   grain config set provider vllm
   ```

4. **Use normally:**
   ```sh
   grain "refactor auth.py to use async/await"
   ```

**No data leaves your machine. Unlimited tasks. Zero cost.**

See [PLUGINS.md](PLUGINS.md) for recommended models and hardware requirements.

---

## Multi-Agent Orchestration

grain can delegate work to specialized coding agents:

```sh
# Let grain choose the best agent
grain "review auth.py for security issues"

# Use a specific agent
grain --agent claude-code "refactor database.ts"

# Or via the spawn_agent tool in interactive mode
```

**Available agents:**
- `claude-code` — Code review, refactoring, complex logic
- `codex` — Rapid prototyping, exploratory coding
- `aider` — Multi-file edits (coming soon)

See [PLUGINS.md](PLUGINS.md) for full documentation.

---

## Desktop Automation (MCP)

grain supports Model Context Protocol for controlling your desktop:

**1. Configure Computer Use:**

Add to `~/.grain/config.json`:
```json
{
  "mcp": {
    "servers": {
      "computer-use": {
        "command": "npx",
        "args": ["-y", "@anthropic-ai/mcp-server-computer-use"]
      }
    }
  }
}
```

**2. Use naturally:**
```sh
grain "take a screenshot and describe what's on my desktop"
grain "open Safari and navigate to github.com"
grain "click the Submit button on this form"
```

See [PLUGINS.md](PLUGINS.md) for more MCP servers (GitHub, Filesystem, Git, etc.).

---

## Config

Everything lives in `~/.grain/`:

```
~/.grain/
  config.json       provider, model, settings
  .env              API keys (chmod 600, auto-loaded)
  skills/           project-specific agent skills
  sessions.json     conversation history
```

---

## Memory (engram)

grain uses [engram](https://github.com/skeehn/engram) — a local Rust knowledge graph — for persistent memory. Install script downloads it automatically.

engram starts automatically in the background when you run grain. It runs at `localhost:7474`.

Without engram, grain still works — just without cross-session memory.

---

## Flags

```
-y, --yes          auto-approve all tool calls
-c, --concise      shorter output
--provider <name>  override provider for this run
--model <id>       override model for this run
--allow-destructive explicitly allow destructive operations inside the workspace
-h, --help
-v, --version
```

---

## Requirements

- Node.js >= 18
- One of: AWS credentials, Anthropic API key, OpenRouter API key, or Ollama

## Verify your install

```sh
bun install
bun run check
## `check` includes an offline install of the packed CLI plus help and skill discovery.
node dist/cli.js wiki build
node dist/cli.js wiki verify
node dist/cli.js --version

# Live provider smoke test (uses a small real request)
grain --provider openrouter --model pool --max-turns 1 \
  "Reply exactly GRAIN_POOL_OK. Do not call tools."
```

---

## License

MIT
