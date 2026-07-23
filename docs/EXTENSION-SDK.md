# Executor Extension SDK

An `ExecutorAdapter` exposes `probe`, `start`, `resume`, `steer`, `cancel`, and
`watch`. Results normalize summary, evidence, changed paths, usage, external
session identity, and structured failure.

The portable stdio bridge launches a configured binary directly, without a
shell. Grain writes one line to stdin:

```json
{"protocol":"grain-executor/v1","sessionId":null,"request":{"objective":"..."}}
```

`json` adapters return one `ExecutorResult`. `jsonl` adapters may first return:

```json
{"type":"status","message":"running tests"}
{"type":"result","result":{"success":true,"summary":"done","evidence":["tests"],"changedPaths":[]}}
```

Plain-text adapters are chat-only: Grain accepts their summary but accepts no
changed-path or verification claim. Exit success is not sufficient for patch
merge; writing agents still run in worktrees and must pass independent checks.

Agent profiles configure stdio commands as inline JSON frontmatter until the
profile parser gains full YAML support:

```md
---
id: my-agent
executor: stdio
command: {"binary":"my-agent","args":["--json"],"output":"jsonl"}
permissions: {"read":"allow","write":"deny"}
---
```
