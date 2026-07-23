# World-Class Harness Program Status

> Current delivery status and release gates are maintained in
> [`GRAIN-1.0-ROADMAP.md`](./GRAIN-1.0-ROADMAP.md). This file is retained as a
> compact historical implementation ledger.

Updated: 2026-07-22

The live legacy Engram store was backed up and reconciled on 2026-07-22. Ten
orphan FTS/vector entries were removed through Engram's cascade endpoint;
`grain doctor` now verifies 200 nodes, 200 FTS documents, and 200 vectors.
The separate `/v1` governance server remains unimplemented in Engram.

## Agent OS kernel slice

- Capability-aware model profiles and deterministic context manifests are implemented and journaled.
- Context manifests are schema v2 and drive retrieved memory/code inclusion rather than merely describing it.
- Provider requests use a token-bounded copy of conversation history that keeps tool calls/results together and journals every omission or truncation.
- Sessions use parent-linked schema-v2 entries and append-only, source-hashed compaction records with branch support.
- Grain negotiates a typed Engram `/v1` contract while retaining legacy reads and explicit degraded operation.
- Automatic v1 memory writes are scoped candidates with provenance, idempotency, secret screening, and prompt-injection screening.
- Typed memory inspect/edit/forget/export/rebuild operations are exposed through the CLI and TUI and fail closed against legacy servers.
- Constrained providers receive reduced core tool sets rather than the full schema catalog.
- Verified learning uses candidate, independent validation, and promotion states; self-validation is rejected.
- Hybrid agent contracts use shared read-only isolation for research and worktree isolation for writers.
- Durable graph templates and CLI inspection exist for pair, research, plan, review-panel, swarm, and repair-loop modes.
- Versioned agent profiles, scheduler-owned recursive expansion, aggregate run-tree budgets, and migration/benchmark/recursive-delivery recipes are implemented.
- Claude Code, Codex, OpenCode, Hermes, and generic JSON/JSONL stdio executors share a normalized result/session contract. macOS live smokes pass for Codex, OpenCode, and Hermes; Claude authentication was confirmed but the account quota blocked execution. Linux and repeated-trial qualification remain experimental.
- Portable nested `SKILL.md` packages use metadata-first progressive disclosure with legacy flat-file compatibility.
- Portable packages are rejected before activation when their normative Agent
  Skills name, directory, description, or length constraints are invalid.
- `grain setup`, `grain doctor`, `grain agents profiles`, and `grain agents validate` expose configuration and preflight checks.
- Evidence-free `finish` calls are rejected and the finish tool has no Git, memory, filesystem, or network side effects.
- Durable child execution, mailboxes, transactional worktree merging, stdio/HTTP MCP, and agent-aware graph controls are implemented.
- Event schema v2, retained terminal frames, differential patches, responsive run projection, and a full-screen journal viewer are implemented with v1 replay compatibility.
- Workspace writes, patches, and multi-file edits now use persisted approval-state transactions with content-addressed rollback.

## Implemented foundation

- Hash-chained, fsync-backed run journals with replay, inspection, export, and tamper detection.
- Model, tool, policy, usage, provider error, protocol error, verification, and terminal run events.
- Central approval gateway with fail-closed Bash classification and separate destructive authorization.
- Workspace-root confinement after symlink resolution, binary and size guards, optimistic hashes, atomic writes, content-addressed snapshots, and deterministic search/listing.
- Repository wiki generation, lexical search, page retrieval, proposals, provenance verification, stale detection, Git diff, private catalog, and loopback-only web serving.
- Harbor 0.20 external-agent adapter, verified bridge canary, and current-schema
  pinned Terminal-Bench 2.0 comparison manifest.
- Harbor bridge isolation restricts model-visible tools to container-proxied
  `bash` plus side-effect-free `finish`; host memory, skills, MCP, code index,
  filesystem, and delegation are excluded.
- The 2026-07-22 live canary required shell redirection and passed through
  Docker and `openrouter/free` with reward 1.0 and zero exceptions. Full
  Terminal-Bench trials remain an unreached release gate.
- Harbor result validation fails closed on incomplete, errored, cancelled,
  exception-bearing, partially evaluated, or below-threshold jobs instead of
  trusting Harbor's zero process exit status.
- Sanitized trajectory export plus aggregate pass, flake, latency, and cost reporting.

## Qualification still requiring sustained runs

- Full Terminal-Bench 2.0 runs against pinned Grain, Pi, and Hermes versions.
- Five-trial release measurement proving under 2% flaky task-model pairs.
- Measured top-five/70% score and 10% paired-success median cost advantage.
- Fault injection through every process-kill boundary and reconciliation of unknown external effects.
- PTY-driven command/keyboard coverage on both release operating systems and live external-executor conformance.
- Engram daemon `/v1`; only Grain's typed fake-server client contract is currently implemented in this repository.
- 100,000-file performance qualification and a clean-commit repetition of the local qualification.
- 100% branch coverage for kernel, policy, filesystem, replay, provider parsing, and wiki provenance.

Machine-readable qualification `d64d50c8-99ee-44b7-a922-d7c76b3a08fd`
passes 50 consecutive 360-test cycles (18,000 test executions), typecheck,
Node-compatible and standalone builds, offline installation smoke, and package
dry-run. It records the intentional dirty tree, so it is strong implementation
evidence but not a substitute for the remaining clean-commit and external gates.

These external and repeated-run gates must not be reported as passed until their manifests, trajectories, and verifier outputs are published.
