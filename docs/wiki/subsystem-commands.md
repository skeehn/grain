---
id: subsystem-commands
title: "Subsystem: commands"
type: subsystem
status: current
owners: []
tags: ["generated","subsystem","commands"]
source_commit: 81789a2c9ee13b74dcf6cca2b8e43d39cf70e745
generated_at: 2026-07-23T07:27:54.218Z
sources: [{"path":"src/commands/agents.ts","start_line":1,"end_line":109,"hash":"ecc467aa6c4761dfd2ff38bca763148ea643c75c95bd404c5e2de73020b0ea46"},{"path":"src/commands/config.ts","start_line":1,"end_line":255,"hash":"b23d32826e8c68bf2865c05af69fa2d9b9e35191ba1714898375b0459d2a4b71"},{"path":"src/commands/daemon.ts","start_line":1,"end_line":100,"hash":"d5128a15156788a04daefe2326574dffceb9da9aa446c7f2f40730d4acdc513b"},{"path":"src/commands/doctor.ts","start_line":1,"end_line":82,"hash":"cf190065a7489ab08bfaaec226853799a0217663c2099dd953fce1deecce86c8"},{"path":"src/commands/jobs.ts","start_line":1,"end_line":63,"hash":"4ef0f8000958ff925fb51bd9b2d711aaf8866f9fad6a53961aa033715375e873"},{"path":"src/commands/lab.ts","start_line":1,"end_line":4,"hash":"8ac7b052faf2add2318785bac2a5a241929a88d885c48579268e23dc9a744f7f"},{"path":"src/commands/learning.ts","start_line":1,"end_line":34,"hash":"fa91b3059ef4224c142886ad077b3f07020240a5ef35eeb901eac6d7c469b99e"},{"path":"src/commands/runs.ts","start_line":1,"end_line":21,"hash":"c50affe634fd03f82086c7d78a68bf6917cd986d071fc6df73891f19ef387ea0"},{"path":"src/commands/wiki.ts","start_line":1,"end_line":53,"hash":"3b3fbc810a761b3a20a82a087529d815f97a9661a8595bd3d5b4c7a816d2f545"},{"path":"src/commands/work.ts","start_line":1,"end_line":83,"hash":"5b76e780a2eb8620697d40cd20d216f69a2cf4b02915c3b466153e4c15b9e669"}]
---
# Subsystem: commands

Maintained by Grain. Add durable human notes above the generated region — they are preserved across rebuilds.

<!-- grain:generated:start -->
# Subsystem: commands

21 symbol(s) across 10 file(s) — 19 function, 2 type.

## Most depended-on symbols

- **addNote** (function) · `src/commands/work.ts:26`
- **createTemplate** (function) · `src/commands/agents.ts:9`
- **daemonPid** (function) · `src/commands/daemon.ts:11`
- **DoctorCheck** (type) · `src/commands/doctor.ts:7`
- **DoctorStatus** (type) · `src/commands/doctor.ts:6`
- **formatEntry** (function) · `src/commands/work.ts:13`
- **handleAgentsCommand** (function) · `src/commands/agents.ts:41`
- **handleConfigShow** (function) · `src/commands/config.ts:73`
- **handleDaemonCommand** (function) · `src/commands/daemon.ts:59`
- **handleDoctorCommand** (function) · `src/commands/doctor.ts:71`
- **handleJobsCommand** (function) · `src/commands/jobs.ts:22`
- **handleLabCommand** (function) · `src/commands/lab.ts:3`

## Files

- `src/commands/agents.ts`
- `src/commands/config.ts`
- `src/commands/daemon.ts`
- `src/commands/doctor.ts`
- `src/commands/jobs.ts`
- `src/commands/lab.ts`
- `src/commands/learning.ts`
- `src/commands/runs.ts`
- `src/commands/wiki.ts`
- `src/commands/work.ts`

## Depends on

- [[subsystem-orchestration]] — 14 reference(s)
- [[subsystem-docs]] — 6 reference(s)
- [[subsystem-tui]] — 5 reference(s)
- [[subsystem-root]] — 5 reference(s)
- [[subsystem-kernel]] — 3 reference(s)
- [[subsystem-wiki]] — 2 reference(s)
- [[subsystem-plugins]] — 2 reference(s)
- [[subsystem-learning]] — 2 reference(s)
- [[subsystem-session]] — 2 reference(s)
- [[subsystem-mcp]] — 2 reference(s)
- [[subsystem-schedules]] — 1 reference(s)
- [[subsystem-agent]] — 1 reference(s)

See also [[architecture]].

<!-- grain:generated:end -->
