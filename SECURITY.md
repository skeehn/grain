# Security Policy

## Reporting

Please report vulnerabilities through GitHub's private security-advisory flow.
Do not include secrets, private repository contents, or working exploits in a
public issue. Maintainers will acknowledge a complete report, assess impact, and
coordinate a fix and disclosure. No response-time SLA is claimed before the
project publishes a staffed support policy.

## Supported versions

Until 1.0, only the latest tagged release receives security fixes. Grain 1.0
will publish an explicit support window in `SUPPORT.md`.

## Defaults

Telemetry, global memory recall, networked embeddings, destructive tools, and
untrusted MCP tools are off by default. Grain never treats retrieved memory as a
system instruction and never extracts credentials from external-agent logins.

See [the threat model](docs/THREAT-MODEL.md).
