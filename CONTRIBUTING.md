# Contributing to Grain

Thank you for improving Grain. Open an issue before a large runtime, storage,
protocol, permission, or user-interface change so its contract and qualification
artifact can be agreed first.

## Development

Requirements: macOS or Linux and the Bun version pinned in CI.

```sh
bun install --frozen-lockfile
bun test
bun run typecheck
bun run build
bun run install:smoke
```

Use TypeScript strict mode, preserve existing user state through forward
migrations, and add a deterministic test for every behavior change. Provider and
executor tests must use fakes in normal CI; credentialed live tests remain
explicitly opt-in. Never add a benchmark result without its pinned configuration,
journal, verifier output, and failure accounting.

Pull requests should explain the problem, public contract, safety impact,
migration impact, evidence, and remaining risk. Update `docs/FEATURE-STATUS.md`
when a user-visible status changes. Keep unrelated working-tree changes intact.

Portable skills belong in `<name>/SKILL.md`. Machine-proposed procedures must go
through the learning ledger and independent validation; do not commit local
learned JSON as a trusted community skill.

Security reports follow `SECURITY.md`; conduct follows `CODE_OF_CONDUCT.md`.
Contributions are licensed under MIT.
