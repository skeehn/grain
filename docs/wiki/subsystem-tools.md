---
id: subsystem-tools
title: "Subsystem: tools"
type: subsystem
status: current
owners: []
tags: ["generated","subsystem","tools"]
source_commit: 81789a2c9ee13b74dcf6cca2b8e43d39cf70e745
generated_at: 2026-07-23T07:27:54.193Z
sources: [{"path":"src/tools/ask-user.ts","start_line":1,"end_line":40,"hash":"603e8fc5c2f506a823d02cc626a89e3322af3d54f5c14486b0dbc4cf848ef8d0"},{"path":"src/tools/bash.ts","start_line":1,"end_line":261,"hash":"5e2b62a3c25c093edb15d5d647c840f6460acfb77ae17d1c317f2cc75425af6a"},{"path":"src/tools/code-index.ts","start_line":1,"end_line":177,"hash":"cddf578c3db04d96d862934c5fede6c8be46126e91e385fa4d58a604e9ed060b"},{"path":"src/tools/code-search.ts","start_line":1,"end_line":45,"hash":"125c003449b01b34abe284ce42b5466774fba5968837b5d5ded876048da1b881"},{"path":"src/tools/contract.ts","start_line":1,"end_line":16,"hash":"5846b947f9d6e2dedaba9706c2674150a05212a40e8a8c1a4c398dd46d431069"},{"path":"src/tools/delegate.ts","start_line":1,"end_line":143,"hash":"8c41e0005be5d1eac5b5cf5b591b93c14fecdd290fdf3549772a22261d14771a"},{"path":"src/tools/engram.ts","start_line":1,"end_line":403,"hash":"c2d0a5f312d2096bc44d0a31b48efb058bda44b54b3a6321f0a2faa24a6bb239"},{"path":"src/tools/finish.ts","start_line":1,"end_line":24,"hash":"b5be0751bb1711ba1922ced4cd685e7fdbc33e71e98ce5618bc314568a401d73"},{"path":"src/tools/git.ts","start_line":1,"end_line":99,"hash":"cc7aa5352972ff65f20b5e65079866a4e9753df5c9d71b46001330af56ce3070"},{"path":"src/tools/grep.ts","start_line":1,"end_line":30,"hash":"dbfa63d2230e7fa373222c83395b5e4f06efe613a634fb77f88cb72e628f2789"},{"path":"src/tools/index.ts","start_line":1,"end_line":186,"hash":"d3d01d505669f9f6244dc9dfda07414ba9e20f3feee132c1fecf038e4517558a"},{"path":"src/tools/inspect.ts","start_line":1,"end_line":16,"hash":"e5e51f34d5c473b8aa19909dbbedd6cf42a6f4f8c4bdc2e44c16f351bc177e43"},{"path":"src/tools/knowledge-graph.ts","start_line":1,"end_line":779,"hash":"9219aca8aa1caeea6803341969338411dd9e26378c71d5ece7cfd3ef7a0b750c"},{"path":"src/tools/multi-edit.ts","start_line":1,"end_line":168,"hash":"0403ad82707b2b0a1ca177cdcc92dae1b43994c4fa289daf097a8223fa46a86f"},{"path":"src/tools/patch.ts","start_line":1,"end_line":92,"hash":"57743af21c9553c73866a0ede5a588f6ab78192adb271d33aecd61351bcef442"},{"path":"src/tools/plan.ts","start_line":1,"end_line":156,"hash":"d136e4dd6bd78eeb675411fdcba566eb42a1bb5dafd2a7b8f9ca105281d7c149"},{"path":"src/tools/project-explainer.ts","start_line":1,"end_line":692,"hash":"5895240e7fb3fd94bfda5655dc0a5f9b36322862f73dd2c4eb710a9968b6da51"},{"path":"src/tools/project-explainer/analyzers.ts","start_line":1,"end_line":230,"hash":"8922ed2a0130d06fed5a9567a99e2a4f4cdff06e50739d44594eba9d26027cab"},{"path":"src/tools/project-explainer/detectors.ts","start_line":1,"end_line":97,"hash":"fd8357c03d665b6a5b79e4e4968da0f78a431089f1e21586e48853a04fdd7c1b"},{"path":"src/tools/project-explainer/file-utils.ts","start_line":1,"end_line":102,"hash":"8f49493079c0061369a917ab0dacc946f5b32324e4277109890305c3158afa7f"},{"path":"src/tools/read.ts","start_line":1,"end_line":32,"hash":"6fee651895ef5ad3cd648ac2a5b881f4f78b6705a4f2c925cac38b65f1dd802c"},{"path":"src/tools/repo-map.ts","start_line":1,"end_line":227,"hash":"42c92252d03355e2a4eea9cc78bb08c0a299225f0f7c1c20c55ca08fb56a8906"},{"path":"src/tools/screenshot.ts","start_line":1,"end_line":70,"hash":"f6f43cae1bd048767d85d64e616a8d1c92a41e88a1cda2c427c61eda6d473fc6"},{"path":"src/tools/search.ts","start_line":1,"end_line":11,"hash":"e82a6cf4ee8e548cf51927f339a860fa5278bd038d4279bec3c006887cb3b682"},{"path":"src/tools/semantic-search.ts","start_line":1,"end_line":73,"hash":"0a5d80fd083716d66663514f58d7235442ddc0e53fb68849b99791ee235bbb64"},{"path":"src/tools/spawn-agent.ts","start_line":1,"end_line":139,"hash":"38e317649da2af3762f3d5bba200409bb03e26d0e7d58b2e5c228cd332aa910f"},{"path":"src/tools/test-fix-loop.ts","start_line":1,"end_line":211,"hash":"1bdbb3e791f46f5933a75bc6b783877b376989b39c9b3b37e2024229fd581836"},{"path":"src/tools/test-runner.ts","start_line":1,"end_line":255,"hash":"a8d4e0e049180336b2c3a13b35d32310c3cf9f3aa36ace1d35e4400f381a3ae0"},{"path":"src/tools/wiki.ts","start_line":1,"end_line":59,"hash":"e05a55afe90c52537c638448baf17fbd5fa935e9253fd22a77830d043fc9d43e"},{"path":"src/tools/work.ts","start_line":1,"end_line":76,"hash":"d6178d78677403491c8e13f15f78915a3b460b3678581dc48bbb8b15f5177d37"},{"path":"src/tools/workspace.ts","start_line":1,"end_line":138,"hash":"971487dd6c6e210de47fb8ff37f3ebdb7feddda6d5534f878fd9ffd2a521c319"},{"path":"src/tools/write.ts","start_line":1,"end_line":100,"hash":"517b3fe89d0c5f7d4f990cd4c8d5987fb6addc40a9976e9152e3c62e4e620fef"}]
---
# Subsystem: tools

Maintained by Grain. Add durable human notes above the generated region — they are preserved across rebuilds.

<!-- grain:generated:start -->
# Subsystem: tools

87 symbol(s) across 32 file(s) — 66 function, 21 type.

## Most depended-on symbols

- **destroyShell** (function) · `src/tools/bash.ts:100`
- **executeEngram** (function) · `src/tools/engram.ts:233`
- **setToolCwd** (function) · `src/tools/index.ts:41`
- **drainPendingScreenshots** (function) · `src/tools/screenshot.ts:24`
- **executeBash** (function) · `src/tools/bash.ts:216`
- **extractKnowledgeGraph** (function) · `src/tools/knowledge-graph.ts:35`
- **hasPendingScreenshots** (function) · `src/tools/screenshot.ts:25`
- **registerDynamicTool** (function) · `src/tools/index.ts:164`
- **retrieveCodeContext** (function) · `src/tools/code-index.ts:172`
- **setBashOutputSink** (function) · `src/tools/bash.ts:214`
- **setQuestionJournal** (function) · `src/tools/ask-user.ts:7`
- **setQuestionPrompt** (function) · `src/tools/ask-user.ts:8`

## Files

- `src/tools/ask-user.ts`
- `src/tools/bash.ts`
- `src/tools/code-index.ts`
- `src/tools/code-search.ts`
- `src/tools/contract.ts`
- `src/tools/delegate.ts`
- `src/tools/engram.ts`
- `src/tools/finish.ts`
- `src/tools/git.ts`
- `src/tools/grep.ts`
- `src/tools/index.ts`
- `src/tools/inspect.ts`
- `src/tools/knowledge-graph.ts`
- `src/tools/multi-edit.ts`
- `src/tools/patch.ts`
- `src/tools/plan.ts`
- `src/tools/project-explainer.ts`
- `src/tools/project-explainer/analyzers.ts`
- `src/tools/project-explainer/detectors.ts`
- `src/tools/project-explainer/file-utils.ts`
- `src/tools/read.ts`
- `src/tools/repo-map.ts`
- `src/tools/screenshot.ts`
- `src/tools/search.ts`
- `src/tools/semantic-search.ts`
- `src/tools/spawn-agent.ts`
- `src/tools/test-fix-loop.ts`
- `src/tools/test-runner.ts`
- `src/tools/wiki.ts`
- `src/tools/work.ts`
- `src/tools/workspace.ts`
- `src/tools/write.ts`

## Depends on

- [[subsystem-workspace]] — 12 reference(s)
- [[subsystem-docs]] — 6 reference(s)
- [[subsystem-wiki]] — 4 reference(s)
- [[subsystem-agent]] — 4 reference(s)
- [[subsystem-root]] — 3 reference(s)
- [[subsystem-providers]] — 3 reference(s)
- [[subsystem-engram]] — 3 reference(s)

See also [[architecture]].

<!-- grain:generated:end -->
