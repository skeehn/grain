# Grain 1.0: Evidence-Gated Roadmap

Last reconciled: 2026-07-22

This is Grain's delivery contract. It separates implemented behavior from
qualified behavior. “SOTA” is an external measurement, never a self-assigned
release label.

## Status language

| Status | Meaning |
|---|---|
| Working | Implemented and covered by repository tests |
| Partial | Useful path exists; important behavior or E2E coverage is missing |
| Experimental | Expert workflow whose compatibility may change |
| Unqualified | Implemented but scale, soak, or external evaluation is incomplete |
| Planned | No production implementation is claimed |

## Reconciled baseline

| Area | Status | Current boundary |
|---|---|---|
| Full-screen TUI | Partial | Chat, inspectors, commands, cancellation, durable queued steering, Unicode cursor editing, history, multiline paste, responsive active-view navigation, compact grouped help, word-aware wrapping, and themes work. Two macOS PTY command/workflow/restore smokes pass, including no-alternate-screen; search overlays, syntax highlighting, selection, Linux PTY qualification, and soak remain. |
| Print/classic modes | Working | They use the same agent loop as the TUI and jobs. |
| Run kernel | Partial | Hash-chained schema-v3 journals, commands, `RunService`, correlation IDs, and fail-safe recovery exist. Some lifecycle choices remain in the agent loop. |
| Sessions | Working | Schema-v2 parent-linked entries, active branches, locked writes, legacy migration, archived evicted turns, and append-only compaction evidence are tested. |
| Providers | Partial | Bedrock, Anthropic, OpenRouter, Groq, Ollama, vLLM, and xAI exist. Normalized model descriptors/errors, cancellation propagation, selected-model events, and live OpenRouter catalog parsing exist; xAI live-key and the complete adapter matrix remain. |
| OpenRouter free | Working | `openrouter/free`, bounded retries, a live capability-filtered fallback pool limited to three compatible routes, fragmented parallel tool calls, and a 2026-07-22 Harbor coding canary are verified. Future free-model availability remains external. |
| Context | Partial | Manifest-v2 packing controls retrieved context; request-time history fitting preserves tool-call/result groups and journals omissions/truncation without mutating durable sessions. Provider-native tokenization and model-generated hierarchical summaries remain. |
| Tools/policy | Working | Workspace confinement, approvals, transactions, checkpoints, rollback, bounded output, and verification paths are tested. Fuzzing remains unqualified. |
| MCP | Working | Stdio/HTTP discovery, lifecycle, allowlisting, packing, and regressions are tested. Broad ecosystem qualification remains. |
| Multi-agent | Partial | Versioned heterogeneous profiles, bounded recursive graphs, aggregate budgets, worktrees, mailboxes, cancellation, parent/child run events, and merge transactions exist. Full journal unification and stress qualification remain. |
| Jobs | Partial | Versioned storage, locks, timezone cron, atomic leases, CLI/TUI execution, and readiness-aware daemon lifecycle exist. Long-duration and OS-service qualification remain. |
| Memory/learning | Partial | Typed `/v1` negotiation, governed candidates, scoped recall, and Grain-side inspect/edit/forget/export/rebuild controls exist. Engram server implementation, migrations, promotion endpoints, and retrieval evaluation remain. |
| Benchmarks | Experimental | Harbor 0.20 adapter, isolated bridge canary, pinned Terminal-Bench 2.0 manifest, aggregate reports, and strict result validation exist. The live canary earned verifier reward 1.0 with zero exceptions; full official datasets and repeated comparisons remain. No leadership claim is made. |

The current suite has 374 tests. Qualification
`d64d50c8-99ee-44b7-a922-d7c76b3a08fd` records 50 consecutive passing cycles
(18,000 test executions), typecheck, build, offline install smoke, and package
dry-run on macOS. The artifact truthfully records the intentional dirty tree;
clean-commit, Linux, full Harbor datasets, crash-matrix, and soak gates remain. Every milestone
updates this table and produces a machine-readable qualification artifact.

## Delivery milestones

### M0 — Truth and compatibility

Owner: Core maintainers. Blocks public 1.0 claims.

- Make this roadmap, CLI help, README, architecture, implementation status, and
  competitive audit agree with the executable.
- Publish tested OS, terminal, provider/model, Engram, MCP, and schema matrices.
- Remove or date historical issue lists and unsupported score/speed claims.
- Record commit, dirty state, runtime, OS, suite counts, duration, failures, and
  artifact hashes in qualification output.

Acceptance: every public command maps to maintained code and a regression test;
test, typecheck, build, install smoke, and package dry-run pass cleanly.

### M1 — One runtime authority

Owner: Runtime.

- Route TUI, print, jobs, child agents, approvals, and questions through
  `RunService`; the journal becomes the only durable lifecycle authority.
- Add bounded steering, checkpoints, cancellation propagation, deadlines,
  budgets, backpressure, and typed failures.
- Resume only idempotent interrupted work. Put uncertain mutations into
  `needs_reconciliation` for explicit rollback, completion, or cancellation.
- Propagate parent/child and correlation IDs across an entire run tree.

Acceptance: equivalent fixture tasks produce equivalent event sequences through
all surfaces. Kill tests cover event append, approval, tool start, workspace
commit, verification, session save, and child merge.

### M2 — Daily-driver TUI

Owner: Terminal UX.

- Finish selection, word movement, completion, file mentions, searchable history,
  and split escape-sequence parsing in the multiline Unicode composer.
- Add command, provider/model, session/run, memory, tool, agent, and job overlays.
- Queue messages while busy and persist steering on the active run.
- Render Markdown, syntax-highlighted code, binary/untracked diffs, tool progress,
  costs, context pressure, approvals, questions, and verification evidence.
- Qualify alternate/classic, reduced-motion, `NO_COLOR`, narrow, crash restore,
  and screen-reader modes.

Acceptance: PTY E2E coverage for every command and keyboard path on macOS and
Linux, resize snapshots, and a 24-hour interaction soak.

### M3 — Capability-driven models

Owner: Providers.

- Make adapters implement one request, stream, abort, usage, selected-model, and
  normalized-error contract.
- Cache remote catalogs with expiry and last-known-good state. Preflight auth,
  endpoint, context, modality, and tool requirements.
- Use native tools when available. Enable a constrained text-tool shim only for
  models that pass conformance; label the rest chat-only.
- Filter OpenRouter free fallback by required capabilities and show the selected
  model and fallback reason.
- Support configurable OpenAI-compatible endpoints without kernel branching.

Acceptance: deterministic adapter contracts plus opt-in paid, free, and local
smokes. Provider wire formats never enter the run kernel.

### M4 — Context, tools, and verification

Owner: Agent quality.

- Deterministically budget instructions, recent turns, repo index, memory, active
  diff, errors, schemas, and verification; journal selection/eviction reasons.
- Replace flat compaction with hierarchical summaries pointing to archived
  message IDs, preserving instructions and unresolved work across cycles.
- Persist an incremental code index with symbols, references, dependencies,
  diagnostics, git recency, precise invalidation, and lexical fallback.
- Publish hooks for run, context, model, authorization, tool completion,
  verification, learning proposal, and session lifecycle.

Acceptance: recall fixtures, 100,000-file performance, transaction properties,
prompt-injection tests, and partial-edit recovery.

Delivered tranche (2026-07-21): `ContextManifestV2`, real selection of retrieved
memory/code content, per-kind allocation, untrusted-evidence marking, schema-v2
session branches, append-only compaction records, source hashes/pointers, and
run events for context planning/compaction and memory lifecycle visibility.
The request boundary now independently fits recent conversation to the usable
model window, retains tool-use/result groups atomically, bounds oversized recent
payloads on copies, and records durable/sent/omitted counts in the run journal.

### M5 — Durable automation and graphs

Owner: Orchestration.

- Qualify daemon PID/log lifecycle, service templates, leases, renewal, misfires,
  retry/backoff, concurrency, notifications, secrets, and retention.
- Reject completion from stale lease owners and prevent restart duplicates.
- Journal graph dependencies, mailboxes, budgets, worktree ownership, merge
  evidence, conflicts, and reconciliation through `RunService`.
- Bound fan-out, spend, calls, parent context, and external-agent execution.

Acceptance: duplicate daemon, restart, DST, expired lease, worktree conflict,
child cancellation, crash recovery, and resource stress tests.

### M6 — Governed long-term memory

Owner: Memory.

- Adopt the contract in `ENGRAM-IMPROVEMENT-BRIEF.md`.
- Separate fact, preference, procedure, episode, error, repository knowledge,
  and summary records across user/workspace/repo/branch/session scopes.
- Store provenance, confidence, validation, sensitivity, expiry, supersession,
  content hash, and usage; keep global recall opt-in.
- Rank by relevance, scope, freshness, confidence, diversity, and token cost.
  Expose inspect/edit/forget/export/rebuild in the TUI.
- Block secrets, prompt injection, benchmark contamination, duplicates, stale
  code facts, and unsupported promotion.

Acceptance: held-out retrieval metrics, poisoning tests, verified deletion,
isolation, corruption recovery, and simulated day-one/month-six/year-one history.

Delivered Grain-side tranche (2026-07-21): typed `EngramClient`, `/capabilities`
negotiation, v1/legacy transport selection, structured errors, governed memory
types/scopes/provenance, promoted-only default recall, candidate-only automatic
writes, idempotency keys, degraded-mode run events, and CLI/TUI status/search/
inspect/edit/forget/export/rebuild views and client operations. The independent Engram repository must implement the
matching `/v1` service before these paths can qualify live.

The legacy verified-learning JSONL can be imported with
`grain learning migrate <repository-scope>`. Migration uses stable idempotency
keys and a resumable checkpoint and never deletes the source ledger.

### M7 — Evidence-gated 1.0

Owner: Release and security.

- Run Terminal-Bench through Harbor plus an independent broad terminal suite with
  pinned commits, models, prompts, containers, and configurations.
- Keep the external Harbor bridge terminal-only: no host filesystem, MCP,
  memory, skill, repository-index, or delegation path may enter a trial.
- Report pass interval, flake, tokens, cost, latency, calls, retries, and failures;
  disable global recall and retain redacted journals.
- Validate Harbor's authoritative `result.json` rather than trusting its process
  exit code; fail on incomplete trials, exceptions, errors, or missing verifier
  rewards.
- Fuzz streams, compaction, cron, journals, migrations, and tool inputs.
- Produce signed artifacts, checksums, SBOM, provenance, secret scan, disclosure
  policy, backup/restore evidence, and reproducible clean installs.

Release gates:

- 50 consecutive clean qualifications and five trials per published combination.
- Less than 2% harness flake; no critical security or unresolved data-loss issue.
- Every enumerated crash point passes.
- 24-hour TUI/job/daemon and seven-day memory soaks pass.
- macOS/Linux upgrade, restore, uninstall, and clean install pass.
- Any leadership claim is independently reproducible and top-three or tied with
  the leader while improving comparison-median cost or latency.

## Evidence format

Local evidence belongs under `.grain/cache/qualification/`; release artifacts are
immutable and redacted. Each manifest includes Grain commit and dirty flag,
runtime/dependency hashes, OS/architecture, provider/model, configuration hash,
test identity and seed, timestamps, metrics, failures, and journal hashes.

Refresh competitive checks at every major release from official Harbor, Pi,
Claude Code, and Codex sources linked in `COMPETITIVE-AUDIT.md`.
