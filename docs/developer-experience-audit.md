# CLI developer-experience audit — 2026-09-30

Scope: the terminal, installation/update lifecycle, command discoverability,
skills, MCP, and PR review regressions. Scores are editorial assessments, not
benchmarks or a claim of superiority. No prior planning score was available.

| Dimension | Score | Evidence and remaining gap | What 10 would require |
| --- | --- | --- | --- |
| Getting started | 8/10 | TESTED: bare-command PTY workflows and offline npm install. Fresh live-account onboarding not measured. | Timed first-run success across supported platforms and account types |
| CLI design | 8/10 | TESTED/PARTIAL: every documented command has inert help; config, notes, jobs, skills, MCP lifecycle tests. Live agent merges and paid workflows excluded. | Complete command contract suite plus shell completion |
| Errors/debugging | 8/10 | TESTED/PARTIAL: invalid commands, missing arguments, malformed MCP config, corrupt downloads, failed tools, cancellation and recovery. | Consistent structured diagnostics and remedy links everywhere |
| Documentation | 7/10 | INFERRED: README now explains source/release/npm updates and extension boundaries; executable examples covered by tests. No browser usability study. | Task-oriented guides validated with new users |
| Upgrades | 8/10 | TESTED/PARTIAL: atomic replacement, checksums, version verification, backups, no replacement on corrupt/partial downloads or failed builds. Live release installation not performed. | Published release matrix and migration/rollback qualification across versions |
| Development tooling | 8/10 | TESTED/PARTIAL: Bun checks, compiled executable, npm package, real PTYs and local servers; CI has macOS/Linux jobs. | Documented performance/soak gates and platform-parity evidence |
| Community/ecosystem | 5/10 | INFERRED: CONTRIBUTING and security policy exist. Response-time/community-health claims not investigated. | Proven support responsiveness and maintained integration examples |
| DX measurement | 4/10 | INFERRED: reproducible regressions and CI, but no longitudinal onboarding or task-success study. | Explicit satisfaction, flow, and time-to-first-success measurements |

Overall: **7/10**, with four tested/partial operational dimensions, one mixed
development-tooling dimension, and three inferred dimensions. Human time to
first successful task was **not measured**; fixture durations are not a proxy.

Concrete fixes include reachable `skills validate`, truthful nonzero errors,
side-effect-free command help, MCP inspection and validation, HTTP handshake
and SSE matching, installer/update integrity checks, adjacent attachments,
nested-project undo, and undo-time symlink refusal. See
[the verification matrix](terminal-verification.md) for reproducible tests.

Independent adversarial review was attempted but unavailable because the
reviewer account hit its usage limit. This report is not engineering-review
clearance; current PR CI and review status must be checked before merging.
No release was published and no PR was merged by this audit.
