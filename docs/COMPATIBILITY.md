# Compatibility Matrix

Status meanings: `working` has deterministic tests, `experimental` needs live or
soak qualification, `planned` is not shipped.

| Surface | macOS | Linux | Status |
|---|---:|---:|---|
| Bun development/runtime | CI | CI | working |
| Full-screen TUI | two PTY command/workflow smokes + unit/snapshot | unit/snapshot | experimental; full Linux PTY matrix pending |
| Classic line workspace | tested | tested | working |
| Anthropic, Bedrock, OpenRouter, Groq | mock contract; OpenRouter free live | mock contract | working; repeated live matrix pending |
| xAI/Grok, Ollama, vLLM | mock/config | mock/config | experimental |
| Claude Code, Codex | Codex live; Claude authenticated/quota-blocked | parser/contract | experimental repeated live matrix |
| OpenCode, Hermes | live smoke | adapter contract | experimental repeated live matrix |
| Generic JSON/JSONL stdio | deterministic | deterministic | working |
| Engram legacy | live HTTP search + fallback tests; 200/200/200 node/index consistency verified | fallback tests | working |
| Engram `/v1` | fake-server contract | fake-server contract | blocked on Engram PR |
| Harbor bridge | live Docker canary, reward 1.0 | adapter/unit only | experimental; strict result gate works, full Linux datasets pending |
| Windows | — | — | planned after 1.0 |

No benchmark or SOTA qualification is currently claimed.
