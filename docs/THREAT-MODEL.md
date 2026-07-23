# Threat Model

Protected assets include source code, uncommitted changes, credentials, memory,
sessions, journals, tool approvals, and release artifacts. Trust boundaries are
model providers, external CLIs, MCP servers, Engram, repository content, skills,
retrieved memory, subprocesses, Git worktrees, and the terminal.

Primary threats are prompt injection, secret exfiltration, path/symlink escape,
command injection, confused-deputy approvals, poisoned memory or skills,
cross-project recall, duplicate scheduled execution, journal tampering, replay of
non-idempotent tools, malicious adapter output, dependency compromise, and forged
benchmark evidence.

Current controls include canonical path confinement, atomic optimistic writes,
worktree isolation, explicit destructive authorization, MCP allowlists, scoped
memory, secret/instruction screening, hash-chained journals, lease-based jobs,
bounded recursion, aggregate budgets, no-shell stdio execution, and signed build
provenance in tag CI.

Known residual risks are documented in `docs/FEATURE-STATUS.md`; notably, the
complete PTY/live-provider/fault-injection/soak matrix and Engram `/v1` server are
not yet qualified.
