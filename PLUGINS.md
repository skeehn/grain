# Executor and MCP Extensions

Grain supports two separate extension boundaries:

- Executor adapters run another coding agent under Grain's scheduler.
- MCP servers add allowlisted tools and resources to Grain's native agent.

Built-in executor adapters currently cover Grain native, Claude Code, Codex,
OpenCode, and Hermes. Grain uses installed binaries and the user's existing
login; it does not extract subscription credentials or silently change an
explicitly selected executor.

Portable agent profiles live at `.grain/agents/<name>.md`. Run:

```sh
grain agents profiles
grain agents validate
grain doctor
```

Third-party agents can implement the shell-free `grain-executor/v1` stdio
protocol documented in [the extension SDK](docs/EXTENSION-SDK.md).

MCP configuration lives at `~/.grain/mcp.json`. Each server is disabled unless
`trust.enabled` is true, and each callable tool must be named in
`trust.allowTools`. Plain HTTP is limited to loopback; remote servers require
HTTPS. Environment variables are inherited only when explicitly configured.

See [the compatibility matrix](docs/COMPATIBILITY.md) for qualification status.
