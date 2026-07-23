---
id: architecture
title: "Architecture"
type: architecture
status: current
owners: []
tags: ["generated","architecture"]
source_commit: 81789a2c9ee13b74dcf6cca2b8e43d39cf70e745
generated_at: 2026-07-23T07:27:54.179Z
sources: []
---
# Architecture

Maintained by Grain. Add durable human notes above the generated region — they are preserved across rebuilds.

<!-- grain:generated:start -->
# Architecture

Generated from 584 extracted symbols across 24 subsystem(s).

## Subsystems

| Subsystem | Symbols | Files | Depends on |
|---|---|---|---|
| [[subsystem-tui]] | 102 | 16 | root (1) |
| [[subsystem-tools]] | 87 | 32 | workspace (12), docs (6), wiki (4) |
| [[subsystem-providers]] | 51 | 14 | root (1) |
| [[subsystem-orchestration]] | 50 | 13 | root (1), tui (1), kernel (1) |
| [[subsystem-agent]] | 34 | 8 | tui (15), tools (12), session (7) |
| [[subsystem-workspace]] | 32 | 6 | tui (7), tools (1), root (1) |
| [[subsystem-kernel]] | 23 | 5 | — |
| [[subsystem-engram]] | 22 | 3 | — |
| [[subsystem-docs]] | 22 | 3 | tools (1) |
| [[subsystem-commands]] | 21 | 10 | orchestration (14), docs (6), tui (5) |
| [[subsystem-plugins]] | 20 | 7 | — |
| [[subsystem-root]] | 18 | 4 | kernel (1) |
| [[subsystem-session]] | 16 | 1 | — |
| [[subsystem-wiki]] | 13 | 4 | — |
| [[subsystem-mcp]] | 13 | 5 | — |
| [[subsystem-skills]] | 13 | 2 | — |
| [[subsystem-context]] | 10 | 3 | — |
| [[subsystem-learning]] | 8 | 3 | engram (1) |
| [[subsystem-policy]] | 8 | 3 | — |
| [[subsystem-router]] | 7 | 1 | — |
| [[subsystem-scripts]] | 6 | 1 | tui (1) |
| [[subsystem-schedules]] | 4 | 1 | — |
| [[subsystem-tests]] | 3 | 1 | — |
| [[subsystem-lab]] | 1 | 1 | root (2), kernel (2) |

<!-- grain:generated:end -->
