---
id: subsystem-kernel
title: "Subsystem: kernel"
type: subsystem
status: current
owners: []
tags: ["generated","subsystem","kernel"]
source_commit: 35ee9ad5014e572504b00b32c76b45c524e24633
generated_at: 2026-07-23T07:42:24.802Z
sources: [{"path":"src/kernel/engine.ts","start_line":1,"end_line":36,"hash":"4288af4155f384cfc69c3f0fd7e96fc9274979651a8fe45469f417e7a5f22ccf"},{"path":"src/kernel/journal.ts","start_line":1,"end_line":168,"hash":"e8d926eec446242a7a7833903cdb6f1647a6538889bd57b57a006e5836e24ef5"},{"path":"src/kernel/redaction.ts","start_line":1,"end_line":17,"hash":"f37f6563355b7ae8bb3b554673315328c5d076f11e7963e6fb6eca9e6cda56df"},{"path":"src/kernel/service.ts","start_line":1,"end_line":103,"hash":"ffa9a3013e32c5f7333c1a358a75f85430fad6f17b204a6a671899f971a8c586"},{"path":"src/kernel/types.ts","start_line":1,"end_line":139,"hash":"328f2c238d9f430afe2814a1d240bd157cc8db4f22601b9757571b7bdb2994d5"}]
---
# Subsystem: kernel

Maintained by Grain. Add durable human notes above the generated region — they are preserved across rebuilds.

<!-- grain:generated:start -->
# Subsystem: kernel

23 symbol(s) across 5 file(s) — 13 type, 6 function, 4 class.

## Most depended-on symbols

- **listRuns** (function) · `src/kernel/journal.ts:36`
- **readRunEvents** (function) · `src/kernel/journal.ts:58`
- **RunEngine** (class) · `src/kernel/engine.ts:4`
- **RunService** (class) · `src/kernel/service.ts:35`
- **replayRun** (function) · `src/kernel/journal.ts:78`
- **runDirectory** (function) · `src/kernel/journal.ts:32`
- **CreateRunInput** (type) · `src/kernel/service.ts:23`
- **eventHash** (function) · `src/kernel/journal.ts:28`
- **ReconciliationResolution** (type) · `src/kernel/types.ts:127`
- **redactTrajectory** (function) · `src/kernel/redaction.ts:4`
- **RunBudget** (type) · `src/kernel/types.ts:116`
- **RunCommand** (type) · `src/kernel/types.ts:128`

## Files

- `src/kernel/engine.ts`
- `src/kernel/journal.ts`
- `src/kernel/redaction.ts`
- `src/kernel/service.ts`
- `src/kernel/types.ts`

See also [[architecture]].

<!-- grain:generated:end -->
