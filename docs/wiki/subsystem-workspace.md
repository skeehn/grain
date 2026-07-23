---
id: subsystem-workspace
title: "Subsystem: workspace"
type: subsystem
status: current
owners: []
tags: ["generated","subsystem","workspace"]
source_commit: 35ee9ad5014e572504b00b32c76b45c524e24633
generated_at: 2026-07-23T07:42:24.799Z
sources: [{"path":"src/workspace/app.ts","start_line":1,"end_line":236,"hash":"9ef7462cd0009d9fd2871e1cfcaa34b4b7c92158b1b8deca71d8465e2f0cf8eb"},{"path":"src/workspace/filesystem.ts","start_line":1,"end_line":211,"hash":"027e01d9834d549875b0be5916997b89f03c27939df41a2c485ce3adaf0bd9e0"},{"path":"src/workspace/root.ts","start_line":1,"end_line":19,"hash":"c694c25d205d178e25808c876138bafa55fa0e9cf41afe184c55ed8845244a77"},{"path":"src/workspace/setup.ts","start_line":1,"end_line":130,"hash":"849183eb424a8392086c35eb67b54df97a0dd2fedc6b392f75c3929790efc1a4"},{"path":"src/workspace/transactions.ts","start_line":1,"end_line":75,"hash":"2aab2c1723722b89ba66b402745bd578bce2121ec9574f08cf35ba024fdb79d9"},{"path":"src/workspace/types.ts","start_line":1,"end_line":60,"hash":"e72ec9418b20409aa2e4a0face4641552becfef4de6f2c0d1936021f3a6dccd2"}]
---
# Subsystem: workspace

Maintained by Grain. Add durable human notes above the generated region — they are preserved across rebuilds.

<!-- grain:generated:start -->
# Subsystem: workspace

32 symbol(s) across 6 file(s) — 18 type, 12 function, 2 class.

## Most depended-on symbols

- **getWorkspaceFS** (function) · `src/workspace/filesystem.ts:206`
- **WorkspaceTransactionManager** (class) · `src/workspace/transactions.ts:10`
- **ensureWorkspaceSetup** (function) · `src/workspace/setup.ts:91`
- **resolveWorkspace** (function) · `src/workspace/root.ts:8`
- **runWorkspace** (function) · `src/workspace/app.ts:187`
- **ComposerInput** (type) · `src/workspace/app.ts:23`
- **detectAgentClis** (function) · `src/workspace/setup.ts:62`
- **detectOllama** (function) · `src/workspace/setup.ts:75`
- **discoverProviders** (function) · `src/workspace/setup.ts:26`
- **FileOperation** (type) · `src/workspace/types.ts:39`
- **FilePrecondition** (type) · `src/workspace/types.ts:38`
- **FileSnapshot** (type) · `src/workspace/types.ts:1`

## Files

- `src/workspace/app.ts`
- `src/workspace/filesystem.ts`
- `src/workspace/root.ts`
- `src/workspace/setup.ts`
- `src/workspace/transactions.ts`
- `src/workspace/types.ts`

## Depends on

- [[subsystem-tui]] — 7 reference(s)
- [[subsystem-tools]] — 1 reference(s)
- [[subsystem-root]] — 1 reference(s)
- [[subsystem-agent]] — 1 reference(s)
- [[subsystem-session]] — 1 reference(s)

See also [[architecture]].

<!-- grain:generated:end -->
