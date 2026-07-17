# grain - TypeScript Coding Agent

## Architecture

TypeScript + Bun runtime. Streaming agent loop with tool execution, engram HTTP memory, and JSON session storage.

Location: ~/grain/
Binary: ~/bin/grain (built with `bun run build && cp dist/cli.js ~/bin/grain`)
Config: ~/.grain/config.json
Sessions: ~/.grain/sessions/ (JSON files)
Skills: ~/.grain/skills/*.json

## Key Commands

```bash
# One-shot task
grain --yes "task description"

# Interactive REPL
grain

# With specific provider/model
grain --provider anthropic --model Codex-opus-4-5

# Show help
grain --help
```

## Source Structure

`src/` contains the CLI, agent loop, providers, tools, session store, skills, and terminal renderer.

## Model Routing

- Trivial/Simple tasks → Haiku 4.5 (fast, cheap)
- Moderate/Complex → Sonnet 4.5 (capable)
- Critical → Opus 4 (maximum quality)

Routing looks at task keywords, number of files, question vs action, and complexity signals.

## Providers

Default: bedrock (`us.anthropic.Codex-sonnet-4-5-20250929-v1:0`)

Auth: AWS profile/env for Bedrock, `ANTHROPIC_API_KEY` for direct, etc.

## Engram Integration

Engram's HTTP server on port 7474 eliminates subprocess overhead. Start it with:

```bash
engram -d ~/.engram/knowledge serve --port 7474
```

Grain auto-detects HTTP and falls back to a subprocess. Skills at `~/.grain/skills/` are loaded and injected per task.

## Build + Test

```bash
cd ~/grain
bun run build
cp dist/cli.js ~/bin/grain
```

## Code Standards

- TypeScript, Node target for npm compatibility, bundled single file
- Bun for development/build, Node for runtime
- JSON session files with no native dependencies
- Streaming via `process.stdout.write()`
- Errors handled with `try/catch` and `{content, is_error}` tool results

## Known Pitfalls

1. LSP may report `process`/`Buffer` missing; Bun provides them at runtime.
2. Engram subprocess startup can take 4–12 seconds; prefer its HTTP server.
3. Model routing uses regex heuristics and can misclassify complex prompts.
4. Large streamed tool JSON is expected and should not be treated as a freeze.
5. Delegated agents run in isolated context without shared parent file state.
