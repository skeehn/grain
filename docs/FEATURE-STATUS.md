# Feature Status

Updated: 2026-07-22. This page is authoritative for user-visible claims.

| Feature | Status | Evidence / limitation |
|---|---|---|
| Native CLI chat and coding tools | working | full local unit/integration suite |
| Durable RunService and hash journal | working | replay, tamper, recovery tests |
| Full-screen TUI | experimental | responsive tabs, grouped one-screen help, word-aware wrapping, editor/render snapshots, and two macOS PTY launch, command, workflow, jobs, and restore flows pass; Linux matrix and soak pending |
| Transactional filesystem and undo | working | confinement, rollback, worktree tests |
| OpenRouter free routing | working | live capability-filtered three-model fallback pool plus 2026-07-22 Harbor canary: `poolside/laguna-xs-2.1:free`, 3 tool calls, reward 1.0 |
| xAI/Grok direct provider | experimental | provider-neutral adapter wired; live key matrix pending |
| Agent profiles and bounded graphs | working | migration, depth/fan-out/budget tests |
| Claude/Codex/OpenCode/Hermes execution | experimental | normalized contracts; macOS live Codex, OpenCode, and Hermes smokes pass; Claude reached the authenticated account's weekly limit and correctly failed without fallback; Linux matrix pending |
| Generic stdio agent SDK | working | deterministic protocol and cancellation tests |
| Scheduled daemon | experimental | atomic leases/ownership and start-readiness lifecycle E2E pass; 24-hour soak pending |
| Portable `SKILL.md` discovery | working | progressive load, strict Agent Skills name/description/package validation, and legacy compatibility tests |
| Governed learning ledger | working | independent validation/promotion tests |
| Engram legacy memory | working | HTTP/subprocess tests and live status/search pass; ten orphan index records were removed after a recoverable 2026-07-22 backup and doctor now verifies 200 nodes = 200 FTS = 200 vectors |
| Engram `/v1` client | experimental | fake-server contract only; server PR blocked |
| Harbor bridge canary | working | Harbor 0.20.0 + Docker + live `openrouter/free`, shell redirection, verification, reward 1.0, zero exceptions; checked-in evidence artifact |
| Terminal-Bench/SWE-bench claims | unqualified | real Harbor canary passes, but the full official datasets, repeated trials, Linux matrix, and comparison agents remain outstanding |
| Windows | planned | post-1.0 |
| Local qualification | working | current 374-test suite, typecheck, build, and offline install smoke pass; qualification `d64d50c8-99ee-44b7-a922-d7c76b3a08fd` separately records 50 consecutive earlier 360-test cycles (18,000 executions) and package dry-run on the intentional dirty tree |

Grain does not currently claim “best” or SOTA status.
