# Engram: Independent Service Improvement Brief

Last updated: 2026-07-21  
Audience: Engram maintainers and agent-harness integrators

## Objective

Keep Engram an independently usable, local-first memory service with predictable
durability, retrieval, isolation, and operations. Grain consumes a public
contract; neither project depends on the other's storage internals.

## V1 product contract

- The daemon is the single database writer and index coordinator. While it is
  reachable, CLI and MCP operations proxy through it rather than opening the
  database and competing for locks.
- Publish versioned `/v1` HTTP routes, MCP, CLI parity, OpenAPI, and a typed
  TypeScript client. Negotiate through `GET /capabilities`.
- Provide `/health/live`, `/health/ready`, and `/metrics`. Readiness reports the
  primary database, text/vector indexes, migration, and queue state.
- Return `{code, message, retryable, request_id, details?}` errors. Support
  request deadlines, cancellation, and idempotency keys for mutations.

Minimum resources:

```text
POST   /v1/memories
GET    /v1/memories/{id}
PATCH  /v1/memories/{id}
DELETE /v1/memories/{id}
POST   /v1/search
POST   /v1/relations
GET    /v1/graph/{id}
GET    /v1/index/status
GET    /v1/export
POST   /v1/index/rebuild
POST   /v1/admin/snapshot
POST   /v1/admin/restore
POST   /v1/admin/repair
```

Search selects lexical, vector, hybrid, or graph-expanded mode and accepts
namespace, scopes, types, tags, time range, confidence, pagination, deadline,
diversity, and result budget. Results include component scores, provenance,
index version, snippets, and a short score explanation.

## Memory record

Use first-class fields instead of encoding isolation in tags:

```text
id, namespace, scopes[], memory_type, body, content_hash
provenance{source, source_id, run_id, author}
confidence, validation_status, sensitivity
created_at, updated_at, observed_at, expires_at, last_used_at
supersedes[], superseded_by?, embedding{model, version, dimensions}
tags[], metadata{}, version
```

Required types: fact, preference, procedure, episode, error,
repository_knowledge, and summary. Namespace isolation is mandatory; global
search is privileged and explicit. Tags remain supported but are not an
authorization boundary.

## Storage and retrieval

- Use atomic forward migrations with preflight, resumable checkpoints, backup,
  and downgrade refusal. Record schema and embedding versions.
- Provide WAL-equivalent crash recovery, checksums, consistent snapshots,
  incremental backup, verified restore, compaction, repair, and full reindex.
- Treat the primary store as authoritative. Index work is durable and exposes
  sequence lag, queue depth, failures, retries, and last applied mutation.
- Explain primary/text/vector/graph count divergence as pending, filtered,
  deleted, or corrupt; unexplained drift makes readiness fail.
- Version embeddings by provider/model/dimensions. Support batch generation,
  dedupe, caching, offline fallback, and resumable re-embedding.
- Guarantee deterministic tie-breaking and stable pagination for a fixed index
  sequence. Degrade to lexical results when vectors are unavailable.

Initial warm local-search targets on published reference hardware:

| Corpus | p50 | p95 | Ready after clean start |
|---|---:|---:|---:|
| 10,000 | <100 ms | <300 ms | <5 s |
| 100,000 | <250 ms | <750 ms | <20 s |
| 1,000,000 | <750 ms | <2 s | measured and documented |

These remain targets until reproducible artifacts exist.

## Memory quality and governance

- Deduplicate using normalized hashes plus semantic similarity, preserving all
  provenance when records merge.
- Detect contradictions and create reviewable supersession links; never silently
  rewrite history. Support confidence decay and configurable garbage collection.
- Return bodies as untrusted data so an agent cannot treat recalled content as
  system instructions.
- Add secret/PII redaction hooks, sensitivity labels, encryption options, audit
  logs, retention, export, and verified deletion.
- Make cross-project recall, telemetry, remote embeddings, and network ingest
  explicit opt-ins with observable configuration.
- Explain ranking, provenance, scopes, embedding version, validation, expiry,
  and supersession through the CLI and API.

## Grain migration

1. Add capabilities and `/v1` without removing existing routes.
2. Add namespace/scope fields while translating `project:<path>` tags.
3. Release the typed client and a fake conformance server.
4. Switch Grain to capability negotiation and the client.
5. Run dual-read comparisons and report ranking/isolation differences.
6. Back up, migrate, verify counts and sampled bodies, then enable v1 writes.
7. Deprecate legacy routes after at least one stable compatibility window.

Grain now contains the client-side contract and fake-server tests for health,
capabilities, typed scoped search, structured errors, idempotent candidate
writes, typed get/list/update/delete, export, index status, and index rebuild. Engram implementation remains
the blocking half of this migration; legacy endpoints stay operational until
live contract and data-migration suites pass.

The target client contract provides explicit health, search, create, get, list,
update, delete, graph, export, rebuild, and lifecycle control; per-call
deadlines; typed errors; retries only for declared retryable reads/idempotent
writes; and no hidden global database path. Grain currently implements the
memory, export, and index operations needed by its operator surfaces.

## Acceptance suite

- Unit/property tests for records, filters, ranking, pagination, dedupe,
  supersession, redaction, migrations, and errors.
- Concurrent reader/writer and multi-client stress with daemon/CLI/MCP coexistence.
- Kill tests during add, relate, delete, embed, index, migrate, compact, snapshot,
  restore, reindex, and repair.
- Upgrade tests from every schema and embedding version, including interrupted
  and resumed migrations.
- Retrieval fixtures report recall, precision, nDCG, MRR, latency, freshness,
  diversity, and tokens injected into consumers.
- Corpus qualification from empty through one million records, with separate
  characterization above that scale.
- Corruption/partial-index repair, namespace isolation, deadline behavior,
  idempotent replay, and verified deletion.
- Simulated six-month and one-year histories covering stale facts, moved repos,
  contradictions, supersession, embedding upgrades, and retention.
- Grain uses a fake server in normal CI and an opt-in live-daemon release matrix;
  both repositories share the contract fixtures.

## Release evidence

Each release publishes API/schema compatibility, embedding support, migration and
rollback constraints, corpus benchmark manifests, durability results, known
limits, checksums/SBOM, and redacted failures. “Production ready” requires passing
backup/restore and process-kill suites.
