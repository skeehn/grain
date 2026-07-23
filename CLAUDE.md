# grain

**Read [`AGENTS.md`](./AGENTS.md) before changing anything.** It is the working
contract for this repository and is kept accurate; this file only carries the
few facts you need in the first thirty seconds.

- Repository `~/conductor/repos/grain` · installed binary `~/bin/grain`
- Build and install: `bun run build && cp dist/grain ~/bin/grain`
  (`dist/grain` is the compiled binary; `dist/cli.js` is only the bundle)
- Verify: `bun test` · `bun run typecheck` · `bun run build` · `bun run install:smoke`
- The full-screen TUI can only be exercised through a **real pty**
  (`tests/fixtures/pty-driver.py`); piping stdin proves nothing. Enter is `\r`.
- Before pushing structural changes, confirm a clean clone still builds.

Three traps that have each cost a session:

1. `policy/classifier.ts` classifies **unknown tools as `destructive`**, so a
   newly registered tool is denied in non-interactive runs until you classify it.
2. Subscription providers (`claude-code`, `codex`, `opencode`) run their own tool
   loop, so Grain must observe changed files from the working tree.
3. Never `git checkout <file>` here — this tree usually has uncommitted work.

Everything else — architecture map, model access rules, work-memory and wiki
behaviour, and how to add a provider, tool, or TUI command — is in `AGENTS.md`.
