# Grain competitive audit

Updated: 2026-07-10

This audit compares Grain with the current public product surfaces of
[Hermes Agent](https://hermes-agent.nousresearch.com/docs/user-guide/tui) and
[Pi](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent).

| Area | Grain | Hermes | Pi |
| --- | --- | --- | --- |
| Core shape | Focused TypeScript coding loop with built-in tools | Broad personal-agent platform with many channels and backends | Small composable coding core with packages and extensions |
| Memory | Engram retrieval, learned skills, JSON sessions, optional reflection | Cross-session memory, skill learning, user modeling | Session trees, compaction, extension-owned state |
| Providers | Bedrock, Anthropic, OpenRouter, Ollama, vLLM, subprocess agents | Broad provider and portal support | Broad unified provider package |
| Terminal surface | Lightweight field-instrument UI with ordered Bayer activity texture | Rich overlays, live session switching, steering, mouse support | Differential renderer and highly extensible TUI |
| Tool execution | Large built-in coding tool set and persistent shell | Large general-purpose tool catalog and sandbox backends | Minimal defaults, extension-first customization |
| Verification | Repository-owned 128-test gate, typecheck, build, live provider smoke | Large mature project surface | Monorepo check and test harness |

## Improvements made from the audit

- OpenRouter streaming now preserves parallel tool calls by call index and ID.
- Provider errors and malformed SSE frames fail visibly instead of disappearing.
- OpenRouter streams abort after 90 seconds of inactivity.
- `pool`, `poolside`, and `laguna` resolve to `poolside/laguna-xs-2.1`.
- Providers load lazily, keeping parser and tool tests independent of optional SDK startup.
- The agent loop no longer terminates host processes from library code.
- Anthropic and Bedrock preserve tool IDs across streamed input deltas.
- The terminal renderer uses a deterministic 4x4 Bayer matrix for activity, supports
  `NO_COLOR`, supports `GRAIN_REDUCED_MOTION=1`, and adapts output truncation to terminal height.
- `GRAIN_HOME` now isolates context tracking as well as sessions, config, and skills.
- Runtime and development dependency versions are pinned; unused Ink/React/terminal packages were removed.

## Honest boundary

Grain is now smaller and more opinionated than Hermes, and its built-in coding/memory
workflow is less assembly-heavy than Pi. Hermes still has a substantially richer interactive
TUI and multi-surface platform. Pi still has the stronger public extension ecosystem and
differential-rendering foundation. The next highest-value parity work would be queued steering,
session/model pickers, and a public extension API; none is claimed as shipped here.
