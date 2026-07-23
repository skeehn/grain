---
id: subsystem-root
title: "Subsystem: root"
type: subsystem
status: current
owners: []
tags: ["generated","subsystem","root"]
source_commit: 81789a2c9ee13b74dcf6cca2b8e43d39cf70e745
generated_at: 2026-07-23T07:27:54.221Z
sources: [{"path":"src/attachments.ts","start_line":1,"end_line":33,"hash":"31a1c4a029b4f172282f64e5576dccea89242d68c4b817f7b6e47448893102ff"},{"path":"src/cli.ts","start_line":1,"end_line":1031,"hash":"1292c6956e327e393d1d17d0df43284ef38689dee72dcc0174ee0ac7235c21c6"},{"path":"src/config.ts","start_line":1,"end_line":223,"hash":"31a8b9df7b40b273ac2d27ed44fe651061351d19956f1327cf170327a52184b5"},{"path":"src/system-prompt.ts","start_line":1,"end_line":77,"hash":"8b9afbd6a2c2c766020d3c89d5e4545ae46e9d1ae972615ec591dbc5559de95a"}]
---
# Subsystem: root

Maintained by Grain. Add durable human notes above the generated region — they are preserved across rebuilds.

<!-- grain:generated:start -->
# Subsystem: root

18 symbol(s) across 4 file(s) — 14 function, 4 type.

## Most depended-on symbols

- **loadConfig** (function) · `src/config.ts:174`
- **getSystemPrompt** (function) · `src/system-prompt.ts:5`
- **saveConfig** (function) · `src/config.ts:187`
- **getConfigDir** (function) · `src/config.ts:149`
- **listEnvKeys** (function) · `src/config.ts:119`
- **queueAttachment** (function) · `src/attachments.ts:19`
- **validateConfig** (function) · `src/config.ts:195`
- **AttachmentKind** (type) · `src/attachments.ts:6`
- **classifyAttachment** (function) · `src/attachments.ts:12`
- **ensureConfigDir** (function) · `src/config.ts:136`
- **ensureEngramRunning** (function) · `src/cli.ts:276`
- **GrainAttachment** (type) · `src/attachments.ts:7`

## Files

- `src/attachments.ts`
- `src/cli.ts`
- `src/config.ts`
- `src/system-prompt.ts`

## Depends on

- [[subsystem-kernel]] — 1 reference(s)

See also [[architecture]].

<!-- grain:generated:end -->
