# Terminal harness: design and verification

Grain's interactive entry points share a scrolling conversation. The terminal
owns scrollback and selection; Grain redraws only the composer. ASCII branding,
tool blocks, bounded output, numbered pickers, and color fallbacks replace the
full-screen dashboard. Legacy presentation flags remain accepted.

## Reproduce the checks

```sh
bun run check
GRAIN_E2E_BINARY="$PWD/dist/grain" bun test tests/terminal-e2e.test.ts
```

The PTY tests require Python 3 and a Unix PTY. HTTP fixtures listen only on
localhost and use dummy credentials. They execute real Grain processes, tools,
file edits, policy decisions, and run journals; the model is deterministic, not a
paid API call. They test the harness, not a model's reasoning quality.

| Path | Evidence |
| --- | --- |
| Coding in an ordinary folder | Read, patch, run a test, handle missing-file error, undo |
| Knowledge/marketing work | Read a brief, save a draft, read back the saved artifact; no Git required |
| Cancellation | Stalled HTTP stream and approval prompt interrupted, next task succeeds |
| Provider failure | Failed run recorded, conversation remains usable |
| Subscription subprocess failure | Partial edits detected in Git and available to undo |
| Input and layout | Multiline paste, CR/LF submission, batched input, 42-column resize, no alternate screen |
| Child CLI protocol | Codex cold/resume argv, current JSONL, UTF-8 chunk boundaries, final record without newline |
| Undo safety | Existing dirty edits preserved; pre-deleted files remain deleted; symlinks not treated as new files |

The rest of the suite covers provider selection, custom endpoints, MCP trust,
tool policy, model capabilities, durable sessions, and orchestration contracts.
Passing fixtures does **not** certify every current third-party model or CLI.

## Provider boundaries

- Built-in CLI providers: Claude Code, Codex, OpenCode, and Grok. They use their
  own tools and account configuration. Grain must not route them to paid APIs.
- Direct providers: Anthropic, Bedrock, OpenRouter, Groq, and xAI; local providers:
  Ollama and vLLM. Custom OpenAI-compatible endpoints are configurable.
- Additional agents use profiles/stdio adapters. They must implement the
  documented adapter contract; arbitrary executable names are not a protocol.
- Installation, login, quota, supported CLI flags, model access, and endpoint
  compatibility remain external prerequisites. Run `grain doctor` and a small
  task with your actual account before depending on a new configuration.
- Grain-native writes support undo in ordinary folders. Child CLI undo requires
  a Git workspace; ignored paths, symlinks, submodules, file metadata, and Git
  index changes are outside that snapshot contract. Undo lasts one task/session.
- Research needs provided sources or configured tools with web access. Publishing
  or sending is a separate action, not an automatic consequence of drafting.

## Design references, not a superiority claim

The [Pi documentation](https://github.com/earendil-works/pi/tree/main/packages/coding-agent)
emphasizes an extensible terminal harness, model selection, and separate
interactive/automation interfaces. The
[Hermes CLI documentation](https://hermes-agent.nousresearch.com/docs/user-guide/cli/)
documents visible working context, cancellation, multiline input, and steering.
These inform Grain's interaction goals. No cross-product benchmark was run, so
this change does not claim universal superiority, feature parity, or “10x” speed.

Live provider qualification is separate from deterministic CI. Do not describe
fixture success as a live Claude/Codex/Ollama account test.
