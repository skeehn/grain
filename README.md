# grain

Local-first terminal agent for coding, research, writing, and marketing, with governed learning and persistent memory.

```sh
curl -fsSL https://raw.githubusercontent.com/skeehn/grain/main/install.sh | sh
```

---

## What it is

grain is a **terminal work harness** — it reads your files, creates deliverables, runs commands, and coordinates with other AI agents. A Git repository is optional.

**Key features:**
- 🤖 **Multi-agent orchestration** — Coordinate Grain-native, Claude Code, Codex, OpenCode, Hermes, or custom agents
- 🏠 **Local model hosting** — Run 100% private with vLLM (Llama 3, DeepSeek Coder, etc.)
- 🧠 **Persistent memory** — Uses [engram](https://github.com/skeehn/engram) knowledge graph across sessions
- 🎯 **Smart routing** — Auto-routes tasks to the cheapest capable model
- 🔌 **MCP support** — Connect to any Model Context Protocol server (Computer Use, GitHub, etc.)
- 🩺 **Guided setup** — `grain setup` and `grain doctor` validate providers, profiles, executors, Git, and Engram
- 🌾 **Scrolling terminal UI** — Native scrollback, streaming answers, ASCII mascot and tool blocks, numbered pickers, and no-color/16/256/truecolor support
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

Installs the standalone `grain` executable to `~/bin/`; Engram is optional and installed only when a verified release asset is available. No Node.js or Bun runtime is required to run Grain. The installer checks SHA-256, stages the download, and preserves an existing binary as a backup. If `~/bin` is not on PATH, follow the printed shell setup instruction.

**Then start Grain:**
```sh
grain
```
Grain connects a provider in the conversation the first time you run it.

---

## Quick start

```sh
# Open the scrolling terminal conversation
grain

# Or begin with a task
grain "explain the architecture of this project"

# Verify this machine before a real coding run
grain doctor

# Inside Grain: /help, /files, /diff, /tools, /context, /memory,
# /history, /agents, /jobs, /settings
# Attach context with @src/auth.ts or @screenshot.png

# Pick any model — subscriptions, local runtimes, or APIs — from one list
grain            # then type /model

# Or name one directly
grain --model claude-code:opus "fix and test this project"
grain --model openrouter:openrouter/free "fix and test this project"

# Work in an ordinary folder, with no Git repository required
grain "Read brief.md, draft launch.md for independent designers, then review it"

# Update later
grain update
```

### Safe updates

`grain update --check` is read-only. Native release installations use the latest
GitHub release; `grain update --yes --release` installs without a prompt. Updates
require the platform's native asset and `SHA256SUMS`, verify the executable's
version, and keep the old binary at the printed `grain.backup-*` path. Failed
downloads/checks do not replace the existing installation.

When `GRAIN_SRC`, `~/conductor/repos/grain`, or `~/grain` identifies a source
checkout, plain `grain update` rebuilds **that checkout**, including its local
changes. It does not pull, switch branches, or claim to fetch the latest source.
Use `grain update --source /path/to/grain` to choose explicitly, or `--release`
to bypass source mode. Source builds need Bun and installed dependencies.

For npm installations, use `npm install -g grain@latest` with the same prefix
used to install; `grain update` prints this guidance instead of replacing npm's
managed entry point. No configuration or session migration is performed by the
binary updater. Run `grain help update` for all options.

---

## Commands

```text
grain                         open the workspace
grain "task"                  open the workspace with a task
grain update                  update Grain
grain setup                   configure providers and workspace defaults
grain doctor                  preflight config, executors, Git, and Engram
grain memory status           inspect Engram transport and governance state
grain skills validate         validate portable Agent Skills packages
grain --classic               compatibility alias for the default scrolling UI

# Inside the workspace
/help                         discover controls
/mode ask|plan|execute        choose approval and planning behavior
/files /diff /wiki            inspect the repository and changes
/tools /context /memory       inspect the live harness inputs and actions
/context explain              show context allocation and durable compactions
/memory search QUERY          search promoted repository-scoped memory
/memory status                show v1/legacy/degraded Engram state
/memory inspect ID            show provenance and governance state
/memory edit ID CONTENT       update a governed memory record (v1)
/memory forget ID             request verified deletion (v1)
/memory export|rebuild        export scoped memory or rebuild indexes (v1)
grain learning migrate PATH   resumably import the verified JSONL ledger to v1
/history /agents /jobs        inspect durable conversations and automation
/agent NAME /workflow NAME    select a profile or bounded workflow recipe
/loop /budget /steer          inspect recursion limits or steer active work
/detach /attach               leave and rejoin background work
/settings /theme /model       configure the current workspace
/note TEXT                    record a decision worth keeping
/work                         what you have done in this repository
/recall QUERY [--all]         search past work; --all spans every repository
/wiki build|verify            regenerate repo docs; check they still match code
```

Grain can read files outside a Git project. In an ordinary work folder, writing
and shell tools remain available under the selected approval mode. Starting in
your home directory defaults to bounded, read-only general chat; use `/open PATH`
to select a work folder. Repository indexing is optional.

Enter submits; bracketed paste preserves multiline text. Up/Down recall input,
Tab completes an `@file` mention, Ctrl+C cancels an active task or picker, and
Ctrl+D on an empty idle prompt exits. Use your terminal's normal scrollback and
selection. `/model` and `/agent` use numbered, filterable lists; blank input
cancels. `--classic` and `--no-alt-screen` are accepted for compatibility: the
interactive UI no longer takes over the alternate screen.

`/undo` restores Grain-brokered writes in any work folder. Subscription CLI edits
are observed in Git workspaces, including already-dirty files and partial failed
turns. Undo is in-memory for the latest task, not a backup; ignored files and
symlinks are not restored by the child-agent observer. Review `/diff` before undo.

For research and marketing, supply source files or configure appropriate MCP
tools. Web browsing, image generation, publishing, and account access depend on
those tools or the selected child agent; Grain does not invent access or sources.

Scheduled jobs use standard five-field cron expressions (plus `@hourly`,
`@daily`, `@weekly`, and `@monthly`). Automatic execution belongs to the
supervised `grain daemon`; `grain jobs run-due` is the explicit one-shot path.
The TUI can inspect and edit jobs but does not own a background timer. Atomic
leases prevent concurrent daemons from claiming the same launch. Use
`grain daemon install` to generate a reviewable launchd/systemd user-service
template.

`grain -p`, `grain runs`, `grain wiki`, `grain agents`, `grain jobs`, `grain lab`,
`grain note`, `grain worklog`, `grain recall`, and `grain config` remain stable
expert and automation commands.

---

## Models

`/model` opens one picker covering every model this machine can actually run —
subscriptions first, then local runtimes, then paid APIs. Anything unavailable is
listed with the exact command that fixes it, so nothing is silently missing.

```sh
grain            # then: /model
/model claude-code:opus     # or select it from the picker
/model codex                # or ollama:qwen2.5-coder:7b, openrouter:<id>, …
```

The same selector works for one-shot runs: `grain -p "task" --model claude-code:opus`.

### Subscription agents (no API key)

Grain drives coding-agent CLIs you are already signed into, so Claude and Codex
keep working when the matching API key has no credit. The child agent runs its
own tools in your working tree; Grain streams its narration and keeps the
conversation alive across invocations, per repository.

| Provider      | Setup | Cost |
|---------------|-------|------|
| `claude-code` | Install the `claude` CLI and sign in | Your Claude subscription |
| `codex`       | Install the `codex` CLI and sign in  | Your ChatGPT subscription |
| `opencode`    | Install the `opencode` CLI           | Whatever OpenCode is configured with |
| `grok`        | Install and sign into the `grok` CLI | The CLI's own account/configuration |

Grain does not silently exchange a subscription for a paid API. CLI versions,
login state, subscription quotas, and model entitlements still apply. `auto`
means the child CLI's configured default; use `/model provider:model` to override
it. A present binary or key alone is not proof of usable model access.

Custom OpenAI-compatible providers and stdio agent profiles cover additional
backends. This is extensibility, not a guarantee that every API, model, or
subscription speaks a compatible protocol. See [terminal verification](docs/terminal-verification.md)
for the tested paths and remaining limits.

### Direct APIs and local runtimes

| Provider    | Setup | Cost |
|-------------|-------|------|
| `bedrock`   | `aws configure` or set `AWS_REGION` + `AWS_ACCESS_KEY_ID` | ~$0.003/task |
| `anthropic` | `grain config set key ANTHROPIC_API_KEY sk-ant-...` | ~$0.003/task |
| `openrouter`| `grain config set key OPENROUTER_API_KEY ...` | Varies |
| `groq`      | `grain config set key GROQ_API_KEY ...`       | `qwen/qwen3-32b` |
| `xai`       | `grain config set key XAI_API_KEY ...`        | Varies |
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

Grain can run a bounded, durable graph of specialized agents. Each node may use
a different direct API, local model, subscription CLI, or stdio adapter. Writers
operate in isolated worktrees and merge only after verification.

```sh
# Inspect and validate layered profiles
grain agents profiles
grain agents validate

# Run one portable profile through the durable scheduler
grain agents run reviewer "review auth.py for security issues"

# Create a reusable bounded graph recipe
grain agents recursive-delivery "refactor database.ts and prove it works"
```

Portable profiles live at `.grain/agents/<name>.md`:

```md
---
id: reviewer
description: Read-only independent reviewer
executor: codex
model: gpt-5-codex
permissions: {"read":"allow","write":"deny","bash":"ask"}
maxDepth: 2
maxFanOut: 4
---
Inspect the requested change and return evidence, risks, and a verdict.
```

Built-in executor targets are `grain-native`, `direct-api`, `claude-code`,
`codex`, `opencode`, `hermes`, and `stdio`. Grain uses installed external
binaries and user-owned logins; it does not extract subscription credentials or
silently substitute an executor.

See [PLUGINS.md](PLUGINS.md) for full documentation.

---

## Desktop Automation (MCP)

grain supports Model Context Protocol for controlling your desktop:

**1. Configure Computer Use:**

Add to `~/.grain/mcp.json`:
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

**2. Validate and inspect before running a task:**
```sh
grain mcp list
grain mcp validate
grain mcp tools computer-use
```

List/validate do not start servers. `tools SERVER` connects to that enabled
server and reports allowed and blocked tools. Tools remain subject to Grain's
approval policy; enabling a server does not authorize arbitrary side effects.
HTTP servers use `transport: "http"`, an HTTPS `url` (HTTP is allowed on loopback),
and optionally `bearerTokenEnv` naming an environment variable, not a token value.

**3. Use naturally:**
```sh
grain "take a screenshot and describe what's on my desktop"
grain "open Safari and navigate to github.com"
grain "click the Submit button on this form"
```

See [PLUGINS.md](PLUGINS.md) for more MCP servers (GitHub, Filesystem, Git, etc.).

Grain-native providers use these MCP connections. Subscription CLIs own their
tools and MCP configuration; Grain does not silently copy credentials or server
configuration into another agent. The HTTP client supports request/response
JSON and SSE, not OAuth discovery, elicitation, sampling, or every MCP extension.

## Skills

```sh
grain skills list
grain skills add launch-copy       # interactive name/description/body workflow
grain skills validate
grain skills view launch-copy
grain skills delete launch-copy    # removes the user-owned skill, not project packages
```

Portable packages follow the [Agent Skills format](https://agentskills.io/specification):
put `SKILL.md` with `name` and `description` frontmatter in
`~/.grain/skills/<name>/`. Project-local `.grain/skills`, `.agents/skills`, and
`.claude/skills` are also discovered. `GRAIN_HOME` overrides `~/.grain`.
For scripts, write a package into that directory and run `grain skills validate`;
interactive `add` intentionally fails fast when stdin is not a terminal.

Relevant skill bodies are loaded into native model context. Claude Code/Grok
also receive Grain skill context; Codex/OpenCode use their own skill discovery.
Skills are instructions, not permission grants; review packages before installing.
See [terminal and command verification](docs/terminal-verification.md) for tested
paths and provider boundaries.

---

## Config

Everything lives in `~/.grain/`:

```
~/.grain/
  config.json       provider, model, settings
  mcp.json          trusted MCP server connections
  .env              API keys (chmod 600, auto-loaded)
  skills/           project-specific agent skills
  sessions/         versioned conversation files (migrated from sessions.json)
```

---

## Memory (engram)

grain uses [engram](https://github.com/skeehn/engram) — a local Rust knowledge graph — for persistent memory. Install script downloads it automatically. Grain negotiates the typed `/v1` contract when available and retains legacy reads for existing installations.

engram starts automatically in the background when you run grain. It runs at `localhost:7474`.

Without engram, grain enters a visible degraded mode and continues coding without cross-session recall. Automatic `/v1` writes are scoped candidates with provenance and require independent validation before normal recall.

Conversation history and Engram knowledge serve different purposes. Session files
preserve resumable chat/tool history per repository. Engram stores retrieved facts
and is automatically scoped to the active repository so unrelated projects do not
leak context into each other. See [docs/DURABILITY.md](docs/DURABILITY.md) for the
storage, recovery, and maintenance contract.

The evidence-gated 1.0 program lives in
[docs/GRAIN-1.0-ROADMAP.md](docs/GRAIN-1.0-ROADMAP.md). The independent Engram
service proposal is [docs/ENGRAM-IMPROVEMENT-BRIEF.md](docs/ENGRAM-IMPROVEMENT-BRIEF.md).
See the truthful [feature status](docs/FEATURE-STATUS.md), tested
[compatibility matrix](docs/COMPATIBILITY.md), and primary-source-backed
[research graph](docs/RESEARCH-GRAPH.md) before interpreting a release claim.

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

- Bun >= 1.0 (development and source builds only)
- One configured direct provider, compatible endpoint, local runtime, or an
  installed external executor with its own user login

## Verify your install

```sh
bun install
bun run check
## `check` includes an offline install of the packed CLI plus help and skill discovery.
./dist/grain wiki build
./dist/grain wiki verify
./dist/grain --version

# Live provider smoke test (uses a small real request)
grain --provider openrouter --model openrouter/free --max-turns 1 \
  "Reply exactly GRAIN_OPENROUTER_OK. Do not call tools."
```

---

## License

MIT
