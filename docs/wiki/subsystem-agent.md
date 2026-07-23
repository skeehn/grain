---
id: subsystem-agent
title: "Subsystem: agent"
type: subsystem
status: current
owners: []
tags: ["generated","subsystem","agent"]
source_commit: 35ee9ad5014e572504b00b32c76b45c524e24633
generated_at: 2026-07-23T07:42:24.797Z
sources: [{"path":"src/agent/changed-files.ts","start_line":1,"end_line":46,"hash":"69696ee62b192059f6b994a8ca6686bee6f58b329ade7974d7fca5a0bc83f8f3"},{"path":"src/agent/checkpoint.ts","start_line":1,"end_line":41,"hash":"fd9ae3bfd556e117507bec28f2d4227963ed3fb418bff00d1cec36e9fc3cba20"},{"path":"src/agent/context-tracker.ts","start_line":1,"end_line":229,"hash":"2a886eb0aab4a95f67489116e98a5ca16e585b387effa20cade2d005e6de844d"},{"path":"src/agent/context.ts","start_line":1,"end_line":358,"hash":"8b9d9948bfa7720fca4adbda359378d6634f0c417b9bab01050fb5ab3baa5ac9"},{"path":"src/agent/loop.ts","start_line":1,"end_line":1051,"hash":"521619ed3c3bd87b0c746a6a1e1696c4862ff0f00e873d422aeabda7c3d2bacd"},{"path":"src/agent/loop/plan-parser.ts","start_line":1,"end_line":40,"hash":"ece028f6346dde9377125aa56bfafa94c9553fcbe5f5a7f46dbe9b3859dcac4d"},{"path":"src/agent/orchestrator.tsx","start_line":1,"end_line":49,"hash":"574ac0c0faba317ad3ddec7ce1b8b9cad1d3437a74f955bcca28642101fcce67"},{"path":"src/agent/verify.ts","start_line":1,"end_line":36,"hash":"30c5b95d056b66604d2d0b736f4b6f7e517d42701b770bfc1918b26b17f60a94"}]
---
# Subsystem: agent

Maintained by Grain. Add durable human notes above the generated region — they are preserved across rebuilds.

<!-- grain:generated:start -->
# Subsystem: agent

34 symbol(s) across 8 file(s) — 26 function, 8 type.

## Most depended-on symbols

- **getContextTracker** (function) · `src/agent/context-tracker.ts:206`
- **agentLoop** (function) · `src/agent/loop.ts:286`
- **snapshotBeforeEdit** (function) · `src/agent/checkpoint.ts:16`
- **AgentOpts** (type) · `src/agent/loop.ts:34`
- **AgentUi** (type) · `src/agent/loop.ts:66`
- **AgentWorkspaceEvent** (type) · `src/agent/loop.ts:83`
- **boundToolResult** (function) · `src/agent/context.ts:52`
- **changedFileCount** (function) · `src/agent/checkpoint.ts:24`
- **changedFiles** (function) · `src/agent/checkpoint.ts:25`
- **cleanSummary** (function) · `src/agent/loop.ts:103`
- **combineSteering** (function) · `src/agent/loop.ts:92`
- **compact** (function) · `src/agent/context.ts:223`

## Files

- `src/agent/changed-files.ts`
- `src/agent/checkpoint.ts`
- `src/agent/context-tracker.ts`
- `src/agent/context.ts`
- `src/agent/loop.ts`
- `src/agent/loop/plan-parser.ts`
- `src/agent/orchestrator.tsx`
- `src/agent/verify.ts`

## Depends on

- [[subsystem-tui]] — 15 reference(s)
- [[subsystem-tools]] — 12 reference(s)
- [[subsystem-session]] — 7 reference(s)
- [[subsystem-root]] — 4 reference(s)
- [[subsystem-router]] — 4 reference(s)
- [[subsystem-workspace]] — 3 reference(s)
- [[subsystem-context]] — 3 reference(s)
- [[subsystem-providers]] — 3 reference(s)
- [[subsystem-mcp]] — 2 reference(s)
- [[subsystem-docs]] — 2 reference(s)
- [[subsystem-skills]] — 1 reference(s)
- [[subsystem-kernel]] — 1 reference(s)
- [[subsystem-policy]] — 1 reference(s)
- [[subsystem-engram]] — 1 reference(s)

See also [[architecture]].

<!-- grain:generated:end -->
