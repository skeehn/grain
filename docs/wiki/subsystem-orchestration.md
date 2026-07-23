---
id: subsystem-orchestration
title: "Subsystem: orchestration"
type: subsystem
status: current
owners: []
tags: ["generated","subsystem","orchestration"]
source_commit: 81789a2c9ee13b74dcf6cca2b8e43d39cf70e745
generated_at: 2026-07-23T07:27:54.203Z
sources: [{"path":"src/orchestration/dashboard.ts","start_line":1,"end_line":82,"hash":"462df463095f56f06864d176b3f5ab11379061479bbedd0ae2a588f739e9f537"},{"path":"src/orchestration/executors.ts","start_line":1,"end_line":244,"hash":"2d25f00859839fe0457e886a38dda2579c5501d90dd59b161c1b0ea34627ed50"},{"path":"src/orchestration/external-executor.ts","start_line":1,"end_line":91,"hash":"09c4912c1bc0183606f0f8cd65ef573b6e73191e08a7edc8052b1c82c72d2832"},{"path":"src/orchestration/grain-executor.ts","start_line":1,"end_line":121,"hash":"19a26c2e0328b1983c95643fc80a86d3edb8246a067a08f838e63f7de262a19c"},{"path":"src/orchestration/mailbox.ts","start_line":1,"end_line":32,"hash":"9e2697b350002710799453d2cd776ee2d27fb3176d48a7f7bead5a9461618519"},{"path":"src/orchestration/profile-executor.ts","start_line":1,"end_line":85,"hash":"0992f9eb2fde66ab73e4cfb051975e71ed2277dce170aeea0384bbb4dda1426e"},{"path":"src/orchestration/profiles.ts","start_line":1,"end_line":79,"hash":"8b5e276997f726aeb6bbb80e3adb0ae46bfb492777c61dabb86ad5da116f0bbe"},{"path":"src/orchestration/runtime.ts","start_line":1,"end_line":80,"hash":"1410309fc7854cd1d7188d5782a86d6083d0735d05c32f136c393a12a4544319"},{"path":"src/orchestration/scheduler.ts","start_line":1,"end_line":131,"hash":"cd11f0ea67d11382063990e65c0a936ae36f67024e7ed23e91f9b5aa17794b18"},{"path":"src/orchestration/store.ts","start_line":1,"end_line":54,"hash":"b05105d54b62afdfe7588dd00e1128cfae557470461957e65b9aacec9239fcf1"},{"path":"src/orchestration/types.ts","start_line":1,"end_line":128,"hash":"a9e75f302cbb0a063ba31834b43010099dfddd8b79aa699e003cac2e672abb23"},{"path":"src/orchestration/workflows.ts","start_line":1,"end_line":57,"hash":"f5dacc792c6dc6ced3e66ddf2e73cb3c154bdc42ac811714299c11cf31b5424a"},{"path":"src/orchestration/worktree.ts","start_line":1,"end_line":85,"hash":"ac9f959b7d423abb1cf421bbf171d2c0b56b1991fdda6bb26dbd83a694178d7f"}]
---
# Subsystem: orchestration

Maintained by Grain. Add durable human notes above the generated region — they are preserved across rebuilds.

<!-- grain:generated:start -->
# Subsystem: orchestration

50 symbol(s) across 13 file(s) — 31 type, 12 class, 7 function.

## Most depended-on symbols

- **loadAgentProfiles** (function) · `src/orchestration/profiles.ts:53`
- **AgentScheduler** (class) · `src/orchestration/scheduler.ts:4`
- **validateAgentProfiles** (function) · `src/orchestration/profiles.ts:68`
- **AgentMailbox** (class) · `src/orchestration/mailbox.ts:9`
- **DurableAgentRuntime** (class) · `src/orchestration/runtime.ts:9`
- **executeProfileGraph** (function) · `src/orchestration/profile-executor.ts:58`
- **ExternalAgentExecutor** (class) · `src/orchestration/external-executor.ts:12`
- **TaskGraphStore** (class) · `src/orchestration/store.ts:22`
- **watchAgentGraph** (function) · `src/orchestration/dashboard.ts:23`
- **WorkflowRunner** (class) · `src/orchestration/workflows.ts:6`
- **WorktreeManager** (class) · `src/orchestration/worktree.ts:31`
- **AgentAuthority** (type) · `src/orchestration/types.ts:81`

## Files

- `src/orchestration/dashboard.ts`
- `src/orchestration/executors.ts`
- `src/orchestration/external-executor.ts`
- `src/orchestration/grain-executor.ts`
- `src/orchestration/mailbox.ts`
- `src/orchestration/profile-executor.ts`
- `src/orchestration/profiles.ts`
- `src/orchestration/runtime.ts`
- `src/orchestration/scheduler.ts`
- `src/orchestration/store.ts`
- `src/orchestration/types.ts`
- `src/orchestration/workflows.ts`
- `src/orchestration/worktree.ts`

## Depends on

- [[subsystem-root]] — 1 reference(s)
- [[subsystem-tui]] — 1 reference(s)
- [[subsystem-kernel]] — 1 reference(s)

See also [[architecture]].

<!-- grain:generated:end -->
