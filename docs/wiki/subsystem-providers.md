---
id: subsystem-providers
title: "Subsystem: providers"
type: subsystem
status: current
owners: []
tags: ["generated","subsystem","providers"]
source_commit: 35ee9ad5014e572504b00b32c76b45c524e24633
generated_at: 2026-07-23T07:42:24.790Z
sources: [{"path":"src/providers/anthropic.ts","start_line":1,"end_line":87,"hash":"b526b897dd07a3003de4842967e306b9cbd7c88f69c1154de5ff8c5145a1eefa"},{"path":"src/providers/bedrock.ts","start_line":1,"end_line":110,"hash":"213e53cb44ed67a14ba6cee55018d8e5fcd7a832be4d4e839711b86c33be3f83"},{"path":"src/providers/cache.ts","start_line":1,"end_line":32,"hash":"11a664fc374deafec369032174760dccbc483cb3637391a752eeb34801db6063"},{"path":"src/providers/catalog.ts","start_line":1,"end_line":61,"hash":"b30e22c4fd9503b3e6524f1a3f233fae746f590a13cdb400e385989fb91657f4"},{"path":"src/providers/cli-agent.ts","start_line":1,"end_line":308,"hash":"69afa07db73023799df3de106540a35e9dabb5b315634bbcd57883cdfad91932"},{"path":"src/providers/groq.ts","start_line":1,"end_line":20,"hash":"766d701fddb5b4f06271407545406ea132981ca81a866943464e4b78091f2c3a"},{"path":"src/providers/index.ts","start_line":1,"end_line":87,"hash":"f965bd206c5faa0929b9cc7d3c2bb3dec338856ec40dddb97dbff60e56643957"},{"path":"src/providers/ollama.ts","start_line":1,"end_line":94,"hash":"c6c31ab5dc1ec3f7cc8a0c1f1a94cc3b17fcddaaf31884ebd34433a1ac2098a9"},{"path":"src/providers/openrouter.ts","start_line":1,"end_line":312,"hash":"abc6f6661c180abd503e2acaaa3e77373e79249d8f63e30b7a844ba80338e709"},{"path":"src/providers/registry.ts","start_line":1,"end_line":180,"hash":"3e936cedf71d86acee72575da3a3385ae069708061b64e9d8ba3a356acb96d47"},{"path":"src/providers/subprocess.ts","start_line":1,"end_line":115,"hash":"15f40b047018fd7c922661af051b516a31a771dc9efae49584fac1595c6a74ea"},{"path":"src/providers/types.ts","start_line":1,"end_line":100,"hash":"bd9e496098f05e276a4e8359a02d03d52198641b9655de175cf934023cd0947a"},{"path":"src/providers/vllm.ts","start_line":1,"end_line":238,"hash":"a6eef9e2ac77978100e21fdad0ab3d78120f0d34b834ed83389a8b8c6c3092ee"},{"path":"src/providers/xai.ts","start_line":1,"end_line":12,"hash":"cc6ac6c4d8e607b29d894f69fdb5e15e09e3d75d9108865ffa173bffd5f61f20"}]
---
# Subsystem: providers

Maintained by Grain. Add durable human notes above the generated region — they are preserved across rebuilds.

<!-- grain:generated:start -->
# Subsystem: providers

51 symbol(s) across 14 file(s) — 24 function, 18 type, 9 class.

## Most depended-on symbols

- **getProvider** (function) · `src/providers/index.ts:54`
- **normalizeProviderError** (function) · `src/providers/types.ts:47`
- **delegateToClaudeCode** (function) · `src/providers/subprocess.ts:11`
- **delegateToCodex** (function) · `src/providers/subprocess.ts:71`
- **isCliAgentProvider** (function) · `src/providers/cli-agent.ts:55`
- **AnthropicProvider** (class) · `src/providers/anthropic.ts:7`
- **applyHistoryCache** (function) · `src/providers/cache.ts:19`
- **applyToolCache** (function) · `src/providers/cache.ts:9`
- **BedrockProvider** (class) · `src/providers/bedrock.ts:7`
- **buildAgentPrompt** (function) · `src/providers/cli-agent.ts:117`
- **buildModelRegistry** (function) · `src/providers/registry.ts:86`
- **cachedSystem** (function) · `src/providers/cache.ts:14`

## Files

- `src/providers/anthropic.ts`
- `src/providers/bedrock.ts`
- `src/providers/cache.ts`
- `src/providers/catalog.ts`
- `src/providers/cli-agent.ts`
- `src/providers/groq.ts`
- `src/providers/index.ts`
- `src/providers/ollama.ts`
- `src/providers/openrouter.ts`
- `src/providers/registry.ts`
- `src/providers/subprocess.ts`
- `src/providers/types.ts`
- `src/providers/vllm.ts`
- `src/providers/xai.ts`

## Depends on

- [[subsystem-root]] — 1 reference(s)

See also [[architecture]].

<!-- grain:generated:end -->
