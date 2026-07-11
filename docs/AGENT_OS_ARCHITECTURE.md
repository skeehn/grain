# Grain Agent OS Architecture

## Product boundary

Grain is a coding-first agent operating system. Optional Hermes-style assistant adapters may add messaging, schedules, and voice, but cannot bypass the coding kernel, ToolGateway, WorkspaceFS, event journal, or verification policy.

## Locked decisions

- Coding quality and repository work take priority over general-assistant breadth.
- Read-only research agents share the repository; agents that write use isolated Git worktrees.
- A learning starts as a candidate and promotes automatically only after successful validation from a different run.
- Models propose uncertain actions; deterministic runtime components enforce budgets, dependencies, permissions, persistence, and completion gates.

## Control plane

1. The capability registry describes model context, output, tools, reasoning, modalities, and structured-output behavior.
2. The context engine ranks and packs instructions, conversation, tools, workspace evidence, wiki pages, memory, and verifier output into a recorded manifest.
3. The RunEngine journals model, policy, tool, filesystem, verification, learning, and agent events.
4. The AgentScheduler owns durable task dependencies, authority, isolation, budgets, and terminal states.
5. ToolGateway and WorkspaceFS remain the only authorized side-effect paths.
6. Verifiers decide whether a task or learning may transition to a trusted terminal state.

## Learning lifecycle

`candidate -> validated -> promoted`

Candidates may also become `rejected`, `stale`, or `superseded`. The proposing run never counts as independent validation. Every promoted entry retains its source run, validation evidence, confidence, tags, and freshness metadata.

## Multi-agent modes

- `solo`: one agent with deterministic plan and verification gates.
- `pair`: a read-only researcher, worktree-isolated driver, and independent navigator.
- `research`: parallel read-only evidence gathering and critique.
- `plan`: evidence-backed design without repository mutation.
- `review-panel`: correctness, security, testing, and performance reviews.
- `swarm`: bounded independent tasks with explicit merge dependencies.
- `repair-loop`: implement, verify, diagnose, and retry within hard budgets.

Graph creation, durable execution, mailbox delivery, worktree merge transactions, child lease recovery, and TUI steering controls are implemented. Remaining release work centers on unified child-run journals, full reconciliation views, large-repository indexing, and published Harbor qualification.

## Release rule

No release claim is based on model self-report. Tests, replay, wiki provenance, clean installation, live providers, crash injection, soak runs, Harbor evaluation, redaction, and a clean Git diff must supply the evidence.
