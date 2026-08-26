# grain — working on this repository

Grain is a local-first coding agent: TypeScript on Bun, a streaming agent loop
with brokered tools, durable run journals, engram-backed memory, and a
full-screen terminal workspace.

This file is the working contract for anyone (human or agent) changing grain.
Read it before the first edit; it is kept accurate on purpose.

---

## Orientation

| | |
|---|---|
| Repository | `~/conductor/repos/grain` |
| Installed binary | `~/bin/grain` |
| Remote | `github.com/skeehn/grain` (branch `main`) |
| Runtime | Bun for dev/build, Node target for npm compatibility |
| User state | `~/.grain/` (config, sessions, skills, runs, agents, schedules) |
| Memory daemon | engram on `127.0.0.1:7474` — optional, never load-bearing |

```sh
bun run dev -- "task"        # run from source
bun run build                # bundle + compile dist/grain
cp dist/grain ~/bin/grain    # install (NOT dist/cli.js — that is the bundle)
```

---

## The verify loop

Run all of these before claiming a change works. They are fast.

```sh
bun test          # ~420 tests, seconds
bun run typecheck # tsc --noEmit
bun run build     # must succeed; the binary is the deliverable
bun run install:smoke
```

Two checks that catch what the above cannot:

**The TUI needs a real pty.** It is a full-screen differential renderer; piping
stdin does nothing useful and `script(1)` fails on a socket stdin. Drive it with
`tests/fixtures/pty-driver.py`, or a `python3` `pty.fork()` harness that sends
keys and replays the ANSI into a screen buffer. `tests/tui-pty.test.ts` is the
worked example. **Enter submits on CR, LF, or CRLF.** Newlines inside a message
come from bracketed paste, not from Enter.

**A clean clone must build.** This repository once had committed code importing
files that were never staged, so `git clone && bun run build` failed for
everyone while working locally. Before pushing structural changes:

```sh
git clone -q . /tmp/grain-check && cd /tmp/grain-check && bun run build && bun test
```

---

## Architecture map

```
src/
  cli.ts              arg parsing, sub-commands, dispatch
  config.ts           ~/.grain/config.json + .env loading, provider validity
  system-prompt.ts    quality standards + cwd/platform injection
  agent/
    loop.ts           the streaming turn loop: context → stream → tools → verify → record
    changed-files.ts  working-tree diff, for agents whose edits Grain does not broker
    checkpoint.ts     per-task snapshots behind /undo
    context.ts        compaction, engram retrieve/store, token fitting
    verify.ts         detects the project's fast check (typecheck/compile)
  providers/
    index.ts          provider factory; `getProvider(name, model)`
    cli-agent.ts      claude-code / codex / opencode as providers (subscription)
    registry.ts       unified availability-aware model catalog for the picker
    openrouter.ts     base OpenAI-compatible client; groq/xai/vllm extend it
    anthropic.ts bedrock.ts ollama.ts vllm.ts groq.ts xai.ts
  tui/
    app.ts            the workspace: transcript, panels, commands, key handling
    overlay.ts        modal pickers (pure state + frame painter)
    differential.ts   frame diffing → ANSI, with truecolor/256/16 fallbacks
    frame.ts editor.ts theme.ts capabilities.ts status.ts models.ts
  tools/              brokered tools; index.ts registers name → executor
  docs/
    worklog.ts        durable work record (files) — tasks and notes
    index-bridge.ts   engram indexing + graph edges over that record
    generate.ts       repository wiki generation from extracted symbols
  wiki/               page format, provenance, engram sync, HTTP viewer
  engram/             typed memory client + governed MemoryService
  kernel/             hash-chained run journals, RunService, replay
  policy/             tool risk classification + approval gateway
  orchestration/      agent profiles, task graphs, executors, worktrees
  skills/ session/ schedules/ mcp/ learning/ workspace/ context/ router/
```

---

## Model access — the part most likely to surprise you

Grain reaches models three ways. All are selected the same way and all are
first-class; none is a fallback for another.

| Kind | Providers | Credential |
|---|---|---|
| Subscription CLI | `claude-code`, `codex`, `opencode`, `grok` | the CLI's own login |
| Direct API | `anthropic`, `openrouter`, `groq`, `xai`, `bedrock` | env key / AWS |
| Local | `ollama`, `vllm` | none |

Selector syntax is `provider:model`. **Only `:` separates them**, and only when
the head names a real provider — otherwise `qwen2.5-coder:7b` and
`us.anthropic.claude-sonnet-4-5-v1:0` would be mangled. `/model` with no
argument opens the picker built from `providers/registry.ts`.

**A present API key does not mean usable access.** The owner of this repository
reaches Claude and GPT through subscriptions; the Anthropic key has no credit.
Never route a subscription provider onto a paid API, and never treat a key's
existence as proof it works.

**Subscription providers bypass Grain's tool loop entirely.** The child CLI runs
its own tools against the same working tree. Consequences that have bitten:
`availableTools` is emptied for them, the stream inactivity budget is 15 min not
90 s, and changed files must be observed from the working tree
(`agent/changed-files.ts`) or verification, `/undo`, and the work log all see
nothing.

Complexity routing (`router/index.ts`) only picks between Bedrock tiers, so it
runs **only when Bedrock is the configured provider**. An alias like `opus` never
rewrites an explicitly chosen provider.

---

## Work memory and documentation

Files are the source of truth; engram is an index over them. Engram being down
degrades search to lexical — it never blocks a write and never throws.

- `docs/grain/worklog/YYYY-MM.md` — one entry per completed task, appended
  automatically from every completion path in the loop.
- `docs/grain/notes/YYYY-MM-DD.md` — `/note`, `grain note`, or the `work_note` tool.
- `docs/wiki/*.md` — `grain wiki build` generates architecture and per-subsystem
  pages from extracted symbols, each carrying source ranges and content hashes.
  `grain wiki verify` proves whether a page still matches the code. Only
  git-tracked files are described. Prose above the managed region survives
  regeneration — never write below `<!-- grain:generated:start -->`.
- `grain recall "…" [--all]` and the `work_recall` tool search the record;
  `--all` spans every repository.

---

## Invariants that will bite you

1. **Unknown tools are classified `destructive`.** `policy/classifier.ts`
   defaults that way on purpose, so a newly registered tool is denied outright
   in non-interactive runs until you add it to `READ_ONLY` or `WRITES`. A test
   in `tests/work-memory.test.ts` asserts every registered tool is classified.
2. **`reasoning: {effort}` is OpenRouter-only.** Groq wants the standard
   `reasoning_effort` scalar; other OpenAI-compatible endpoints 400 on both.
   Provider-specific request fields must be gated on `this.name`.
3. **A saved model belongs to its saved provider.** Overriding only the provider
   must not carry the previous model id across.
4. **Never `git checkout <file>` in this tree.** There is routinely uncommitted
   work; it will be destroyed silently.
5. **Fire-and-forget loses work.** One-shot runs exit immediately after
   completion, abandoning detached promises. Await anything that must persist.
6. **The `!hasToolUse` branch returns early.** Anything that must happen on every
   completion has to be wired into that path too, not only the `finish` path.
7. **Panel text must keep its alignment.** `wrapTuiText` only re-flows lines that
   actually overflow; collapsing whitespace destroys diffs, tables, and code.
8. **Colour must degrade.** Emit truecolor, 256-colour, and 16-colour forms —
   most terminals report `ansi256`, and a truecolor-only path renders flat.

---

## Common changes

**Add a provider** — implement `Provider` (`stream()` yielding `StreamEvent`s) in
`src/providers/`, register a loader in `providers/index.ts`, add it to
`VALID_PROVIDERS` in `config.ts`, give it capabilities in
`context/capabilities.ts`, and add entries to `providers/registry.ts` so it
appears in the picker.

**Add a tool** — define the schema and executor in `src/tools/`, register both in
`tools/index.ts`, **and classify it in `policy/classifier.ts`**. If small models
should get it, add its name to the relevant `preferredToolNames`.

**Add a TUI command** — handle it in `handleCommand` in `tui/app.ts`, document it
in `HELP_LINES`, and add a view to `VIEWS` if it needs a panel. Pure logic
belongs in a module the command calls, so it can be tested without a pty.

## Code standards

TypeScript, Node target, bundled to a single file. Streaming via
`process.stdout.write()`. Tools return `{content, is_error}` rather than
throwing. Comments explain *why*, especially where behaviour looks odd — most
of the oddities here are load-bearing.
