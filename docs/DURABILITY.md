# Grain durability contract

Grain is designed to remain usable when providers, the memory daemon, or one local
state file fails. This document describes what is persisted and what operators can
expect as the installation ages.

## Persistence layers

| State | Location | Durability and recovery |
| --- | --- | --- |
| Conversation history | `~/.grain/sessions/<id>.json` | One versioned, atomic file per conversation. Writes to the same conversation are locked across processes. A corrupt file is isolated from other conversations. The latest 100 messages remain resume-ready. |
| Archived conversation turns | `~/.grain/sessions/<id>.archive.jsonl` | Messages evicted from the active 100-message window are appended and fsynced instead of deleted. Stable message IDs allow duplicate recovery records to be deduplicated. |
| Legacy conversations | `~/.grain/sessions.json` | Imported once without deleting or rewriting the source file. |
| Knowledge memory | Configured `engram_db` | Accessed through bounded HTTP calls with CLI fallback. Retrieval and automatic error memory are scoped to the active repository. |
| Workspace hints | `~/.grain/context/session/<workspace-hash>.json` | Atomic, per-repository snapshots. Corruption resets only that repository's non-essential hints. |
| Learned procedures | `~/.grain/learning/ledger.jsonl` | Append-only evidence ledger. A malformed record is skipped while later valid records remain available. Promotion still requires independent successful evidence. |
| Run audit trail | `~/.grain/runs/<id>/events.jsonl` | Append-only, fsynced, hash-chained events. Replay fails closed on tampering or corruption. |
| Scheduled jobs | `~/.grain/schedules.json` | Atomic writes serialized by a cross-process lock. Corruption fails closed instead of replacing jobs with an empty store. |

## Failure behavior

- If Engram HTTP is still starting or becomes unhealthy, Grain retries discovery and
  uses the local Engram CLI for search, add, get, list, delete, stats, and graph.
- Ordinary Engram HTTP operations have a five-second deadline; semantic search has
  fifteen seconds for embedding and retrieval. Memory failure cannot hold the agent
  loop indefinitely.
- If a selected OpenRouter free model is unavailable, OpenRouter's free router selects
  another available model compatible with the request's tool requirements.
- Context compaction preserves recent turns, bounds large tool results, and repairs
  tool-call boundaries before resume.

## Month 6 and year 1 operations

Grain does not delete conversation files or run journals on a time schedule. Disk use
therefore grows with usage. Inspect it periodically with `grain status`, and include
`~/.grain`, the configured Engram database, and repository work in normal backups.

The session format carries `schema_version: 1`; future migrations must be additive,
non-destructive, and covered by a legacy fixture test. The run journal already accepts
an explicit set of historical schema versions. Unknown schemas fail closed rather than
being guessed.

Recommended recurring checks:

1. Run `grain status` to confirm provider, memory, skills, and session counts.
2. Run `grain engram stats` to confirm node, search-index, and vector counts agree.
3. Use `grain --resume -p "follow up"` to verify the latest repository conversation reloads.
4. Run `bun run check` before installing a new Grain build.
5. Back up state before manually editing or migrating JSON/JSONL files.

No model or routing table stays state of the art indefinitely. Grain's contract is
capability-aware fallback, observable errors, versioned local state, and tests that make
provider and storage upgrades safe. Model catalogs and provider defaults still require
periodic refresh as upstream services change.
